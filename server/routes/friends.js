import { Router } from 'express';
import mongoose from 'mongoose';
import Friendship from '../models/Friendship.js';
import Block from '../models/Block.js';
import User from '../models/User.js';
import protect from '../middleware/auth.js';
import { blockedUserIds, usersBlocked } from '../utils/blocks.js';

const router = Router();
const userSummary = (user) => ({
  id: String(user._id),
  username: user.username,
  avatarColor: user.avatarColor,
});
const notifyFriends = (io, userIds) => {
  if (!io) return;
  const uniqueIds = [...new Set(userIds.map(String))];
  for (const userId of uniqueIds) io.to(`user:${userId}`).emit('friends:changed', { userIds: uniqueIds });
};
const notifyBlockChange = async (io, userIds) => {
  if (!io) return;
  const uniqueIds = [...new Set(userIds.map(String))];
  for (const userId of uniqueIds) io.to(`user:${userId}`).emit('blocks:changed', { userIds: uniqueIds });
  if (io.broadcastPresence) {
    try {
      await io.broadcastPresence();
    } catch (err) {
      console.error('presence refresh after block change failed', err);
    }
  }
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
    if (await usersBlocked(req.user._id, user._id)) {
      return res.json({ user: userSummary(user), relationship: 'blocked' });
    }
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
    const hiddenIds = await blockedUserIds(req.user._id, [...relatedIds]);
    const visibleRequests = requests.filter((request) => {
      const otherId = String(request.from) === String(req.user._id) ? String(request.to) : String(request.from);
      return !hiddenIds.has(otherId);
    });
    const visibleFriends = users.filter((friendship) => {
      const otherId = String(friendship.from) === String(req.user._id)
        ? String(friendship.to)
        : String(friendship.from);
      return !hiddenIds.has(otherId);
    });
    const visibleIds = new Set([
      ...visibleRequests.flatMap((request) => [String(request.from), String(request.to)]),
      ...visibleFriends.flatMap((friendship) => [String(friendship.from), String(friendship.to)]),
    ]);
    const profiles = await User.find({ _id: { $in: [...visibleIds] } }).select('_id username avatarColor');
    const userMap = new Map(profiles.map((user) => [String(user._id), userSummary(user)]));
    res.json({
      friends: visibleFriends.map((request) =>
        userMap.get(String(request.from) === String(req.user._id) ? String(request.to) : String(request.from))
      ).filter(Boolean),
      incoming: visibleRequests
        .filter((request) => String(request.to) === String(req.user._id))
        .map((request) => ({ ...userMap.get(String(request.from)), requestId: String(request._id) })),
      outgoing: visibleRequests
        .filter((request) => String(request.from) === String(req.user._id))
        .map((request) => ({ ...userMap.get(String(request.to)), requestId: String(request._id) })),
    });
  } catch (err) {
    console.error('friends:list failed', err);
    res.status(500).json({ message: 'Could not load friends' });
  }
});

router.get('/blocked', async (req, res) => {
  try {
    const [blockedRows, hiddenIds] = await Promise.all([
      Block.find({ blocker: req.user._id }).populate('blocked', 'username avatarColor'),
      blockedUserIds(req.user._id),
    ]);
    res.json({
      blocked: blockedRows
        .filter((row) => row.blocked)
        .map((row) => userSummary(row.blocked)),
      hiddenIds: [...hiddenIds],
    });
  } catch (err) {
    console.error('friends:blocked list failed', err);
    res.status(500).json({ message: 'Could not load blocked users' });
  }
});

router.post('/:userId/block', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId) || String(req.user._id) === req.params.userId) {
      return res.status(400).json({ message: 'Invalid user id' });
    }
    const other = await User.findById(req.params.userId).select('_id');
    if (!other) return res.status(404).json({ message: 'User not found' });

    await Promise.all([
      Block.findOneAndUpdate(
        { blocker: req.user._id, blocked: other._id },
        { $setOnInsert: { blocker: req.user._id, blocked: other._id } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ),
      Friendship.deleteMany({
        $or: [
          { from: req.user._id, to: other._id },
          { from: other._id, to: req.user._id },
        ],
      }),
    ]);
    const ids = [req.user._id, other._id].map(String);
    notifyFriends(req.app.locals.io, ids);
    await notifyBlockChange(req.app.locals.io, ids);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 11000) return res.json({ ok: true });
    console.error('friends:block failed', err);
    res.status(500).json({ message: 'Could not block user' });
  }
});

router.delete('/:userId/block', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId) || String(req.user._id) === req.params.userId) {
      return res.status(400).json({ message: 'Invalid user id' });
    }
    await Block.deleteOne({ blocker: req.user._id, blocked: req.params.userId });
    const ids = [req.user._id, req.params.userId].map(String);
    await notifyBlockChange(req.app.locals.io, ids);
    res.json({ ok: true });
  } catch (err) {
    console.error('friends:unblock failed', err);
    res.status(500).json({ message: 'Could not unblock user' });
  }
});

router.delete('/:userId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId) || String(req.user._id) === req.params.userId) {
      return res.status(400).json({ message: 'Invalid friend id' });
    }
    const result = await Friendship.deleteMany({
      status: 'accepted',
      $or: [
        { from: req.user._id, to: req.params.userId },
        { from: req.params.userId, to: req.user._id },
      ],
    });
    if (!result.deletedCount) return res.status(404).json({ message: 'Friendship not found' });
    notifyFriends(req.app.locals.io, [req.user._id, req.params.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('friends:unfriend failed', err);
    res.status(500).json({ message: 'Could not remove friend' });
  }
});

router.post('/:userId/request', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId) || String(req.user._id) === req.params.userId) {
      return res.status(400).json({ message: 'Invalid friend id' });
    }
    const other = await User.findById(req.params.userId).select('username avatarColor');
    if (!other) return res.status(404).json({ message: 'User not found' });
    if (await usersBlocked(req.user._id, other._id)) {
      return res.status(403).json({ message: 'Friend requests are unavailable while either user is blocked' });
    }

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
    if (await usersBlocked(req.user._id, request.from)) {
      return res.status(403).json({ message: 'Friend requests are unavailable while either user is blocked' });
    }
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
