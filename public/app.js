// Game state
let currentView = 'home';
let gameCode = null;
let playerId = null;
let playerName = null;
let pollingInterval = null;
let gameStartTime = null;
let gameDuration = 10;

// DOM elements
const views = {
  home: document.getElementById('home-view'),
  lobby: document.getElementById('lobby-view'),
  game: document.getElementById('game-view'),
  results: document.getElementById('results-view')
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  showView('home');
});

// Event listeners
function setupEventListeners() {
  document.getElementById('create-game-btn').addEventListener('click', createGame);
  document.getElementById('join-game-btn').addEventListener('click', () => {
    const code = document.getElementById('join-code-input').value.trim().toUpperCase();
    if (code) joinGame(code);
  });
  document.getElementById('start-game-btn').addEventListener('click', startGame);
  document.getElementById('add-word-btn').addEventListener('click', addWord);
  document.getElementById('word-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addWord();
  });
  document.getElementById('play-again-btn').addEventListener('click', () => {
    resetGame();
    showView('home');
  });
  document.getElementById('submit-name-btn').addEventListener('click', submitName);
  document.getElementById('player-name-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitName();
  });
}

// View management
function showView(viewName) {
  Object.keys(views).forEach(key => {
    views[key].classList.add('hidden');
  });
  views[viewName].classList.remove('hidden');
  currentView = viewName;

  // Stop polling when leaving game/lobby views
  if (viewName !== 'lobby' && viewName !== 'game') {
    stopPolling();
  }
}

// Create new game
async function createGame() {
  try {
    const response = await fetch('/api/games', { method: 'POST' });
    const data = await response.json();
    gameCode = data.gameCode;
    showNameModal();
  } catch (error) {
    alert('Error creating game: ' + error.message);
  }
}

// Join existing game
function joinGame(code) {
  gameCode = code;
  showNameModal();
}

// Show name input modal
function showNameModal() {
  document.getElementById('name-modal').classList.remove('hidden');
  document.getElementById('player-name-input').focus();
}

// Submit player name and join game
async function submitName() {
  const nameInput = document.getElementById('player-name-input');
  const name = nameInput.value.trim();

  if (!name) {
    alert('Please enter your name');
    return;
  }

  try {
    const response = await fetch(`/api/games/${gameCode}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: name })
    });

    if (!response.ok) {
      const error = await response.json();
      alert(error.error || 'Failed to join game');
      return;
    }

    const data = await response.json();
    playerId = data.playerId;
    playerName = name;

    document.getElementById('name-modal').classList.add('hidden');
    nameInput.value = '';

    showLobby(data.game);
  } catch (error) {
    alert('Error joining game: ' + error.message);
  }
}

// Show lobby
function showLobby(game) {
  document.getElementById('lobby-game-code').textContent = game.gameCode;
  document.getElementById('lobby-letters').textContent = game.letters.split('').join(' ');
  updatePlayersList(game.players);
  showView('lobby');
  startPolling();
}

// Update players list
function updatePlayersList(players) {
  const playersList = document.getElementById('players-list');
  const playerCount = document.getElementById('player-count');
  const count = Object.keys(players).length;

  playerCount.textContent = count;
  playersList.innerHTML = '';

  Object.values(players).forEach(player => {
    const li = document.createElement('li');
    li.textContent = player.name;
    playersList.appendChild(li);
  });
}

// Start game
async function startGame() {
  try {
    const response = await fetch(`/api/games/${gameCode}/start`, { method: 'POST' });
    if (!response.ok) {
      const error = await response.json();
      alert(error.error || 'Failed to start game');
    }
  } catch (error) {
    alert('Error starting game: ' + error.message);
  }
}

// Show game view
function showGameView(game) {
  document.getElementById('game-letters').textContent = game.letters.split('').join(' ');
  gameStartTime = game.startTime;
  gameDuration = game.duration;

  // Reset input and words
  const wordInput = document.getElementById('word-input');
  const addWordBtn = document.getElementById('add-word-btn');

  wordInput.value = '';
  wordInput.disabled = false;
  addWordBtn.disabled = false;

  document.getElementById('player-words-list').innerHTML = '';
  document.getElementById('current-score').textContent = '0';

  updatePlayerWords(game.players[playerId]);
  showView('game');

  // Focus input
  wordInput.focus();
}

// Update timer
function updateTimer(game) {
  if (game.status !== 'active' || !game.startTime) return;

  const elapsed = (Date.now() - game.startTime) / 1000;
  const remaining = Math.max(0, Math.ceil(game.duration - elapsed));

  document.getElementById('timer').textContent = remaining;

  if (remaining === 0) {
    document.getElementById('word-input').disabled = true;
    document.getElementById('add-word-btn').disabled = true;
  }
}

// Add word
async function addWord() {
  const input = document.getElementById('word-input');
  const word = input.value.trim().toUpperCase();

  if (!word) return;

  try {
    const response = await fetch(`/api/games/${gameCode}/words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, word })
    });

    const data = await response.json();

    if (data.valid) {
      showFeedback(`✓ ${word} (+${data.points} points)`, 'success');
      input.value = '';
      // Words will update via polling
    } else {
      showFeedback(`✗ ${data.reason}`, 'error');
    }
  } catch (error) {
    showFeedback('Error adding word', 'error');
  }
}

