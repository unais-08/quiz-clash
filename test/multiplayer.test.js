import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { QUESTIONS, server } from '../server.js';

function makeClient(url) {
  const socket = new WebSocket(url), messages = [];
  socket.addEventListener('message', e => { try { messages.push(JSON.parse(e.data)); } catch { } });
  return {
    socket,
    async open() { if (socket.readyState === WebSocket.OPEN) return; await once(socket, 'open'); },
    send(data) { socket.send(JSON.stringify(data)); },
    async waitFor(predicate, timeoutMs = 10_000) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const index = messages.findIndex(predicate);
        if (index >= 0) return messages.splice(index, 1)[0];
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out waiting for a multiplayer state update. Recent messages: ${JSON.stringify(messages.map(m => m.type === 'state' ? [m.state.status, m.state.questionIndex, m.state.answersReceived] : m.type))}`);
    },
    close() { if (socket.readyState < WebSocket.CLOSING) socket.close(); }
  };
}

test('two clients share a question, lock answers, and receive one authoritative score update', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address(), base = `http://127.0.0.1:${port}`;
  let a, b;
  try {
    const response = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Host' }) });
    assert.equal(response.status, 201);
    const { code } = await response.json();
    a = makeClient(`ws://127.0.0.1:${port}/ws`); await a.open(); a.send({ type: 'joinRoom', code, name: 'Host' });
    const lobbyA = await a.waitFor(m => m.type === 'state' && m.state.players.length === 1);
    b = makeClient(`ws://127.0.0.1:${port}/ws`); await b.open(); b.send({ type: 'joinRoom', code, name: 'Guest' });
    const [lobbyB, joinedA] = await Promise.all([
      b.waitFor(m => m.type === 'state' && m.state.players.length === 2),
      a.waitFor(m => m.type === 'state' && m.state.players.length === 2)
    ]);
    assert.equal(lobbyA.state.status, 'lobby');
    assert.equal(lobbyB.state.players.length, 2);
    assert.equal(joinedA.state.players.length, 2);
    const hostId = lobbyA.state.players.find(p => p.name === 'Host').id;
    a.close(); await once(a.socket, 'close');
    a = makeClient(`ws://127.0.0.1:${port}/ws`); await a.open(); a.send({ type: 'joinRoom', code, name: 'Host', playerId: hostId });
    const reconnected = await a.waitFor(m => m.type === 'state' && m.state.players.length === 2 && m.state.players.find(p => p.id === hostId)?.connected);
    assert.equal(reconnected.state.hostId, hostId);
    a.send({ type: 'start' });
    const [gameA, gameB] = await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.status === 'playing'),
      b.waitFor(m => m.type === 'state' && m.state.status === 'playing')
    ]);
    assert.deepEqual(gameA.state.question, gameB.state.question);
    assert.equal(gameA.state.round, 1);
    assert.ok(gameA.state.deadline > Date.now());
    const aId = gameA.state.players.find(p => p.name === 'Host').id;
    const bId = gameA.state.players.find(p => p.name === 'Guest').id;
    const correctIndex = QUESTIONS.find(q => q.question === gameA.state.question.question).correct;
    a.send({ type: 'answer', answer: correctIndex });
    await a.waitFor(m => m.type === 'state' && m.state.answersReceived === 1);
    a.send({ type: 'answer', answer: (correctIndex + 1) % 4 });
    const duplicate = await a.waitFor(m => m.type === 'error');
    assert.match(duplicate.message, /already locked/);
    b.send({ type: 'answer', answer: (correctIndex + 1) % 4 });
    const [resultA, resultB] = await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.status === 'questionResults'),
      b.waitFor(m => m.type === 'state' && m.state.status === 'questionResults')
    ]);
    assert.deepEqual(resultA.state.lastRound, resultB.state.lastRound);
    const correctOutcome = resultA.state.lastRound.players.find(p => p.id === aId);
    const incorrectOutcome = resultA.state.lastRound.players.find(p => p.id === bId);
    assert.equal(correctOutcome.correct, true);
    assert.equal(correctOutcome.answerIndex, correctIndex);
    assert.ok([100, 150].includes(correctOutcome.pointsEarned));
    assert.equal(correctOutcome.score, correctOutcome.pointsEarned);
    assert.equal(incorrectOutcome.correct, false);
    assert.equal(incorrectOutcome.pointsEarned, 0);
    assert.equal(incorrectOutcome.score, 0);
    assert.deepEqual(resultA.state.players.map(({ id, score }) => ({ id, score })), resultB.state.players.map(({ id, score }) => ({ id, score })));

    for (let questionIndex = 1; questionIndex < 15; questionIndex++) {
      const [playingA, playingB] = await Promise.all([
        a.waitFor(m => m.type === 'state' && m.state.status === 'playing' && m.state.questionIndex === questionIndex),
        b.waitFor(m => m.type === 'state' && m.state.status === 'playing' && m.state.questionIndex === questionIndex)
      ]);
      assert.deepEqual(playingA.state.question, playingB.state.question);
      const correctIndexForQuestion = QUESTIONS.find(q => q.question === playingA.state.question.question).correct;
      const hostCorrect = questionIndex !== 1;
      a.send({ type: 'answer', answer: hostCorrect ? correctIndexForQuestion : (correctIndexForQuestion + 1) % 4 });
      b.send({ type: 'answer', answer: hostCorrect ? (correctIndexForQuestion + 1) % 4 : correctIndexForQuestion });
      if (questionIndex < 14) {
        const status = (questionIndex + 1) % 5 === 0 ? 'roundResults' : 'questionResults';
        const [resultA, resultB] = await Promise.all([
          a.waitFor(m => m.type === 'state' && m.state.status === status && m.state.questionIndex === questionIndex),
          b.waitFor(m => m.type === 'state' && m.state.status === status && m.state.questionIndex === questionIndex)
        ]);
        assert.deepEqual(resultA.state.lastRound, resultB.state.lastRound);
        const hostResult = resultA.state.lastRound.players.find(player => player.id === aId);
        const guestResult = resultA.state.lastRound.players.find(player => player.id === bId);
        assert.equal(hostResult.correct, hostCorrect);
        assert.ok(hostCorrect ? [100, 150].includes(hostResult.pointsEarned) : hostResult.pointsEarned === 0);
        assert.equal(guestResult.correct, !hostCorrect);
        assert.ok(hostCorrect ? guestResult.pointsEarned === 0 : [100, 150].includes(guestResult.pointsEarned));
      }
    }
    const [finalA, finalB] = await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.status === 'finished'),
      b.waitFor(m => m.type === 'state' && m.state.status === 'finished')
    ]);
    assert.deepEqual(finalA.state.players.map(({ id, score }) => ({ id, score })), finalB.state.players.map(({ id, score }) => ({ id, score })));
    assert.ok(finalA.state.winner.length >= 1);
    assert.equal(finalA.state.endReason, null);
  } finally {
    a?.close(); b?.close();
    await new Promise(resolve => server.close(resolve));
  }
});



