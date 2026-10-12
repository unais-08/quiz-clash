import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTIONS, scoreAnswer, selectQuestions } from '../server.js';

test('correct answers score 100, with a 50 point bonus in the first five seconds', () => {
  assert.equal(scoreAnswer(true, 0), 150);
  assert.equal(scoreAnswer(true, 5000), 150);
  assert.equal(scoreAnswer(true, 5001), 100);
});

test('wrong answers and missing answers score zero', () => {
  assert.equal(scoreAnswer(false, 100), 0);
  assert.equal(scoreAnswer(false, 14000), 0);
});

test('question bank has enough unique four-choice questions for a full match', () => {
  assert.ok(QUESTIONS.length >= 15);
  assert.equal(new Set(QUESTIONS.map(q => q.question.trim().toLocaleLowerCase())).size, QUESTIONS.length);
  for (const q of QUESTIONS) {
    assert.equal(q.answers.length, 4);
    assert.ok(Number.isInteger(q.correct) && q.correct >= 0 && q.correct < 4);
    assert.equal(new Set(q.answers.map(answer => answer.trim().toLocaleLowerCase())).size, 4);
    assert.ok(q.category && q.question.trim());
  }
});

test('each match gets 15 distinct questions without mutating the bank', () => {
  const original = [...QUESTIONS];
  const first = selectQuestions(QUESTIONS, 15, () => 0.37);
  const second = selectQuestions(QUESTIONS, 15, () => 0.83);

  assert.equal(first.length, 15);
  assert.equal(new Set(first).size, 15);
  assert.equal(new Set(first.map(question => question.question)).size, 15);
  assert.deepEqual(QUESTIONS, original);
  assert.notDeepEqual(first, second);
  assert.throws(() => selectQuestions(QUESTIONS, QUESTIONS.length + 1), RangeError);
});
