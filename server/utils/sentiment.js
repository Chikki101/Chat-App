import { env, pipeline } from '@huggingface/transformers';
import { homedir } from 'os';
import path from 'path';

const MODEL = 'Xenova/twitter-roberta-base-sentiment-latest';
const MIN_CONFIDENCE = 0.5;
env.cacheDir = process.env.SENTIMENT_CACHE_DIR || path.join(homedir(), '.cache', 'moodchat', 'transformers');
let classifierPromise;

function getClassifier() {
  if (!classifierPromise) {
    classifierPromise = pipeline('text-classification', MODEL, { dtype: 'q8' }).catch((error) => {
      classifierPromise = undefined;
      throw error;
    });
  }
  return classifierPromise;
}

function normalizeLabel(label) {
  const normalized = String(label).toLowerCase();
  if (normalized === 'label_0') return 'negative';
  if (normalized === 'label_1') return 'neutral';
  if (normalized === 'label_2') return 'positive';
  return normalized;
}

export function classifyPredictions(predictions) {
  if (!Array.isArray(predictions) || predictions.length === 0) {
    throw new Error('Sentiment model returned no class predictions');
  }
  const scores = new Map(
    predictions.map(({ label, score }) => [normalizeLabel(label), Number(score) || 0])
  );
  const positive = scores.get('positive') ?? 0;
  const neutral = scores.get('neutral') ?? 0;
  const negative = scores.get('negative') ?? 0;
  const ranked = [
    ['positive', positive],
    ['neutral', neutral],
    ['negative', negative],
  ].sort((first, second) => second[1] - first[1]);
  const [modelLabel, confidence] = ranked[0];
  const label = confidence > MIN_CONFIDENCE ? modelLabel : 'neutral';

  return {
    label,
    score: label === 'positive' ? Math.round(positive * 100) : label === 'negative' ? -Math.round(negative * 100) : 0,
    comparative: Number((positive - negative).toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    negativePoints: label === 'negative' ? Math.round(negative * 100) : 0,
  };
}

export async function analyze(text) {
  const input = String(text || '')
    .slice(0, 500)
    .replace(/(^|\s)@[a-z\d_]{1,30}\b/gi, '$1@user')
    .replace(/https?:\/\/\S+/gi, 'http');
  const classifier = await getClassifier();
  const output = await classifier(input, { top_k: null });
  const predictions = Array.isArray(output[0]) ? output[0] : output;
  return classifyPredictions(predictions);
}
