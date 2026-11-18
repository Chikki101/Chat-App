import assert from 'node:assert/strict';
import test from 'node:test';
import Message from './Message.js';

test('system support messages validate without a user sender', async () => {
  const message = new Message({
    room: 'support',
    senderName: 'MoodChat Support',
    system: true,
    text: 'Here is how to create a room.',
  });

  await assert.doesNotReject(message.validate());
  assert.equal(message.sender, null);
});

test('regular messages still require a user sender', async () => {
  const message = new Message({
    room: 'general',
    senderName: 'A user',
    text: 'Hello',
  });

  await assert.rejects(message.validate(), (error) => Boolean(error.errors.sender));
});
