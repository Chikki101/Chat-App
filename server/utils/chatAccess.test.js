import assert from 'node:assert/strict';
import test from 'node:test';
import { ROOMS } from '../constants.js';
import { canAccessConversation, supportRoomKey } from './chatAccess.js';

const ownerId = '0123456789abcdef01234567';
const otherUserId = 'abcdef0123456789abcdef01';

test('only general and random are public rooms', async () => {
  assert.deepEqual(ROOMS, ['general', 'random']);
  assert.equal(await canAccessConversation(ownerId, 'general'), true);
  assert.equal(await canAccessConversation(ownerId, 'random'), true);
  assert.equal(await canAccessConversation(ownerId, 'support'), false);
});

test('support history is restricted to its owner', async () => {
  const supportRoom = supportRoomKey(ownerId);

  assert.equal(await canAccessConversation(ownerId, supportRoom), true);
  assert.equal(await canAccessConversation(otherUserId, supportRoom), false);
  assert.equal(await canAccessConversation(ownerId, supportRoomKey('not-an-id')), false);
});
