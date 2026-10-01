import { env, pipeline } from '@huggingface/transformers';
import { homedir } from 'os';
import path from 'path';
import Sentiment from 'sentiment';

const MODEL = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
const MIN_CONFIDENCE = 0.95;
const analyzer = new Sentiment();
const EXTRAS = { lit: 3, fire: 2, goat: 3, cringe: -3, meh: -1, ugh: -2, thx: 2, ghosted: -2, buggy: -2 };
env.cacheDir = process.env.SENTIMENT_CACHE_DIR || path.join(homedir(), '.cache', 'moodchat', 'transformers');
let classifierPromise;

function getClassifier() {
  classifierPromise ??= pipeline('text-classification', MODEL, { dtype: 'q8' });
  return classifierPromise;
}

export async function analyze(text) {
  const input = String(text || '').slice(0, 500);
  const classifier = await getClassifier();
  const output = await classifier(input, { top_k: null });
  const predictions = Array.isArray(output[0]) ? output[0] : output;
  const scores = new Map(predictions.map(({ label, score }) => [label.toUpperCase(), score]));
  const positive = scores.get('POSITIVE') ?? 0;
  const negative = scores.get('NEGATIVE') ?? 0;
  const modelLabel = positive >= negative ? 'positive' : 'negative';
  const confidence = Math.max(positive, negative);
  const lexical = analyzer.analyze(input, { extras: EXTRAS });
  const label = confidence >= MIN_CONFIDENCE && lexical.score !== 0 ? modelLabel : 'neutral';

  return {
    label,
    score: label === 'positive' ? Math.round(positive * 100) : label === 'negative' ? -Math.round(negative * 100) : 0,
    comparative: Number((positive - negative).toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    negativePoints: label === 'negative' ? Math.round(negative * 100) : 0,
    positiveWords: lexical.positive,
    negativeWords: lexical.negative,
  };
}
