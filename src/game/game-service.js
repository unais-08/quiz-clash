import { randomBytes } from 'node:crypto';
import { QUESTIONS } from './questions.js';

const rooms = new Map();
const QUESTION_MS = 15_000;
const ROUND_SIZE = 5;
const ROUNDS = 3;
export function scoreAnswer(correct, elapsedMs) {
  return correct ? 100 + (elapsedMs <= 5000 ? 50 : 0) : 0;
}
export function safeRoom(room) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    players: [...room.players.values()].map(({
      id,
      name,
      score,
      connected
    }) => ({
      id,
      name,
      score,
      connected
    })),
    round: room.round,
    questionIndex: room.questionIndex,
    question: room.questionIndex >= 0 && room.status === 'playing' ? ((({
      correct,
      ...q
    }) => q)(room.questions[room.questionIndex])) : null,
    deadline: room.deadline,
    answersReceived: room.status === 'playing' ? Object.keys(room.submissions).length : 0,
    lastRound: room.lastRound,
    winner: room.winner,
    endReason: room.endReason,
    endedBy: room.endedBy,
    serverNow: Date.now()
  };
}

function broadcast(room) {
  const packet = JSON.stringify({
    type: 'state',
    state: safeRoom(room)
  });
  for (const client of room.clients)
    if (client.open) client.send(packet);
}

function roomCode() {
  let s;
  do {
    s = randomBytes(3).toString('hex').toUpperCase()
  } while (rooms.has(s));
  return s;
}

function closeRoom(room) {
  clearTimeout(room.timer);
  rooms.delete(room.code);
}
function finishEarly(room, departedPlayer) {
  if (room.status === 'finished') return;
  clearTimeout(room.timer);
  room.status = 'finished';
  room.deadline = null;
  room.endReason = 'playerLeft';
  room.endedBy = departedPlayer.name;
  const players = [...room.players.values()];
  const highScore = Math.max(0, ...players.map(player => player.score));
  room.winner = players.filter(player => player.score === highScore).map(player => player.name);
  broadcast(room);
  arm(room, () => closeRoom(room), 60 * 60_000);
}

function arm(room, fn, ms) {
  clearTimeout(room.timer);
  room.timer = setTimeout(fn, ms);
  room.timer.unref?.();
}

function beginQuestion(room) {
  room.status = 'playing';
  room.questionIndex++;
  room.round = Math.floor(room.questionIndex / ROUND_SIZE) + 1;
  if (room.questionIndex % ROUND_SIZE === 0)
    for (const p of room.players.values()) p.roundScore = 0;
  room.submissions = {};
  room.questionStarted = Date.now();
  room.deadline = room.questionStarted + QUESTION_MS;
  broadcast(room);
  arm(room, () => finishQuestion(room), QUESTION_MS);
}

function finishQuestion(room) {
  if (room.status !== 'playing') return;
  clearTimeout(room.timer);
  const q = room.questions[room.questionIndex];
  const outcomes = new Map();
  for (const [id, submission] of Object.entries(room.submissions)) {
    const player = room.players.get(id);
    if (player) {
      const correct = Number.isInteger(submission.answer) && Number.isInteger(q.correct) && submission.answer === q.correct;
      const pointsEarned = scoreAnswer(correct, submission.at - room.questionStarted);
      player.score += pointsEarned;
      player.roundScore += pointsEarned;
      outcomes.set(id, {
        answerIndex: submission.answer,
        correct,
        pointsEarned
      });
    }
  }
  room.lastRound = {
    round: room.round,
    question: room.questionIndex % ROUND_SIZE + 1,
    questionText: q.question,
    category: q.category,
    answers: q.answers,
    correctAnswer: q.correct,
    players: [...room.players.values()].map(player => ({
      id: player.id,
      name: player.name,
      score: player.score,
      roundScore: player.roundScore,
      answered: outcomes.has(player.id),
      answerIndex: outcomes.get(player.id)?.answerIndex ?? null,
      correct: outcomes.get(player.id)?.correct ?? false,
      pointsEarned: outcomes.get(player.id)?.pointsEarned ?? 0
    }))
  };
  const roundEnded = (room.questionIndex + 1) % ROUND_SIZE === 0,
    gameEnded = room.questionIndex + 1 === room.questions.length;
  if (gameEnded) {
    room.status = 'finished';
    const hi = Math.max(...[...room.players.values()].map(p => p.score));
    room.winner = [...room.players.values()].filter(p => p.score === hi).map(p => p.name);
    room.deadline = null;
    broadcast(room);
    arm(room, () => closeRoom(room), 60 * 60_000);
    return;
  }
  if (roundEnded) {
    room.status = 'roundResults';
    room.deadline = null;
    room.round = Math.floor(room.questionIndex / ROUND_SIZE) + 1;
    broadcast(room);
    arm(room, () => beginQuestion(room), 5000);
  } else {
    room.status = 'questionResults';
    room.deadline = null;
    broadcast(room);
    arm(room, () => beginQuestion(room), 5000);
  }
}