// Show feedback message
function showFeedback(message, type) {
  const feedback = document.getElementById('feedback');
  feedback.textContent = message;
  feedback.className = `feedback ${type}`;
  feedback.classList.remove('hidden');

  setTimeout(() => {
    feedback.classList.add('hidden');
  }, 2000);
}

// Update player words list
function updatePlayerWords(player) {
  if (!player) return;

  const wordsList = document.getElementById('player-words-list');
  const scoreDisplay = document.getElementById('current-score');

  scoreDisplay.textContent = player.score;
  wordsList.innerHTML = '';

  player.words.forEach(wordObj => {
    const li = document.createElement('li');

    const wordText = document.createElement('span');
    wordText.className = 'word-text';
    wordText.textContent = wordObj.word;

    const pointsText = document.createElement('span');
    pointsText.className = 'word-points';
    pointsText.textContent = `+${wordObj.points}`;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-word-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeWord(wordObj.word));

    li.appendChild(wordText);
    li.appendChild(pointsText);
    li.appendChild(removeBtn);
    wordsList.appendChild(li);
  });
}

// Remove word
async function removeWord(word) {
  try {
    await fetch(`/api/games/${gameCode}/words`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, word })
    });
    // Words will update via polling
  } catch (error) {
    console.error('Error removing word:', error);
  }
}

// Show results
function showResults(game) {
  document.getElementById('results-letters').textContent = game.letters.split('').join(' ');

  // Sort players by score
  const sortedPlayers = Object.entries(game.players)
    .map(([id, player]) => ({ ...player, id }))
    .sort((a, b) => b.score - a.score);

  const leaderboard = document.getElementById('leaderboard-list');
  leaderboard.innerHTML = '';

  sortedPlayers.forEach((player, index) => {
    const div = document.createElement('div');
    div.className = 'player-result';
    if (index === 0) div.classList.add('first-place');

    const header = document.createElement('div');
    header.className = 'player-header';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'player-name';
    nameSpan.textContent = `${index + 1}. ${player.name}`;

    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'player-score';
    scoreSpan.textContent = player.score;

    header.appendChild(nameSpan);
    header.appendChild(scoreSpan);

    const wordsDiv = document.createElement('div');
    wordsDiv.className = 'player-words';

    player.words.forEach(wordObj => {
      const badge = document.createElement('span');
      badge.className = 'word-badge';
      badge.textContent = `${wordObj.word} (${wordObj.points})`;
      wordsDiv.appendChild(badge);
    });

    div.appendChild(header);
    if (player.words.length > 0) {
      div.appendChild(wordsDiv);
    }

    leaderboard.appendChild(div);
  });

  showView('results');
}

// Polling
function startPolling() {
  if (pollingInterval) return;

  pollingInterval = setInterval(async () => {
    try {
      const response = await fetch(`/api/games/${gameCode}`);
      const game = await response.json();

      // Update based on game status
      if (currentView === 'lobby' && game.status === 'active') {
        showGameView(game);
      } else if (currentView === 'lobby') {
        updatePlayersList(game.players);
      } else if (currentView === 'game' && game.status === 'active') {
        updateTimer(game);
        updatePlayerWords(game.players[playerId]);
      } else if (currentView === 'game' && game.status === 'finished') {
        showResults(game);
      }
    } catch (error) {
      console.error('Polling error:', error);
    }
  }, 1000);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

// Reset game state
function resetGame() {
  gameCode = null;
  playerId = null;
  playerName = null;
  gameStartTime = null;
  stopPolling();
}
