import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import User from './models/User.js';
import Message from './models/Message.js';
import ChatRoom from './models/ChatRoom.js';
import { analyze } from './utils/sentiment.js';
import { ROOMS } from './constants.js';
import { canAccessConversation, privateRoomId } from './utils/chatAccess.js';
import { ejectRoomUser } from './utils/ejectRoomUser.js';

const AUTO_BAN_POINTS = 500;
const SCORE_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;

function isConversationKey(key) {
  return ROOMS.includes(key) || /^private:[a-f\d]{24}$/i.test(key) || /^dm:[a-f\d]{24}:[a-f\d]{24}$/i.test(key);
}

export function initSocket(httpServer, clientOrigin) {
  const io = new Server(httpServer, {
    cors: { origin: clientOrigin, credentials: true },
  });

  const online = new Map();

  const broadcastPresence = () =>
    io.emit(
      'presence',
      [...online.values()].map(({ id, username, avatarColor }) => ({ id, username, avatarColor }))
    );

  const broadcastRoomCounts = async () => {
    const counts = await Promise.all(
      ROOMS.filter((room) => room === 'general' || room === 'random').map(async (room) => {
        const sockets = await io.in(room).fetchSockets();
        return [room, new Set(sockets.map((socket) => socket.data.userId)).size];
      })
    );
    io.emit('presence:rooms', Object.fromEntries(counts));
  };

  io.use(async (socket, next) => {
    try {
      const { id } = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET);
      const user = await User.findById(id).select('username avatarColor');
      if (!user) return next(new Error('Unauthorized'));
      socket.user = user;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { _id, username, avatarColor } = socket.user;
    const uid = String(_id);
    socket.data.userId = uid;
    socket.join(`user:${uid}`);

    const entry = online.get(uid) || { id: uid, username, avatarColor, count: 0 };
    entry.count += 1;
    online.set(uid, entry);
    broadcastPresence();
    broadcastRoomCounts().catch((err) => console.error('room presence broadcast failed', err));

    socket.on('room:join', async (payload, ack) => {
      try {
        const room = typeof payload === 'string' ? payload : payload?.room;
        if (typeof room !== 'string' || !isConversationKey(room)) {
          return ack?.({ ok: false, error: 'Invalid room' });
        }
        if (!(await canAccessConversation(_id, room))) {
          return ack?.({ ok: false, error: 'You do not have access to this room' });
        }

        for (const joined of [...socket.rooms]) {
          if (joined !== socket.id && isConversationKey(joined)) await socket.leave(joined);
        }
        await socket.join(room);
        if (privateRoomId(room)) {
          io.to(room).emit('room:member-joined', { roomId: room, userId: uid });
        }
        await broadcastRoomCounts();
        ack?.({ ok: true, room });
      } catch (err) {
        console.error('room:join failed', err);
        ack?.({ ok: false, error: 'Could not join room' });
      }
    });

    socket.on('message:send', async (payload, ack) => {
      try {
        const { room, text } = payload || {};
        const clean = String(text || '').trim().slice(0, 500);
        if (!clean || typeof room !== 'string' || !isConversationKey(room)) {
          return ack?.({ ok: false, error: 'Invalid message' });
        }
        if (!socket.rooms.has(room) || !(await canAccessConversation(_id, room))) {
          return ack?.({ ok: false, error: 'You do not have access to this conversation' });
        }

        const sentiment = await analyze(clean);
        const msg = await Message.create({
          room,
          sender: _id,
          senderName: username,
          senderColor: avatarColor,
          text: clean,
          sentiment,
        });

        io.to(room).emit('message:new', {
          _id: String(msg._id),
          room,
          sender: uid,
          senderName: username,
          senderColor: avatarColor,
          text: clean,
          sentiment,
          createdAt: msg.createdAt,
        });

        const privateId = privateRoomId(room);
        if (privateId && sentiment.negativePoints > 0) {
          const chatRoom = await ChatRoom.findById(privateId).select('creator members bans');
          if (chatRoom) {
            const windowStart = new Date(Date.now() - SCORE_WINDOW_MS);
            const [score] = await Message.aggregate([
              { $match: { room, sender: _id, createdAt: { $gte: windowStart } } },
              { $group: { _id: null, points: { $sum: '$sentiment.negativePoints' } } },
            ]);
            if ((score?.points || 0) >= AUTO_BAN_POINTS && !chatRoom.bans.some((ban) => String(ban.user) === uid)) {
              chatRoom.members.pull(_id);
              chatRoom.bans.push({
                user: _id,
                reason: `Automatic removal: ${score.points} negative sentiment points in five days`,
                source: 'sentiment',
              });
              await chatRoom.save();
              const kick = {
                roomId: room,
                message: 'You were removed after reaching 500 negative sentiment points in the last five days',
              };
              io.to(room).emit('room:member-banned', {
                roomId: room,
                userId: uid,
                username,
                reason: chatRoom.bans.at(-1).reason,
                source: 'sentiment',
              });
              await ejectRoomUser(io, chatRoom._id, _id, kick.message);
              await broadcastRoomCounts();
            }
          }
        }
        ack?.({ ok: true });
      } catch (err) {
        console.error('message:send failed', err);
        ack?.({ ok: false, error: 'Could not send message' });
      }
    });

    socket.on('typing', async (payload) => {
      try {
        const { room, isTyping } = payload || {};
        if (
          typeof room !== 'string' ||
          !socket.rooms.has(room) ||
          !(await canAccessConversation(_id, room))
        ) {
          return;
        }
        socket.to(room).emit('typing', { username, isTyping: !!isTyping });
      } catch (err) {
        console.error('typing event failed', err);
      }
    });

    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (room !== socket.id && isConversationKey(room)) {
          socket.to(room).emit('room:presence-changed', { room });
        }
      }
    });

    socket.on('disconnect', () => {
      const current = online.get(uid);
      if (current) {
        current.count -= 1;
        if (current.count <= 0) online.delete(uid);
      }
      broadcastPresence();
      broadcastRoomCounts().catch((err) => console.error('room presence broadcast failed', err));
    });
  });

  return io;
}
