const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ROUND_DURATION = parseInt(process.env.ROUND_DURATION || '10', 10); // 10 seconds for testing

// Ensure games directory exists
const gamesDir = path.join(__dirname, 'games');
if (!fs.existsSync(gamesDir)) {
  fs.mkdirSync(gamesDir);
}

app.use(express.json());
app.use(express.static('public'));

// Load wordlist into memory
let wordSet = new Set();
let sixLetterWords = [];
try {
  const wordlist = fs.readFileSync('wordlist.txt', 'utf-8');
  const words = wordlist.split('\n').map(w => w.trim().toUpperCase()).filter(w => w.length >= 3);
  wordSet = new Set(words);
  sixLetterWords = words.filter(w => w.length === 6);
  console.log(`Loaded ${wordSet.size} words from wordlist.txt (${sixLetterWords.length} six-letter words)`);
} catch (err) {
  console.error('Error loading wordlist.txt:', err.message);
  console.log('Server will start but word validation will fail');
}

// Helper: Generate random game code
function generateGameCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Helper: Generate random letters for the game
function generateLetters() {
  // Pick a random 6-letter word and scramble it
  if (sixLetterWords.length === 0) {
    // Fallback if no 6-letter words available
    return 'MASTER';
  }

  const randomWord = sixLetterWords[Math.floor(Math.random() * sixLetterWords.length)];
  return randomWord.split('').sort(() => Math.random() - 0.5).join('');
}

// Helper: Check if word can be formed from letters
function canFormWord(word, gameLetters) {
  const letterCount = {};
  for (let letter of gameLetters) {
    letterCount[letter] = (letterCount[letter] || 0) + 1;
  }

  for (let letter of word) {
    if (!letterCount[letter] || letterCount[letter] === 0) {
      return false;
    }
    letterCount[letter]--;
  }
  return true;
}

// Helper: Calculate points for a word
function calculatePoints(word) {
  const length = word.length;
  if (length === 3) return 100;
  if (length === 4) return 400;
  if (length === 5) return 800;
  if (length === 6) return 1400;
  if (length === 7) return 1800;
  return 2300 + (length - 8) * 500; // 8+ letters
}

// Helper: Save game to file
function saveGame(gameCode, gameData) {
  const filePath = path.join(__dirname, 'games', `${gameCode}.json`);
  fs.writeFileSync(filePath, JSON.stringify(gameData, null, 2));
}

// Helper: Load game from file
function loadGame(gameCode) {
  const filePath = path.join(__dirname, 'games', `${gameCode}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// API: Create new game
app.post('/api/games', (req, res) => {
  const gameCode = generateGameCode();
  const letters = generateLetters();

  const gameData = {
    gameCode,
    letters,
    players: {},
    status: 'waiting',
    startTime: null,
    duration: ROUND_DURATION,
    createdAt: Date.now()
  };

  saveGame(gameCode, gameData);
  res.json({ gameCode, letters });
});

// API: Get game state
app.get('/api/games/:code', (req, res) => {
  const game = loadGame(req.params.code);
  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  // Check if game should be finished
  if (game.status === 'active' && game.startTime) {
    const elapsed = (Date.now() - game.startTime) / 1000;
    if (elapsed >= game.duration) {
      game.status = 'finished';
      saveGame(req.params.code, game);
    }
  }

  res.json(game);
});

// API: Join game
app.post('/api/games/:code/join', (req, res) => {
  const { playerName } = req.body;
  const game = loadGame(req.params.code);

  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  if (game.status !== 'waiting') {
    return res.status(400).json({ error: 'Game already started' });
  }

  if (!playerName || playerName.trim().length === 0) {
    return res.status(400).json({ error: 'Player name required' });
  }

  // Generate unique player ID
  const playerId = 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

  game.players[playerId] = {
    name: playerName.trim(),
    words: [],
    score: 0
  };

  saveGame(req.params.code, game);
  res.json({ playerId, game });
});

// API: Start game
app.post('/api/games/:code/start', (req, res) => {
  const game = loadGame(req.params.code);

  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  if (game.status !== 'waiting') {
    return res.status(400).json({ error: 'Game already started' });
  }

  game.status = 'active';
  game.startTime = Date.now();

  saveGame(req.params.code, game);
  res.json(game);
});

// API: Validate and add word
app.post('/api/games/:code/words', (req, res) => {
  const { playerId, word } = req.body;
  const game = loadGame(req.params.code);

  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  if (game.status !== 'active') {
    return res.status(400).json({ error: 'Game not active', valid: false });
  }

  if (!game.players[playerId]) {
    return res.status(400).json({ error: 'Player not found', valid: false });
  }

  const wordUpper = word.trim().toUpperCase();

  // Validate word
  if (wordUpper.length < 3) {
    return res.json({ valid: false, reason: 'Word must be at least 3 letters' });
  }

  if (!canFormWord(wordUpper, game.letters)) {
    return res.json({ valid: false, reason: 'Cannot form word from available letters' });
  }

  if (!wordSet.has(wordUpper)) {
    return res.json({ valid: false, reason: 'Word not in dictionary' });
  }

  // Check if player already submitted this word
  if (game.players[playerId].words.some(w => w.word === wordUpper)) {
    return res.json({ valid: false, reason: 'Word already submitted' });
  }

  // Add word to player's list
  const points = calculatePoints(wordUpper);
  game.players[playerId].words.push({ word: wordUpper, points });
  game.players[playerId].score += points;

  saveGame(req.params.code, game);
  res.json({ valid: true, points, word: wordUpper });
});

// API: Remove word from player's list
app.delete('/api/games/:code/words', (req, res) => {
  const { playerId, word } = req.body;
  const game = loadGame(req.params.code);

  if (!game) {
    return res.status(404).json({ error: 'Game not found' });
  }

  if (game.status !== 'active') {
    return res.status(400).json({ error: 'Game not active' });
  }

  if (!game.players[playerId]) {
    return res.status(400).json({ error: 'Player not found' });
  }

  const wordUpper = word.trim().toUpperCase();
  const player = game.players[playerId];
  const wordIndex = player.words.findIndex(w => w.word === wordUpper);

  if (wordIndex !== -1) {
    const removedWord = player.words.splice(wordIndex, 1)[0];
    player.score -= removedWord.points;
    saveGame(req.params.code, game);
  }

  res.json({ success: true });
});

// Cleanup old games (24 hours)
setInterval(() => {
  const gamesDir = path.join(__dirname, 'games');
  if (!fs.existsSync(gamesDir)) return;

  const files = fs.readdirSync(gamesDir);
  const now = Date.now();

  files.forEach(file => {
    const filePath = path.join(gamesDir, file);
    const game = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Delete games older than 24 hours
    if (now - game.createdAt > 24 * 60 * 60 * 1000) {
      fs.unlinkSync(filePath);
      console.log(`Deleted old game: ${game.gameCode}`);
    }
  });
}, 60 * 60 * 1000); // Run every hour

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Round duration: ${ROUND_DURATION} seconds`);
});
