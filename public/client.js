const $ = s => document.querySelector(s), app = $('#app'), roomEl = $('#room-screen'), toast = $('#toast'); let ws = null, state = null, playerId = sessionStorage.getItem('qc-player'), roomCode = null, lastToast = '', timerInterval = null, leaving = false;
function notify(message) { if (message === lastToast) return; lastToast = message; toast.textContent = message; toast.classList.remove('hidden'); setTimeout(() => { toast.classList.add('hidden'); lastToast = '' }, 3500) }
async function createRoom() { const name = $('#create-name').value.trim(); if (!name) return notify('Add your name first.'); const btn = $('#create'); btn.disabled = true; btn.textContent = 'CREATING ROOM…'; try { const res = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); const data = await res.json(); if (!res.ok) throw Error(data.error); connect(data.code, name); } catch (e) { notify(e.message || 'Could not create a room. Try again.') } finally { btn.disabled = false; btn.innerHTML = 'CREATE A ROOM <span>↗</span>' } }
function connect(code, name) { leaving = false; roomCode = code.toUpperCase(); document.body.classList.add('in-room'); const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'; ws = new WebSocket(`${scheme}//${location.host}/ws`); $('#create').disabled = true; $('#join').disabled = true; roomEl.classList.remove('hidden'); roomEl.innerHTML = `<div class="loading"><span class="spinner"></span> CONNECTING TO ROOM ${roomCode}…</div>`; ws.onopen = () => ws.send(JSON.stringify({ type: 'joinRoom', code: roomCode, name, playerId })); ws.onmessage = e => { let m; try { m = JSON.parse(e.data) } catch { return notify('Malformed server message: ' + String(e.data).slice(0, 90)) } if (m.type === 'error') { notify(m.message); if (m.message.startsWith('Room not found')) reset(); return } if (m.type === 'state') { state = m.state; const me = state.players.find(p => p.id === playerId); if (!me) { playerId = state.players.at(-1)?.id; if (playerId) sessionStorage.setItem('qc-player', playerId) } render() } }; ws.onclose = () => { if (!leaving && state?.status !== 'finished') notify('Connection lost. Refresh to reconnect to your room.') } }
function send(type, extra = {}) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...extra })); else notify('Reconnecting… give it a moment.') }
function reset() {
  ws?.close(); ws = null; state = null; roomCode = null;
  clearInterval(timerInterval); document.body.classList.remove('in-room', 'in-game');
  roomEl.classList.add('hidden'); $('#create').disabled = false; $('#join').disabled = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function codeBox() { return `<div class="room-code-box" id="copy-code" title="Tap to copy"><span class="room-code-label">ROOM CODE · TAP TO COPY</span><span class="room-code">${roomCode}</span></div>` }
function playerRows() { return state.players.map((p, i) => `<div class="player-row ${p.connected ? '' : 'offline'}"><span class="avatar">${esc(p.name.slice(0, 1).toUpperCase())}</span><span class="player-name">${esc(p.name)}${p.id === state.hostId ? '<span class="host-tag">HOST</span>' : ''}${p.id === playerId ? '<span class="host-tag" style="color:#999">YOU</span>' : ''}</span><span class="online-dot"></span></div>`).join('') }
function commonHead(title) {
  const leave = state.status === 'lobby' ? '' : state.status === 'finished' ? '<button class="button button-outline leave-button" id="exit-match">RETURN TO MENU</button>' : '<button class="button button-danger leave-button" id="leave-match">LEAVE MATCH <span>↗</span></button>';
  return `<div class="room-head"><div><span class="eyebrow">${title}</span><h2>Room <em>${roomCode}</em></h2></div><div class="room-head-actions">${codeBox()}${leave}</div></div>`;
}
function lobby() { const host = playerId === state.hostId; return `${commonHead('THE CALM BEFORE THE CLASH')}<div class="lobby-content"><section class="panel"><h3 class="panel-title">PLAYERS <span style="color:var(--lime)">${state.players.length}/4</span></h3>${playerRows()}${state.players.length < 4 ? '<div class="loading"><span class="spinner"></span> WAITING FOR YOUR PEOPLE…</div>' : ''}</section><aside class="panel"><h3 class="panel-title">THE GAME PLAN</h3><p class="waiting-copy"><strong>3 rounds. 5 questions each.</strong><br>Correct answers earn 100 pts. Answer in 5 seconds for a +50 speed bonus. You get 15 seconds to lock in your answer.</p><div class="room-action">${host ? `<button class="button button-primary" id="start" ${state.players.length < 2 ? 'disabled' : ''}>${state.players.length < 2 ? 'WAITING FOR PLAYERS' : 'START THE GAME'} <span>↗</span></button>` : '<p class="micro">The host will start the game soon…</p>'}</div></aside></div>` }
function playing() {
  const locked = window._answeredQuestion === `${state.round}-${state.questionIndex}`;
  const q = state.question;
  return `${commonHead('LIVE GAME')}<div class="game-top"><span class="round-tag">ROUND ${state.round} / 3 <span style="color:#999">· Q${(state.questionIndex % 5) + 1} / 5</span></span><div class="timer-wrap"><div><div class="timer-label">TIME LEFT</div><div class="timer" id="timer">15</div></div></div></div><div class="score-strip">${state.players.slice().sort((a, b) => b.score - a.score).map(x => `<div class="score-chip">${esc(x.name)}${x.id === playerId ? ' · YOU' : ''}<b>${x.score}</b></div>`).join('')}</div><div class="progress"><div class="progress-fill" id="progress-fill"></div></div><section class="question-card"><span class="category">${esc(q.category)} / QUESTION ${state.questionIndex + 1}</span><h2 class="question-title">${esc(q.question)}</h2><div class="answers">${q.answers.map((a, i) => `<button class="answer ${locked && window._lastAnswer === i ? 'selected' : ''}" data-answer="${i}" ${locked ? 'disabled' : ''}><span class="answer-key">${'ABCD'[i]}</span>${esc(a)}</button>`).join('')}</div>${locked ? '<div class="feedback"><strong>ANSWER LOCKED.</strong> Nice. Hang tight for the reveal.</div>' : `<div class="feedback">${state.answersReceived} / ${state.players.length} players locked in.</div>`}</section>`;
}
function displayScore(value) {
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 ? Math.floor(score) : 0;
}
function answerReveal() {
  const reveal = state.lastRound;
  if (!reveal || !Array.isArray(reveal.players)) return '';
  const correctAnswer = reveal.answers?.[reveal.correctAnswer] ?? '—';
  const rows = reveal.players.map((player, index) => {
    const answered = Boolean(player.answered);
    const answerIndex = Number.isInteger(player.answerIndex) ? player.answerIndex : null;
    const correct = answered && player.correct === true;
    const points = displayScore(player.pointsEarned);
    const score = displayScore(player.score);
    const answer = answerIndex === null ? 'No answer submitted' : reveal.answers?.[answerIndex] ?? 'Answer submitted';
    const tone = answered ? correct ? 'correct' : 'incorrect' : 'pending';
    const icon = answered ? correct ? '✓' : '✗' : '–';
    const status = answered ? correct ? 'Correct!' : 'Incorrect' : 'No answer submitted';
    const submittedText = answered ? `Your answer: ${answer}` : 'No answer submitted';
    return `<div class="answer-feedback-row feedback-${tone}" style="--row:${index}"><span class="feedback-mark" aria-hidden="true">${icon}</span><div class="feedback-copy"><div class="feedback-player-name"><strong>${esc(player.name)}</strong>${player.id === playerId ? '<span class="host-tag">YOU</span>' : ''}<span class="feedback-status">${status}</span></div><span class="feedback-submitted">${esc(submittedText)}</span></div><div class="feedback-points"><strong>+${points}</strong><span>points</span></div><div class="feedback-total"><span>TOTAL</span><strong>${score}</strong></div></div>`;
  }).join('');
  return `<section class="answer-feedback" aria-live="polite"><div class="answer-feedback-heading"><span class="eyebrow">ROUND ${displayScore(reveal.round)} · QUESTION ${displayScore(reveal.question)}</span><h2>${esc(reveal.questionText || 'Answer feedback')}</h2></div><p class="feedback-correct-answer">Correct answer: <strong>${esc(correctAnswer)}</strong></p><div class="answer-feedback-list">${rows}</div></section>`;
}
function questionFeedback() {
  return `${commonHead('ANSWER REVEAL')}<div class="question-results">${answerReveal()}<p class="feedback-next"><span class="spinner"></span> NEXT QUESTION COMING UP…</p></div>`;
}
function results(final) {
  const sourcePlayers = state.endReason
    ? state.players.map(player => ({ ...player, roundScore: 0 }))
    : state.lastRound?.players || state.players.map(player => ({ ...player, roundScore: 0 }));
  const rows = [...sourcePlayers].sort((a, b) => b.score - a.score);
  const me = rows.find(player => player.id === playerId);
  const highScore = rows[0]?.score ?? 0;
  const interrupted = final && state.endReason === 'playerLeft';
  const winnerText = state.winner?.length > 1
    ? 'Well played, everyone. A tie at the top!'
    : `<strong>${esc(state.winner?.[0] || '')}</strong> takes the crown.`;
  const finalRows = rows.map((player, index) => {
    const isWinner = player.score === highScore;
    return `<div class="result-line"><span class="result-rank">${String(index + 1).padStart(2, '0')}${isWinner ? '<span class="winner-mark">✳</span>' : ''}</span><span>${esc(player.name)}${player.id === playerId ? ' <span class="host-tag">YOU</span>' : ''}</span><span class="result-score">${player.score}</span><span class="result-delta">${state.winner?.length > 1 && isWinner ? 'TIE' : isWinner ? 'WINNER' : '—'}</span></div>`;
  }).join('');
  const roundRows = rows.map((player, index) => `<div class="result-line"><span class="result-rank">${String(index + 1).padStart(2, '0')}${index === 0 ? '<span class="winner-mark">✳</span>' : ''}</span><span>${esc(player.name)}${player.id === playerId ? ' <span class="host-tag">YOU</span>' : ''}</span><span class="result-score">${player.score}</span><span class="result-delta">+${player.roundScore || 0}</span></div>`).join('');
  return `${commonHead(interrupted ? 'MATCH ENDED EARLY' : final ? 'THE FINAL COUNTDOWN' : 'ROUND COMPLETE')}${!interrupted ? answerReveal() : ''}<section class="results">${interrupted ? `<span class="eyebrow departure-note">MATCH ENDED · ${esc(state.endedBy || 'A player')} LEFT</span>` : `<span class="eyebrow">${final ? 'THAT’S A WRAP' : 'ROUND ' + state.lastRound?.round + ' RESULTS'}</span>`}<h2>${final ? (state.winner?.length > 1 ? 'IT’S A TIE.' : interrupted ? 'MATCH OVER.' : 'THE WINNER IS…') : `ROUND ${state.lastRound?.round}<em> IN THE BOOKS.</em>`}</h2><p class="results-sub">${final ? 'FINAL LEADERBOARD · FINAL SCORES' : 'LEADERBOARD · TOTAL SCORE + POINTS THIS ROUND'}</p><div class="result-card"><div class="result-line head"><span>RANK</span><span>PLAYER</span><span style="text-align:right">${final ? 'SCORE' : 'TOTAL'}</span><span style="text-align:right">${final ? 'RESULT' : 'THIS ROUND'}</span></div>${final ? finalRows : roundRows}</div>${final ? `<p class="waiting-copy">${interrupted ? `The match ended because <strong>${esc(state.endedBy || 'a player')}</strong> left. ${winnerText}` : winnerText}</p>${!interrupted && playerId === state.hostId ? '<button class="button button-primary" id="again" style="max-width:260px;margin-top:20px">PLAY AGAIN <span>↗</span></button>' : !interrupted ? '<p class="micro">The host can start another game.</p>' : ''}` : `<p class="waiting-copy">${me ? `You’re at <strong>${me.score} points</strong>. ${me.score > 0 ? 'Keep that momentum.' : 'There’s still plenty of time to climb.'}` : 'Get ready for the next round!'}</p>`}</section>`;
}
function render() {
  if (!state) return;
  document.body.classList.add('in-room');
  document.body.classList.toggle('in-game', state.status !== 'lobby');
  const html = state.status === 'lobby' ? lobby() : state.status === 'playing' ? playing() : state.status === 'questionResults' ? questionFeedback() : results(state.status === 'finished');
  roomEl.innerHTML = html; roomEl.classList.remove('hidden');
  $('#copy-code')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(roomCode); notify('Room code copied. Send it to your crew.') } catch { notify(`Share this room code: ${roomCode}`) } });
  $('#start')?.addEventListener('click', () => send('start'));
  $('#again')?.addEventListener('click', () => { window._answeredQuestion = null; send('again') });
  $('#leave-match')?.addEventListener('click', () => $('#leave-confirm').showModal());
  document.querySelectorAll('.answer:not(:disabled)').forEach(b => b.addEventListener('click', () => { const n = Number(b.dataset.answer); window._answeredQuestion = `${state.round}-${state.questionIndex}`; window._lastAnswer = n; send('answer', { answer: n }); }));
  if (state.status === 'playing') runTimer(); else clearInterval(timerInterval);
}
function leaveMatch() {
  $('#leave-confirm').close();
  if (ws?.readyState === WebSocket.OPEN) {
    send('leave');
    notify('Match ended. Final scores are ready.');
    return;
  }
  exitMatch();
}
function exitMatch() {
  leaving = true;
  const connection = ws; ws = null; state = null; roomCode = null; playerId = null;
  sessionStorage.removeItem('qc-player'); clearInterval(timerInterval); connection?.close(1000, 'left match');
  document.body.classList.remove('in-room', 'in-game'); roomEl.classList.add('hidden');
  $('#create').disabled = false; $('#join').disabled = false;
  window.scrollTo({ top: 0, behavior: 'smooth' }); notify('You left the match.');
}
function runTimer() { clearInterval(timerInterval); const tick = () => { if (!state || state.status !== 'playing') return; const remain = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)), t = $('#timer'), bar = $('#progress-fill'); if (t) { t.textContent = remain; t.classList.toggle('low', remain <= 5) } if (bar) bar.style.width = `${Math.max(0, (state.deadline - Date.now()) / 150)}%`; if (window._answeredQuestion !== `${state.round}-${state.questionIndex}` && Date.now() > state.deadline) window._answeredQuestion = `${state.round}-${state.questionIndex}` }; tick(); timerInterval = setInterval(tick, 180) }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }
$('#create').addEventListener('click', createRoom); $('#join').addEventListener('click', () => { const name = $('#join-name').value.trim(), code = $('#room-code').value.trim(); if (!name) return notify('Add your name first.'); if (code.length !== 6) return notify('Room codes are 6 characters long.'); connect(code, name) }); $('#room-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }); $('#rules-open').addEventListener('click', () => $('#rules').showModal()); $('#rules-close').addEventListener('click', () => $('#rules').close()); $('#rules-got-it').addEventListener('click', () => $('#rules').close()); document.addEventListener('keydown', e => { if (state?.status === 'playing' && !e.repeat && '1234abcd'.includes(e.key.toLowerCase())) { const i = '1234abcd'.indexOf(e.key.toLowerCase()) % 4; document.querySelector(`[data-answer="${i}"]`)?.click() } });


$('#leave-confirm-cancel').addEventListener('click', () => $('#leave-confirm').close());
$('#leave-confirm-x').addEventListener('click', () => $('#leave-confirm').close());
$('#leave-confirm-yes').addEventListener('click', leaveMatch);

window.addEventListener('beforeunload', event => {
  if (!state || !['playing', 'questionResults', 'roundResults'].includes(state.status)) return;
  event.preventDefault();
  event.returnValue = '';
});