test('manual leave ends the match and broadcasts final scores to both players', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address(), base = `http://127.0.0.1:${port}`;
  let a, b;
  try {
    const response = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Host' }) });
    const { code } = await response.json();
    a = makeClient(`ws://127.0.0.1:${port}/ws`); await a.open(); a.send({ type: 'joinRoom', code, name: 'Host' });
    await a.waitFor(m => m.type === 'state' && m.state.players.length === 1);
    b = makeClient(`ws://127.0.0.1:${port}/ws`); await b.open(); b.send({ type: 'joinRoom', code, name: 'Guest' });
    await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.players.length === 2),
      b.waitFor(m => m.type === 'state' && m.state.players.length === 2)
    ]);
    a.send({ type: 'start' });
    await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.status === 'playing'),
      b.waitFor(m => m.type === 'state' && m.state.status === 'playing')
    ]);
    a.send({ type: 'answer', answer: 0 }); b.send({ type: 'answer', answer: 0 });
    await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.status === 'questionResults'),
      b.waitFor(m => m.type === 'state' && m.state.status === 'questionResults')
    ]);
    b.send({ type: 'leave' });
    const [finalA, finalB] = await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.status === 'finished'),
      b.waitFor(m => m.type === 'state' && m.state.status === 'finished')
    ]);
    assert.equal(finalA.state.endReason, 'playerLeft');
    assert.equal(finalA.state.endedBy, 'Guest');
    assert.deepEqual(finalA.state.players.map(({ id, score }) => ({ id, score })), finalB.state.players.map(({ id, score }) => ({ id, score })));
  } finally {
    a?.close(); b?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('unexpected disconnect ends the active match for the connected player', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address(), base = `http://127.0.0.1:${port}`;
  let a, b, rejoined;
  try {
    const response = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Host' }) });
    const { code } = await response.json();
    a = makeClient(`ws://127.0.0.1:${port}/ws`); await a.open(); a.send({ type: 'joinRoom', code, name: 'Host' });
    await a.waitFor(m => m.type === 'state' && m.state.players.length === 1);
    b = makeClient(`ws://127.0.0.1:${port}/ws`); await b.open(); b.send({ type: 'joinRoom', code, name: 'Guest' });
    await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.players.length === 2),
      b.waitFor(m => m.type === 'state' && m.state.players.length === 2)
    ]);
    a.send({ type: 'start' });
    await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.status === 'playing'),
      b.waitFor(m => m.type === 'state' && m.state.status === 'playing')
    ]);
    b.close(); await once(b.socket, 'close');
    const final = await a.waitFor(m => m.type === 'state' && m.state.status === 'finished');
    assert.equal(final.state.endReason, 'playerLeft');
    assert.equal(final.state.endedBy, 'Guest');
    assert.equal(final.state.players.length, 2);
    assert.ok(final.state.players.every(player => Number.isInteger(player.score)));
    const guest = final.state.players.find(player => player.name === 'Guest');
    rejoined = makeClient(`ws://127.0.0.1:${port}/ws`); await rejoined.open();
    rejoined.send({ type: 'joinRoom', code, name: 'Guest', playerId: guest.id });
    const recovered = await rejoined.waitFor(m => m.type === 'state' && m.state.status === 'finished');
    assert.equal(recovered.state.endReason, 'playerLeft');
    assert.deepEqual(recovered.state.players.map(({ id, score }) => ({ id, score })), final.state.players.map(({ id, score }) => ({ id, score })));
  } finally {
    a?.close(); b?.close(); rejoined?.close();
    await new Promise(resolve => server.close(resolve));
  }
});


