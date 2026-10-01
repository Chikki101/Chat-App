import { ICONS } from './SentimentBadge.jsx';

// Summarises the sentiment of the messages currently loaded in the room
export default function MoodSummary({ messages }) {
  const counts = { positive: 0, neutral: 0, negative: 0 };
  messages.forEach((m) => {
    counts[m.sentiment?.label || 'neutral'] += 1;
  });
  const total = messages.length;

  let overall = 'neutral';
  if (total > 0) {
    const net = (counts.positive - counts.negative) / total;
    if (net > 0.15) overall = 'positive';
    else if (net < -0.15) overall = 'negative';
  }
  const pct = (n) => (total ? (n / total) * 100 : 0);

  return (
    <div className="mood">
      <div className="mood-head">
        <img src={ICONS[overall]} alt="" width="22" height="22" />
        <span>
          Room mood: <strong className={`text-${overall}`}>{total ? overall : 'no data yet'}</strong>
        </span>
      </div>
      <div className="mood-bar" aria-hidden="true">
        <div className="seg seg-positive" style={{ width: `${pct(counts.positive)}%` }} />
        <div className="seg seg-neutral" style={{ width: `${pct(counts.neutral)}%` }} />
        <div className="seg seg-negative" style={{ width: `${pct(counts.negative)}%` }} />
      </div>
      <div className="mood-legend">
        <span className="text-positive">{counts.positive} positive</span>
        <span className="text-neutral">{counts.neutral} neutral</span>
        <span className="text-negative">{counts.negative} negative</span>
      </div>
    </div>
  );
}