function sendError(ws, message) {
  ws.send(JSON.stringify({
    type: 'error',
    message
  }));
}

function handle(room, client, msg) {
  let data;
  try {
    data = typeof msg === 'string' ? JSON.parse(msg) : msg;
  } catch {
    return sendError(client, 'That message could not be read.');
  }
  room.lastActivity = Date.now();
  if (data.type === 'join') {
    let name = String(data.name || '').trim().slice(0, 18);
    if (!name) return sendError(client, 'Enter a name to join.');
    const existing = room.players.get(data.playerId);
    if (existing) {
      existing.name = name;
      existing.connected = true;
      room.clients.add(client);
      client.playerId = existing.id;
      client.room = room;
      broadcast(room);
      return;
    }
    if (room.status !== 'lobby') return sendError(client, 'This game has already started. Ask the host for a new room.');
    if (room.players.size >= 4) return sendError(client, 'This room is full (4 players max).');
    const id = randomBytes(9).toString('hex');
    room.players.set(id, {
      id,
      name,
      score: 0,
      roundScore: 0,
      connected: true
    });
    room.clients.add(client);
    client.playerId = id;
    client.room = room;
    if (!room.hostId) room.hostId = id;
    broadcast(room);
    return;
  }
  const player = room.players.get(client.playerId);
  if (!player) return sendError(client, 'Join this room before playing.');
  if (data.type === 'start') {
    if (player.id !== room.hostId) return sendError(client, 'Only the host can start the game.');
    if (room.status !== 'lobby') return sendError(client, 'The game has already started.');
    if (room.players.size < 2) return sendError(client, 'You need at least 2 players to start.');
    room.questions = [...QUESTIONS].sort(() => Math.random() - .5).slice(0, ROUNDS * ROUND_SIZE);
    room.round = 1;
    room.questionIndex = -1;
    beginQuestion(room);
    return;
  }
  if (data.type === 'leave') {
    if (room.status === 'finished') return;
    player.connected = false;
    client.left = true;
    finishEarly(room, player);
    return;
  }
  if (data.type === 'answer') {
    if (room.status !== 'playing') return sendError(client, 'That question is already closed.');
    if (Date.now() > room.deadline) return sendError(client, 'Time is up.');
    if (!Number.isInteger(data.answer) || data.answer < 0 || data.answer > 3) return sendError(client, 'Choose one of the four answers.');
    if (room.submissions[player.id]) return sendError(client, 'Your answer is already locked in.');
    room.submissions[player.id] = {
      answer: data.answer,
      at: Date.now()
    };
    broadcast(room);
    if (room.submissions && room.players.size && [...room.players.keys()].every(id => room.submissions[id])) {
      clearTimeout(room.timer);
      arm(room, () => finishQuestion(room), 700);
    }
    return;
  }
  if (data.type === 'again') {
    if (room.status !== 'finished') return sendError(client, 'This match is still underway.');
    room.status = 'lobby';
    room.questions = [];
    room.questionIndex = -1;
    room.round = 1;
    room.deadline = null;
    room.submissions = {};
    room.lastRound = null;
    room.winner = null;
    room.endReason = null;
    room.endedBy = null;
    for (const p of room.players.values()) {
      p.score = 0;
      p.roundScore = 0;
    }
    broadcast(room);
    return;
  }
  if (data.type === 'ping') {
    client.send(JSON.stringify({
      type: 'pong',
      now: Date.now()
    }));
    return;
  }
  sendError(client, 'Unknown action.');
}

export function createRoom() {
  const room = {
    code: roomCode(),
    status: 'lobby',
    hostId: null,
    players: new Map(),
    clients: new Set(),
    round: 1,
    questionIndex: -1,
    questions: [],
    submissions: {},
    deadline: null,
    lastRound: null,
    winner: null,
    endReason: null,
    endedBy: null,
    timer: null,
    lastActivity: Date.now()
  };
  rooms.set(room.code, room);
  return room.code;
}

export function receiveMessage(client, data) {
  if (data.type === 'joinRoom') {
    const code = String(data.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return sendError(client, 'Room not found. Check the code and try again.');
    return handle(room, client, {
      type: 'join',
      name: data.name,
      playerId: data.playerId
    });
  }
  if (client.room) return handle(client.room, client, data);
  sendError(client, 'Choose a room first.');
}

export function disconnectClient(client) {
  const room = client.room;
  if (!room) return;
  room.clients.delete(client);
  const player = room.players.get(client.playerId);
  if (!player) return;
  const stillConnected = [...room.clients].some(peer => peer.open && peer.playerId === player.id);
  if (stillConnected) return;
  player.connected = false;
  if (room.status !== 'finished' && room.status !== 'lobby') {
    finishEarly(room, player);
    return;
  }
  broadcast(room);
}

export function cleanupExpiredRooms() {
  for (const room of rooms.values()) {
    if (Date.now() - room.lastActivity > 4 * 60 * 60_000) closeRoom(room);
  }
}
