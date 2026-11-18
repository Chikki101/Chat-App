import assert from 'node:assert/strict';
import test from 'node:test';
import { answerSupportQuestion } from './supportAnswers.js';

test('answers room setup and invite questions', () => {
  assert.match(answerSupportQuestion('How do I create a room?'), /Private rooms/);
  assert.match(answerSupportQuestion('How do I invite someone?'), /invitation link/);
});

test('answers ban and unban questions with creator controls', () => {
  const answer = answerSupportQuestion('How can I get unbanned from a room?');
  assert.match(answer, /creator can unban/i);
});

test('answers mutual friend and direct message questions', () => {
  assert.match(answerSupportQuestion('How do I message a friend?'), /both people must accept/i);
});

test('provides a useful topic list for unmatched questions', () => {
  assert.match(answerSupportQuestion('What is MoodChat?'), /creating rooms/);
});
