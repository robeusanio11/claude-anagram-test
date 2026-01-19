import { getStore } from "@netlify/blobs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load wordlist
let wordSet = new Set();
let sixLetterWords = [];
try {
  const wordlistPath = path.join(__dirname, "../../wordlist.txt");
  const wordlist = fs.readFileSync(wordlistPath, "utf-8");
  const words = wordlist.split("\n").map((w) => w.trim().toUpperCase()).filter((w) => w.length >= 3);
  wordSet = new Set(words);
  sixLetterWords = words.filter((w) => w.length === 6);
} catch (err) {
  console.error("Error loading wordlist:", err.message);
}

const ROUND_DURATION = 60;

function generateGameCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateLetters() {
  if (sixLetterWords.length === 0) return "MASTER";
  const randomWord = sixLetterWords[Math.floor(Math.random() * sixLetterWords.length)];
  return randomWord.split("").sort(() => Math.random() - 0.5).join("");
}

function canFormWord(word, gameLetters) {
  const letterCount = {};
  for (let letter of gameLetters) {
    letterCount[letter] = (letterCount[letter] || 0) + 1;
  }
  for (let letter of word) {
    if (!letterCount[letter] || letterCount[letter] === 0) return false;
    letterCount[letter]--;
  }
  return true;
}

function calculatePoints(word) {
  const length = word.length;
  if (length === 3) return 100;
  if (length === 4) return 400;
  if (length === 5) return 800;
  if (length === 6) return 1400;
  if (length === 7) return 1800;
  return 2300 + (length - 8) * 500;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req, context) => {
  const url = new URL(req.url);
  // Strip /api prefix from path
  const pathParts = url.pathname.replace(/^\/api/, "").split("/").filter(Boolean);
  const method = req.method;

  const store = getStore("games");

  // POST /api/games - Create new game
  if (method === "POST" && pathParts.length === 1 && pathParts[0] === "games") {
    const gameCode = generateGameCode();
    const letters = generateLetters();
    const gameData = {
      gameCode,
      letters,
      players: {},
      status: "waiting",
      startTime: null,
      duration: ROUND_DURATION,
      createdAt: Date.now(),
    };
    await store.setJSON(gameCode, gameData);
    return json({ gameCode, letters });
  }

  // GET /api/games/:code - Get game state
  if (method === "GET" && pathParts.length === 2 && pathParts[0] === "games") {
    const code = pathParts[1];
    const game = await store.get(code, { type: "json" });
    if (!game) return json({ error: "Game not found" }, 404);

    if (game.status === "active" && game.startTime) {
      const elapsed = (Date.now() - game.startTime) / 1000;
      if (elapsed >= game.duration) {
        game.status = "finished";
        await store.setJSON(code, game);
      }
    }
    return json(game);
  }

  // POST /api/games/:code/join - Join game
  if (method === "POST" && pathParts.length === 3 && pathParts[0] === "games" && pathParts[2] === "join") {
    const code = pathParts[1];
    const body = await req.json();
    const { playerName } = body;

    const game = await store.get(code, { type: "json" });
    if (!game) return json({ error: "Game not found" }, 404);
    if (game.status !== "waiting") return json({ error: "Game already started" }, 400);
    if (!playerName || playerName.trim().length === 0) return json({ error: "Player name required" }, 400);

    const playerId = "player_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    game.players[playerId] = { name: playerName.trim(), words: [], score: 0 };
    await store.setJSON(code, game);
    return json({ playerId, game });
  }

  // POST /api/games/:code/start - Start game
  if (method === "POST" && pathParts.length === 3 && pathParts[0] === "games" && pathParts[2] === "start") {
    const code = pathParts[1];
    const game = await store.get(code, { type: "json" });
    if (!game) return json({ error: "Game not found" }, 404);
    if (game.status !== "waiting") return json({ error: "Game already started" }, 400);

    game.status = "active";
    game.startTime = Date.now();
    await store.setJSON(code, game);
    return json(game);
  }

  // POST /api/games/:code/words - Add word
  if (method === "POST" && pathParts.length === 3 && pathParts[0] === "games" && pathParts[2] === "words") {
    const code = pathParts[1];
    const body = await req.json();
    const { playerId, word } = body;

    const game = await store.get(code, { type: "json" });
    if (!game) return json({ error: "Game not found" }, 404);
    if (game.status !== "active") return json({ error: "Game not active", valid: false }, 400);
    if (!game.players[playerId]) return json({ error: "Player not found", valid: false }, 400);

    const wordUpper = word.trim().toUpperCase();
    if (wordUpper.length < 3) return json({ valid: false, reason: "Word must be at least 3 letters" });
    if (!canFormWord(wordUpper, game.letters)) return json({ valid: false, reason: "Cannot form word from available letters" });
    if (!wordSet.has(wordUpper)) return json({ valid: false, reason: "Word not in dictionary" });
    if (game.players[playerId].words.some((w) => w.word === wordUpper)) return json({ valid: false, reason: "Word already submitted" });

    const points = calculatePoints(wordUpper);
    game.players[playerId].words.push({ word: wordUpper, points });
    game.players[playerId].score += points;
    await store.setJSON(code, game);
    return json({ valid: true, points, word: wordUpper });
  }

  // DELETE /api/games/:code/words - Remove word
  if (method === "DELETE" && pathParts.length === 3 && pathParts[0] === "games" && pathParts[2] === "words") {
    const code = pathParts[1];
    const body = await req.json();
    const { playerId, word } = body;

    const game = await store.get(code, { type: "json" });
    if (!game) return json({ error: "Game not found" }, 404);
    if (game.status !== "active") return json({ error: "Game not active" }, 400);
    if (!game.players[playerId]) return json({ error: "Player not found" }, 400);

    const wordUpper = word.trim().toUpperCase();
    const player = game.players[playerId];
    const wordIndex = player.words.findIndex((w) => w.word === wordUpper);

    if (wordIndex !== -1) {
      const removedWord = player.words.splice(wordIndex, 1)[0];
      player.score -= removedWord.points;
      await store.setJSON(code, game);
    }
    return json({ success: true });
  }

  return json({ error: "Not found" }, 404);
};

export const config = {
  path: "/api/*",
};
