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

const router = Router();
const inviteHash = (token) => createHash('sha256').update(token).digest('hex');
const roomRecord = (room, userId) => ({
  id: privateRoomKey(room._id),
  name: room.name,
  creatorId: String(room.creator),
  memberCount: room.members.length,
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
    const inviteToken = randomBytes(32).toString('hex');
    const room = await ChatRoom.create({
      name,
      creator: req.user._id,
      members: [req.user._id],
      inviteHash: inviteHash(inviteToken),
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
    const room = await ChatRoom.findOne({ inviteHash: inviteHash(token) });
    if (!room) return res.status(404).json({ message: 'Invitation link is invalid or has expired' });
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
    const inviteToken = randomBytes(32).toString('hex');
    room.inviteHash = inviteHash(inviteToken);
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
    res.json({
      members: room.members.map((member) => ({
        id: String(member._id),
        username: member.username,
        avatarColor: member.avatarColor,
      })),
      bans: room.bans.map((ban) => ({
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
    req.app.locals.io.to(privateRoomKey(room._id)).emit('room:member-banned', {
      roomId: privateRoomKey(room._id),
      userId: req.params.userId,
      source: 'owner',
    });
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