test('answer feedback remains synchronized for at least five seconds', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address(), base = `http://127.0.0.1:${port}`;
  let a, b;
  try {
    const response = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Host' }) });
    const { code } = await response.json();
    a = makeClient(`ws://127.0.0.1:${port}/ws`); await a.open(); a.send({ type: 'joinRoom', code, name: 'Host' });
    await a.waitFor(m => m.type === 'state' && m.state.players.length === 1);
    b = makeClient(`ws://127.0.0.1:${port}/ws`); await b.open(); b.send({ type: 'joinRoom', code, name: 'Guest' });
    await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.players.length === 2),
      b.waitFor(m => m.type === 'state' && m.state.players.length === 2)
    ]);
    a.send({ type: 'start' });
    await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.status === 'playing'),
      b.waitFor(m => m.type === 'state' && m.state.status === 'playing')
    ]);
    a.send({ type: 'answer', answer: 0 }); b.send({ type: 'answer', answer: 1 });
    const [feedbackA, feedbackB] = await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.status === 'questionResults'),
      b.waitFor(m => m.type === 'state' && m.state.status === 'questionResults')
    ]);
    assert.deepEqual(feedbackA.state.lastRound, feedbackB.state.lastRound);
    const feedbackShownAt = Date.now();
    const [nextA, nextB] = await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.status === 'playing' && m.state.questionIndex === 1),
      b.waitFor(m => m.type === 'state' && m.state.status === 'playing' && m.state.questionIndex === 1)
    ]);
    assert.ok(Date.now() - feedbackShownAt >= 4800);
    assert.deepEqual(nextA.state.question, nextB.state.question);
  } finally {
    a?.close(); b?.close();
    await new Promise(resolve => server.close(resolve));
  }
});




