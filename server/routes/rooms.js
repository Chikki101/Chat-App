import { createHash, randomBytes } from 'crypto';
import { Router } from 'express';
import mongoose from 'mongoose';
import ChatRoom from '../models/ChatRoom.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import protect from '../middleware/auth.js';
import { ROOMS } from '../constants.js';
import { privateRoomId, privateRoomKey } from '../utils/chatAccess.js';
import { ejectRoomUser } from '../utils/ejectRoomUser.js';
import { blockedUserIds } from '../utils/blocks.js';

const router = Router();
const inviteHash = (token) => createHash('sha256').update(token).digest('hex');
const inviteLifetimes = new Map([
  ['never', null],
  ['1h', 60 * 60 * 1000],
  ['1d', 24 * 60 * 60 * 1000],
  ['7d', 7 * 24 * 60 * 60 * 1000],
  ['30d', 30 * 24 * 60 * 60 * 1000],
]);
const invitationExpiry = (lifetime) => {
  if (!inviteLifetimes.has(lifetime)) return undefined;
  const duration = inviteLifetimes.get(lifetime);
  return duration === null ? null : new Date(Date.now() + duration);
};
const roomRecord = (room, userId) => ({
  id: privateRoomKey(room._id),
  name: room.name,
  creatorId: String(room.creator),
  memberCount: room.members.length,
  createdAt: room.createdAt,
  ...(String(room.creator) === String(userId)
    ? { inviteExpiresAt: room.inviteExpiresAt || null }
    : {}),
  isCreator: String(room.creator) === String(userId),
  kind: 'private',
});

router.use(protect);

router.get('/', async (req, res) => {
  try {
    const rooms = await ChatRoom.find({
      $or: [{ members: req.user._id }, { creator: req.user._id }],
    }).sort({ createdAt: -1 }).lean();
    res.json({
      rooms: [
        ...ROOMS.map((id) => ({ id, name: id, kind: 'public' })),
        ...rooms.map((room) => roomRecord(room, req.user._id)),
      ],
    });
  } catch (err) {
    console.error('rooms:list failed', err);
    res.status(500).json({ message: 'Could not load chat rooms' });
  }
});

router.post('/', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (name.length < 2 || name.length > 40) {
      return res.status(400).json({ message: 'Room name must be 2-40 characters' });
    }
    const expiresAt = invitationExpiry(req.body?.inviteLifetime ?? 'never');
    if (expiresAt === undefined) {
      return res.status(400).json({ message: 'Choose a valid invitation expiry' });
    }
    const inviteToken = randomBytes(32).toString('hex');
    const room = await ChatRoom.create({
      name,
      creator: req.user._id,
      members: [req.user._id],
      inviteHash: inviteHash(inviteToken),
      inviteExpiresAt: expiresAt,
    });
    res.status(201).json({ room: roomRecord(room, req.user._id), inviteToken });
  } catch (err) {
    console.error('rooms:create failed', err);
    res.status(500).json({ message: 'Could not create chat room' });
  }
});

router.post('/join', async (req, res) => {
  try {
    const token = String(req.body?.token || '');
    if (!/^[a-f\d]{64}$/i.test(token)) {
      return res.status(400).json({ message: 'Invitation link is invalid' });
    }
    const room = await ChatRoom.findOne({ inviteHash: inviteHash(token), deleting: { $ne: true } });
    if (!room) return res.status(404).json({ message: 'Invitation link is invalid or has expired' });
    if (room.inviteExpiresAt && room.inviteExpiresAt <= new Date()) {
      return res.status(404).json({ message: 'Invitation link is invalid or has expired' });
    }
    if (room.bans.some((ban) => String(ban.user) === String(req.user._id))) {
      return res.status(403).json({ message: 'You are banned from this room' });
    }
    if (!room.members.some((member) => String(member) === String(req.user._id))) {
      room.members.push(req.user._id);
      await room.save();
    }
    res.json({ room: roomRecord(room, req.user._id) });
  } catch (err) {
    console.error('rooms:join failed', err);
    res.status(500).json({ message: 'Could not join chat room' });
  }
});

router.post('/:roomId/invite', async (req, res) => {
  try {
    const roomId = privateRoomId(privateRoomKey(req.params.roomId));
    if (!roomId) return res.status(400).json({ message: 'Invalid room id' });
    const room = await ChatRoom.findById(roomId);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (String(room.creator) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only the room creator can create invitations' });
    }
    if (room.deleting) return res.status(404).json({ message: 'Room not found' });
    const expiresAt = invitationExpiry(req.body?.inviteLifetime ?? 'never');
    if (expiresAt === undefined) {
      return res.status(400).json({ message: 'Choose a valid invitation expiry' });
    }
    const inviteToken = randomBytes(32).toString('hex');
    room.inviteHash = inviteHash(inviteToken);
    room.inviteExpiresAt = expiresAt;
    await room.save();
    res.json({ inviteToken });
  } catch (err) {
    console.error('rooms:invite failed', err);
    res.status(500).json({ message: 'Could not create invitation link' });
  }
});

