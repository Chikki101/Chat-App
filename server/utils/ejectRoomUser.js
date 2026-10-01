import { privateRoomKey } from './chatAccess.js';

export async function ejectRoomUser(io, roomId, userId, message) {
  if (!io) throw new Error('Chat server is not ready');
  const key = privateRoomKey(roomId);
  const sockets = await io.in(key).fetchSockets();
  for (const socket of sockets) {
    if (socket.data.userId === String(userId)) {
      socket.emit('room:kicked', { roomId: key, message });
      await socket.leave(key);
    }
  }
}
