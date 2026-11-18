import Message from '../models/Message.js';
import { ROOMS } from '../constants.js';

export const PUBLIC_MESSAGE_RETENTION_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

export function publicMessageCutoff(now = Date.now()) {
  return new Date(now - PUBLIC_MESSAGE_RETENTION_MS);
}

export function publicRoomHistoryQuery(room, now = Date.now()) {
  return ROOMS.includes(room)
    ? { room, createdAt: { $gt: publicMessageCutoff(now) } }
    : { room };
}

export function unreadAfter(room, readAt, now = Date.now()) {
  if (!ROOMS.includes(room)) return readAt;
  return new Date(Math.max(readAt.getTime(), publicMessageCutoff(now).getTime()));
}

export function startPublicMessageCleanup(io) {
  let running = false;

  const cleanup = async () => {
    if (running) return;
    running = true;
    try {
      const cutoff = publicMessageCutoff();
      for (const room of ROOMS) {
        const result = await Message.deleteMany({ room, createdAt: { $lte: cutoff } });
        if (result.deletedCount > 0) {
          io.emit('messages:expired', { room, before: cutoff });
        }
      }
    } finally {
      running = false;
    }
  };
  const runCleanup = () => cleanup().catch((err) => console.error('public message cleanup failed', err));

  runCleanup();
  const timer = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