router.get('/:roomId/members', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.roomId)) {
      return res.status(400).json({ message: 'Invalid room id' });
    }
    const room = await ChatRoom.findById(req.params.roomId)
      .populate('members', 'username avatarColor')
      .populate('bans.user', 'username');
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (String(room.creator) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only the room creator can manage members' });
    }
    if (room.deleting) return res.status(404).json({ message: 'Room not found' });
    const hiddenIds = await blockedUserIds(
      req.user._id,
      [...room.members.map((member) => member._id), ...room.bans.map((ban) => ban.user._id)]
    );
    res.json({
      members: room.members.filter((member) => !hiddenIds.has(String(member._id))).map((member) => ({
        id: String(member._id),
        username: member.username,
        avatarColor: member.avatarColor,
      })),
      bans: room.bans.filter((ban) => !hiddenIds.has(String(ban.user._id))).map((ban) => ({
        id: String(ban.user._id),
        username: ban.user.username,
        reason: ban.reason,
        source: ban.source,
        createdAt: ban.createdAt,
      })),
    });
  } catch (err) {
    console.error('rooms:members failed', err);
    res.status(500).json({ message: 'Could not load room members' });
  }
});

router.post('/:roomId/ban/:userId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.roomId) || !mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ message: 'Invalid room or user id' });
    }
    const room = await ChatRoom.findById(req.params.roomId);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (String(room.creator) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only the room creator can ban members' });
    }
    if (room.deleting) return res.status(404).json({ message: 'Room not found' });
    if (String(room.creator) === req.params.userId) {
      return res.status(400).json({ message: 'The creator cannot ban themselves' });
    }
    if (!(await User.exists({ _id: req.params.userId }))) {
      return res.status(404).json({ message: 'User not found' });
    }
    const existing = room.bans.find((ban) => String(ban.user) === req.params.userId);
    if (existing) {
      existing.reason = String(req.body?.reason || 'Banned by room creator').slice(0, 200);
      existing.source = 'owner';
    } else {
      room.bans.push({
        user: req.params.userId,
        reason: String(req.body?.reason || 'Banned by room creator').slice(0, 200),
        source: 'owner',
      });
    }
    room.members.pull(req.params.userId);
    await room.save();
    const roomKey = privateRoomKey(room._id);
    const sockets = await req.app.locals.io.in(roomKey).fetchSockets();
    const hiddenIds = await blockedUserIds(req.params.userId, sockets.map((socket) => socket.data.userId));
    for (const socket of sockets) {
      if (hiddenIds.has(socket.data.userId)) continue;
      socket.emit('room:member-banned', {
        roomId: roomKey,
        userId: req.params.userId,
        source: 'owner',
      });
    }
    await ejectRoomUser(
      req.app.locals.io,
      room._id,
      req.params.userId,
      'The room creator removed you from this room'
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('rooms:ban failed', err);
    res.status(500).json({ message: 'Could not ban member' });
  }
});

router.delete('/:roomId', async (req, res) => {
  try {
    const roomId = privateRoomId(privateRoomKey(req.params.roomId));
    if (!roomId) return res.status(400).json({ message: 'Invalid room id' });
    const room = await ChatRoom.findById(roomId);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (String(room.creator) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only the room creator can delete this room' });
    }

    const roomKey = privateRoomKey(room._id);
    room.deleting = true;
    await room.save();
    await Message.deleteMany({ room: roomKey });
    const result = await ChatRoom.deleteOne({ _id: room._id, creator: req.user._id });
    if (result.deletedCount !== 1) return res.status(404).json({ message: 'Room not found' });
    const sockets = await req.app.locals.io.in(roomKey).fetchSockets();
    for (const socket of sockets) {
      socket.emit('room:deleted', { roomId: roomKey, roomName: room.name });
      await socket.leave(roomKey);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('rooms:delete failed', err);
    res.status(500).json({ message: 'Could not delete room' });
  }
});

router.delete('/:roomId/ban/:userId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.roomId) || !mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ message: 'Invalid room or user id' });
    }
    const room = await ChatRoom.findById(req.params.roomId);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (String(room.creator) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only the room creator can unban members' });
    }
    if (room.deleting) return res.status(404).json({ message: 'Room not found' });
    room.bans = room.bans.filter((ban) => String(ban.user) !== req.params.userId);
    if (
      String(room.creator) === req.params.userId &&
      !room.members.some((member) => String(member) === req.params.userId)
    ) {
      room.members.push(req.params.userId);
    }
    await room.save();
    res.json({ ok: true });
  } catch (err) {
    console.error('rooms:unban failed', err);
    res.status(500).json({ message: 'Could not unban member' });
  }
});

export default router;
