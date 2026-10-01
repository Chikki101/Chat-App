import { Router } from 'express';
import mongoose from 'mongoose';
import Friendship from '../models/Friendship.js';
import User from '../models/User.js';
import protect from '../middleware/auth.js';

const router = Router();
const userSummary = (user) => ({
  id: String(user._id),
  username: user.username,
  avatarColor: user.avatarColor,
});
const notifyFriends = (io, userIds) => {
  if (!io) return;
  for (const userId of userIds) io.to(`user:${userId}`).emit('friends:changed');
};

router.use(protect);

router.get('/search/:userId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ message: 'Enter a valid user ID' });
    }
    if (String(req.user._id) === req.params.userId) {
      return res.status(400).json({ message: 'That is your own user ID' });
    }
    const user = await User.findById(req.params.userId).select('username avatarColor');
    if (!user) return res.status(404).json({ message: 'User not found' });
    const request = await Friendship.findOne({
      $or: [
        { from: req.user._id, to: user._id },
        { from: user._id, to: req.user._id },
      ],
    });
    res.json({
      user: userSummary(user),
      relationship: request?.status === 'accepted'
        ? 'friends'
        : request?.to.equals(req.user._id)
          ? 'incoming'
          : request
            ? 'outgoing'
            : 'none',
    });
  } catch (err) {
    console.error('friends:search failed', err);
    res.status(500).json({ message: 'Could not search for user' });
  }
});

router.get('/', async (req, res) => {
  try {
    const [requests, users] = await Promise.all([
      Friendship.find({
        status: 'pending',
        $or: [{ from: req.user._id }, { to: req.user._id }],
      })
        .lean(),
      Friendship.find({
        status: 'accepted',
        $or: [{ from: req.user._id }, { to: req.user._id }],
      }).lean(),
    ]);
    const relatedIds = new Set([
      ...requests.flatMap((request) => [String(request.from), String(request.to)]),
      ...users.flatMap((request) => [String(request.from), String(request.to)]),
    ]);
    const profiles = await User.find({ _id: { $in: [...relatedIds] } }).select('_id username avatarColor');
    const userMap = new Map(profiles.map((user) => [String(user._id), userSummary(user)]));
    res.json({
      friends: users.map((request) =>
        userMap.get(String(request.from) === String(req.user._id) ? String(request.to) : String(request.from))
      ).filter(Boolean),
      incoming: requests
        .filter((request) => String(request.to) === String(req.user._id))
        .map((request) => ({ ...userMap.get(String(request.from)), requestId: String(request._id) })),
      outgoing: requests
        .filter((request) => String(request.from) === String(req.user._id))
        .map((request) => ({ ...userMap.get(String(request.to)), requestId: String(request._id) })),
    });
  } catch (err) {
    console.error('friends:list failed', err);
    res.status(500).json({ message: 'Could not load friends' });
  }
});

router.post('/:userId/request', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId) || String(req.user._id) === req.params.userId) {
      return res.status(400).json({ message: 'Invalid friend id' });
    }
    const other = await User.findById(req.params.userId).select('username avatarColor');
    if (!other) return res.status(404).json({ message: 'User not found' });

    const existing = await Friendship.findOne({
      $or: [
        { from: req.user._id, to: other._id },
        { from: other._id, to: req.user._id },
      ],
    });
    if (existing?.status === 'accepted') {
      return res.json({ relationship: 'friends', user: userSummary(other) });
    }
    if (existing && String(existing.to) === String(req.user._id)) {
      existing.status = 'accepted';
      await existing.save();
      notifyFriends(req.app.locals.io, [existing.from, existing.to]);
      return res.json({ relationship: 'friends', user: userSummary(other) });
    }
    if (existing) return res.json({ relationship: 'outgoing', user: userSummary(other) });

    await Friendship.create({ from: req.user._id, to: other._id });
    notifyFriends(req.app.locals.io, [other._id]);
    res.status(201).json({ relationship: 'outgoing', user: userSummary(other) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Friend request already exists' });
    console.error('friends:request failed', err);
    res.status(500).json({ message: 'Could not send friend request' });
  }
});

router.post('/:userId/respond', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId) || typeof req.body?.accept !== 'boolean') {
      return res.status(400).json({ message: 'Invalid friend request response' });
    }
    const request = await Friendship.findOne({
      from: req.params.userId,
      to: req.user._id,
      status: 'pending',
    });
    if (!request) return res.status(404).json({ message: 'Friend request not found' });
    if (req.body.accept) {
      request.status = 'accepted';
      await request.save();
    } else {
      await request.deleteOne();
    }
    notifyFriends(req.app.locals.io, [request.from, request.to]);
    res.json({ relationship: req.body.accept ? 'friends' : 'none' });
  } catch (err) {
    console.error('friends:respond failed', err);
    res.status(500).json({ message: 'Could not respond to friend request' });
  }
});

export default router;
