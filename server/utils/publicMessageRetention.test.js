import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PUBLIC_MESSAGE_RETENTION_MS,
  publicMessageCutoff,
  publicRoomHistoryQuery,
  unreadAfter,
} from './publicMessageRetention.js';

test('public room history excludes messages at least 24 hours old', () => {
  const now = Date.parse('2026-11-18T12:00:00.000Z');
  const cutoff = publicMessageCutoff(now);

  assert.equal(now - cutoff.getTime(), PUBLIC_MESSAGE_RETENTION_MS);
  assert.deepEqual(publicRoomHistoryQuery('general', now), {
    room: 'general',
    createdAt: { $gt: cutoff },
  });
  assert.deepEqual(publicRoomHistoryQuery('random', now), {
    room: 'random',
    createdAt: { $gt: cutoff },
  });
});

test('private conversation history is not subject to public-room expiration', () => {
  assert.deepEqual(publicRoomHistoryQuery('private:room-id', 0), {
    room: 'private:room-id',
  });
});

test('unread counts start after the public message expiry cutoff', () => {
  const now = Date.parse('2026-11-18T12:00:00.000Z');
  const cutoff = publicMessageCutoff(now);

  assert.equal(unreadAfter('general', new Date(now - 48 * 60 * 60 * 1000), now).getTime(), cutoff.getTime());
  assert.equal(unreadAfter('random', new Date(now - 12 * 60 * 60 * 1000), now).getTime(), now - 12 * 60 * 60 * 1000);
  assert.equal(unreadAfter('private:room-id', new Date(0), now).getTime(), 0);
});
