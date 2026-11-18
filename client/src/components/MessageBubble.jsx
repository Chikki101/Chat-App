import SentimentBadge from './SentimentBadge.jsx';

export default function MessageBubble({ message, isOwn, onOpenProfile }) {
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
          {!isOwn && (
            <button className="message-profile-link" onClick={() => onOpenProfile(message.sender)}>
              {message.senderName}
            </button>
          )}
          <span>{time}</span>
        </div>
        <p>{message.text}</p>
        <SentimentBadge sentiment={message.sentiment} />
      </div>
    </div>
  );
}
