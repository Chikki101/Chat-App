import { Router } from 'express';
import mongoose from 'mongoose';
import Message from '../models/Message.js';
import ChatRoom from '../models/ChatRoom.js';
import ConversationRead from '../models/ConversationRead.js';
import Friendship from '../models/Friendship.js';
import protect from '../middleware/auth.js';
import { canAccessConversation, directMessageKey, privateRoomKey } from '../utils/chatAccess.js';
import { blockedUserIds } from '../utils/blocks.js';
import { ROOMS } from '../constants.js';

const router = Router();

async function historyFor(room, userId, res) {
  const limit = Math.min(parseInt(res.req.query.limit, 10) || 50, 100);
  const messages = await Message.find({ room }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
  const senderIds = messages.map((message) => message.sender).filter(Boolean);
  const hiddenIds = await blockedUserIds(userId, senderIds);
  res.json(messages.filter((message) => !hiddenIds.has(String(message.sender))).reverse());
}

router.get('/dm/:userId', protect, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }
    const room = directMessageKey(req.user._id, req.params.userId);
    if (!(await canAccessConversation(req.user._id, room))) {
      return res.status(403).json({ message: 'You must both accept a friend request before messaging' });
    }
    await historyFor(room, req.user._id, res);
  } catch (err) {
    console.error('messages:direct history failed', err);
    res.status(500).json({ message: 'Could not load direct messages' });
  }
});

router.get('/unread', protect, async (req, res) => {
  try {
    const [privateRooms, friendships] = await Promise.all([
      ChatRoom.find({ members: req.user._id, deleting: { $ne: true } }).select('_id'),
      Friendship.find({
        status: 'accepted',
        $or: [{ from: req.user._id }, { to: req.user._id }],
      }).select('from to'),
    ]);
    const friendIds = friendships.map((friendship) =>
      String(friendship.from) === String(req.user._id) ? friendship.to : friendship.from
    );
    const blockedIds = await blockedUserIds(req.user._id, friendIds);
    const rooms = [
      ...ROOMS,
      ...privateRooms.map((privateRoom) => privateRoomKey(privateRoom._id)),
      ...friendIds
        .filter((friendId) => !blockedIds.has(String(friendId)))
        .map((friendId) => directMessageKey(req.user._id, friendId)),
    ];
    const existingReads = await ConversationRead.find({
      user: req.user._id,
      room: { $in: rooms },
    }).select('room readAt').lean();
    const readByRoom = new Map(existingReads.map((entry) => [entry.room, entry.readAt]));
    const hiddenIds = await blockedUserIds(req.user._id);
    const now = new Date();
    const missingReads = rooms.filter((room) => !readByRoom.has(room));
    if (missingReads.length) {
      await Promise.all(missingReads.map(async (room) => {
        try {
          await ConversationRead.updateOne(
            { user: req.user._id, room },
            { $setOnInsert: { readAt: now } },
            { upsert: true }
          );
        } catch (err) {
          if (err.code !== 11000) throw err;
        }
      }));
      const initializedReads = await ConversationRead.find({
        user: req.user._id,
        room: { $in: missingReads },
      }).select('room readAt').lean();
      for (const entry of initializedReads) readByRoom.set(entry.room, entry.readAt);
      if (missingReads.some((room) => !readByRoom.has(room))) {
        throw new Error('Unread state could not be initialized for every conversation');
      }
    }

    const asOf = new Date();
    const counts = await Promise.all(
      rooms.map(async (room) => [
        room,
        await Message.countDocuments({
          room,
          sender: { $ne: req.user._id, $nin: [...hiddenIds] },
          createdAt: { $gt: readByRoom.get(room), $lte: asOf },
        }),
      ])
    );
    res.json({ unread: Object.fromEntries(counts), asOf });
  } catch (err) {
    console.error('messages:unread counts failed', err);
    res.status(500).json({ message: 'Could not load unread message counts' });
  }
});

router.post('/read', protect, async (req, res) => {
  try {
    const room = req.body?.room;
    if (typeof room !== 'string' || room.length > 100) {
      return res.status(400).json({ message: 'Invalid conversation' });
    }
    if (!(await canAccessConversation(req.user._id, room))) {
      return res.status(403).json({ message: 'You do not have access to this conversation' });
    }
    await ConversationRead.findOneAndUpdate(
      { user: req.user._id, room },
      { $set: { readAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('messages:mark read failed', err);
    res.status(500).json({ message: 'Could not mark conversation as read' });
  }
});

router.get('/:room', protect, async (req, res) => {
  try {
    if (!(await canAccessConversation(req.user._id, req.params.room))) {
      return res.status(403).json({ message: 'You do not have access to this room' });
    }
    await historyFor(req.params.room, req.user._id, res);
  } catch (err) {
    console.error('messages:history failed', err);
    res.status(500).json({ message: 'Could not load messages' });
  }
});

export default router;
