import positiveIcon from '../assets/positive.svg';
import neutralIcon from '../assets/neutral.svg';
import negativeIcon from '../assets/negative.svg';

export const ICONS = { positive: positiveIcon, neutral: neutralIcon, negative: negativeIcon };

export default function SentimentBadge({ sentiment }) {
  if (!sentiment) return null;
  const { label, score } = sentiment;
  const shown = score > 0 ? `+${score}` : `${score}`;

  return (
    <span className={`badge badge-${label}`} title={`Sentiment score: ${shown}`}>
      <img src={ICONS[label]} alt="" width="16" height="16" />
      <span className="badge-label">{label}</span>
      <small>{shown}</small>
    </span>
  );
}
