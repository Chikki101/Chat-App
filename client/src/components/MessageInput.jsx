import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import SentimentBadge from './SentimentBadge.jsx';

export default function MessageInput({ onSend, onTyping, disabled }) {
  const { token } = useAuth();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const typingTimer = useRef(null);

  // Live tone preview: debounce, then ask the server to analyze the draft
  useEffect(() => {
    if (!text.trim()) {
      setPreview(null);
      setPreviewError('');
      setAnalyzing(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setAnalyzing(true);
      setPreviewError('');
      try {
        const result = await api.analyze(text, token);
        if (!cancelled) setPreview(result);
      } catch (error) {
        if (!cancelled) setPreviewError(error.message);
      } finally {
        if (!cancelled) setAnalyzing(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text, token]);

  const handleChange = (e) => {
    setText(e.target.value);
    setPreview(null);
    setPreviewError('');
    onTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => onTyping(false), 1500);
  };

  const submit = (e) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    setPreview(null);
    clearTimeout(typingTimer.current);
    onTyping(false);
  };

  return (
    <form className="composer" onSubmit={submit}>
      <div className="live-preview">
        {preview ? (
          <>
            <span>Live tone:</span>
            <SentimentBadge sentiment={preview} />
          </>
        ) : (
          <span className={previewError ? 'preview-error' : 'hint'}>
            {analyzing
              ? 'Analyzing with the local sentiment model…'
              : previewError || "Start typing: we'll read the tone of your message live"}
          </span>
        )}
      </div>
      <div className="composer-row">
        <input
          value={text}
          onChange={handleChange}
          placeholder="Write a message…"
          maxLength={500}
          autoFocus
        />
        <button type="submit" className="send" disabled={disabled || !text.trim()}>
          Send
        </button>
      </div>
    </form>
  );
}
