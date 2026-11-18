import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPredictions } from './sentiment.js';

test('sentiment score preserves confidence as moderation points', () => {
  const result = classifyPredictions([
    { label: 'negative', score: 0.83 },
    { label: 'neutral', score: 0.1 },
    { label: 'positive', score: 0.07 },
  ]);

  assert.equal(result.label, 'negative');
  assert.equal(result.score, -83);
  assert.equal(result.negativePoints, 83);
});

test('neutral is retained as a distinct model class', () => {
  const result = classifyPredictions([
    { label: 'negative', score: 0.08 },
    { label: 'neutral', score: 0.84 },
    { label: 'positive', score: 0.08 },
  ]);

  assert.equal(result.label, 'neutral');
  assert.equal(result.score, 0);
  assert.equal(result.negativePoints, 0);
});

test('low-confidence polar predictions are treated as neutral', () => {
  const result = classifyPredictions([
    { label: 'LABEL_0', score: 0.45 },
    { label: 'LABEL_1', score: 0.35 },
    { label: 'LABEL_2', score: 0.2 },
  ]);

  assert.equal(result.label, 'neutral');
  assert.equal(result.confidence, 0.45);
  assert.equal(result.negativePoints, 0);
});
