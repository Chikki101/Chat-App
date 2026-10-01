import SentimentBadge from './SentimentBadge.jsx';

export default function MessageBubble({ message, isOwn }) {
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const tone = message.sentiment?.label || 'neutral';

  return (
    <div className={`msg ${isOwn ? 'own' : ''} tone-${tone}`}>
      {!isOwn && (
        <div className="avatar" style={{ background: message.senderColor }}>
          {message.senderName?.[0]?.toUpperCase()}
        </div>
      )}
      <div className="bubble">
        <div className="meta">
          {!isOwn && <strong>{message.senderName}</strong>}
          <span>{time}</span>
        </div>
        <p>{message.text}</p>
        <SentimentBadge sentiment={message.sentiment} />
      </div>
    </div>
  );
}