test('unanswered submissions stay neutral and earn no points for either player', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  let a, b;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Host' }) });
    const { code } = await response.json();
    a = makeClient(`ws://127.0.0.1:${port}/ws`); await a.open(); a.send({ type: 'joinRoom', code, name: 'Host' });
    await a.waitFor(m => m.type === 'state' && m.state.players.length === 1);
    b = makeClient(`ws://127.0.0.1:${port}/ws`); await b.open(); b.send({ type: 'joinRoom', code, name: 'Guest' });
    await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.players.length === 2),
      b.waitFor(m => m.type === 'state' && m.state.players.length === 2)
    ]);
    a.send({ type: 'start' });
    const [gameA, gameB] = await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.status === 'playing'),
      b.waitFor(m => m.type === 'state' && m.state.status === 'playing')
    ]);
    assert.deepEqual(gameA.state.question, gameB.state.question);
    const hostId = gameA.state.players.find(player => player.name === 'Host').id;
    const guestId = gameA.state.players.find(player => player.name === 'Guest').id;
    const correctIndex = QUESTIONS.find(q => q.question === gameA.state.question.question).correct;
    a.send({ type: 'answer', answer: correctIndex });
    const [resultA, resultB] = await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.status === 'questionResults', 20_000),
      b.waitFor(m => m.type === 'state' && m.state.status === 'questionResults', 20_000)
    ]);
    assert.deepEqual(resultA.state.lastRound, resultB.state.lastRound);
    const host = resultA.state.lastRound.players.find(player => player.id === hostId);
    const guest = resultA.state.lastRound.players.find(player => player.id === guestId);
    assert.equal(host.answered, true); assert.equal(host.correct, true); assert.ok([100, 150].includes(host.pointsEarned));
    assert.equal(guest.answered, false); assert.equal(guest.answerIndex, null); assert.equal(guest.correct, false); assert.equal(guest.pointsEarned, 0); assert.equal(guest.score, 0);

    const [nextA, nextB] = await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.status === 'playing' && m.state.questionIndex === 1),
      b.waitFor(m => m.type === 'state' && m.state.status === 'playing' && m.state.questionIndex === 1)
    ]);
    assert.deepEqual(nextA.state.question, nextB.state.question);
    const nextCorrect = QUESTIONS.find(q => q.question === nextA.state.question.question).correct;
    b.send({ type: 'answer', answer: (nextCorrect + 1) % 4 });
    const [secondA, secondB] = await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.status === 'questionResults', 20_000),
      b.waitFor(m => m.type === 'state' && m.state.status === 'questionResults', 20_000)
    ]);
    assert.deepEqual(secondA.state.lastRound, secondB.state.lastRound);
    const unansweredHost = secondA.state.lastRound.players.find(player => player.id === hostId);
    const wrongGuest = secondA.state.lastRound.players.find(player => player.id === guestId);
    assert.equal(unansweredHost.answered, false); assert.equal(unansweredHost.answerIndex, null); assert.equal(unansweredHost.pointsEarned, 0);
    assert.equal(wrongGuest.answered, true); assert.equal(wrongGuest.correct, false); assert.equal(wrongGuest.pointsEarned, 0); assert.equal(wrongGuest.score, 0);
  } finally {
    a?.close(); b?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
