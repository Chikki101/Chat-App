import { Router } from 'express';
import mongoose from 'mongoose';
import Message from '../models/Message.js';
import protect from '../middleware/auth.js';
import { canAccessConversation, directMessageKey } from '../utils/chatAccess.js';

const router = Router();

async function historyFor(room, res) {
  const limit = Math.min(parseInt(res.req.query.limit, 10) || 50, 100);
  const messages = await Message.find({ room }).sort({ createdAt: -1 }).limit(limit).lean();
  res.json(messages.reverse());
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
    await historyFor(room, res);
  } catch (err) {
    console.error('messages:direct history failed', err);
    res.status(500).json({ message: 'Could not load direct messages' });
  }
});

router.get('/:room', protect, async (req, res) => {
  try {
    if (!(await canAccessConversation(req.user._id, req.params.room))) {
      return res.status(403).json({ message: 'You do not have access to this room' });
    }
    await historyFor(req.params.room, res);
  } catch (err) {
    console.error('messages:history failed', err);
    res.status(500).json({ message: 'Could not load messages' });
  }
});

export default router;
