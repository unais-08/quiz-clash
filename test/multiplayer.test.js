import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { server } from '../server.js';

function makeClient(url) {
  const socket = new WebSocket(url), messages = [];
  socket.addEventListener('message', e => { try { messages.push(JSON.parse(e.data)); } catch { } });
  return {
    socket,
    async open() { if (socket.readyState === WebSocket.OPEN) return; await once(socket, 'open'); },
    send(data) { socket.send(JSON.stringify(data)); },
    async waitFor(predicate, timeoutMs = 4000) {
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
    a.send({ type: 'answer', answer: 0 });
    await a.waitFor(m => m.type === 'state' && m.state.answersReceived === 1);
    a.send({ type: 'answer', answer: 1 });
    const duplicate = await a.waitFor(m => m.type === 'error');
    assert.match(duplicate.message, /already locked/);
    b.send({ type: 'answer', answer: 0 });
    const [resultA, resultB] = await Promise.all([
      a.waitFor(m => m.type === 'state' && m.state.status === 'questionResults'),
      b.waitFor(m => m.type === 'state' && m.state.status === 'questionResults')
    ]);
    assert.deepEqual(resultA.state.lastRound, resultB.state.lastRound);
    assert.ok(resultA.state.lastRound.players.find(p => p.id === aId).score >= 0);
  } finally {
    a?.close(); b?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
