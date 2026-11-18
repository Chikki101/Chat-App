import mongoose from 'mongoose';
import ChatRoom from '../models/ChatRoom.js';
import Friendship from '../models/Friendship.js';
import { ROOMS } from '../constants.js';
import { usersBlocked } from './blocks.js';

export const privateRoomKey = (id) => `private:${id}`;

export function privateRoomId(key) {
  const match = /^private:([a-f\d]{24})$/i.exec(key);
  return match && mongoose.isValidObjectId(match[1]) ? match[1] : null;
}

export function directMessageKey(firstId, secondId) {
  return `dm:${[String(firstId), String(secondId)].sort().join(':')}`;
}

export async function canAccessConversation(userId, roomKey) {
  if (ROOMS.includes(roomKey)) return true;

  const roomId = privateRoomId(roomKey);
  if (roomId) {
    const room = await ChatRoom.findById(roomId).select('members bans deleting');
    return Boolean(
      room &&
        !room.deleting &&
        room.members.some((member) => String(member) === String(userId)) &&
        !room.bans.some((ban) => String(ban.user) === String(userId))
    );
  }

  const directMatch = /^dm:([a-f\d]{24}):([a-f\d]{24})$/i.exec(roomKey);
  if (!directMatch || !directMatch.some((id) => id.toLowerCase() === String(userId).toLowerCase())) {
    return false;
  }

  const [first, second] = directMatch.slice(1);
  const [friendship, isBlocked] = await Promise.all([
    Friendship.exists({
      status: 'accepted',
      $or: [
        { from: first, to: second },
        { from: second, to: first },
      ],
    }),
    usersBlocked(first, second),
  ]);
  return Boolean(friendship) && !isBlocked;
}
