import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTIONS, scoreAnswer } from '../server.js';

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
  assert.equal(new Set(QUESTIONS.map(q => q.question)).size, QUESTIONS.length);
  for (const q of QUESTIONS) {
    assert.equal(q.answers.length, 4);
    assert.ok(q.correct >= 0 && q.correct < 4);
  }
});
