// Empty string = same origin (Vite proxy in dev, Express in production)
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';

async function request(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Request failed');
  return data;
}

export const api = {
  register: (username, password) =>
    request('/api/auth/register', { method: 'POST', body: { username, password } }),
  login: (username, password) =>
    request('/api/auth/login', { method: 'POST', body: { username, password } }),
  me: (token) => request('/api/auth/me', { token }),
  messages: (room, token) => request(`/api/messages/${room}?limit=50`, { token }),
  directMessages: (userId, token) => request(`/api/messages/dm/${userId}?limit=50`, { token }),
  analyze: (text, token) => request('/api/analyze', { method: 'POST', body: { text }, token }),
  rooms: (token) => request('/api/rooms', { token }),
  createRoom: (name, token) => request('/api/rooms', { method: 'POST', body: { name }, token }),
  joinRoom: (inviteToken, token) =>
    request('/api/rooms/join', { method: 'POST', body: { token: inviteToken }, token }),
  createInvite: (roomId, token) =>
    request(`/api/rooms/${roomId.replace('private:', '')}/invite`, { method: 'POST', token }),
  roomMembers: (roomId, token) => request(`/api/rooms/${roomId.replace('private:', '')}/members`, { token }),
  banMember: (roomId, userId, token) =>
    request(`/api/rooms/${roomId.replace('private:', '')}/ban/${userId}`, { method: 'POST', token }),
  unbanMember: (roomId, userId, token) =>
    request(`/api/rooms/${roomId.replace('private:', '')}/ban/${userId}`, { method: 'DELETE', token }),
  friends: (token) => request('/api/friends', { token }),
  searchUser: (userId, token) => request(`/api/friends/search/${userId}`, { token }),
  requestFriend: (userId, token) => request(`/api/friends/${userId}/request`, { method: 'POST', token }),
  respondFriend: (userId, accept, token) =>
    request(`/api/friends/${userId}/respond`, { method: 'POST', body: { accept }, token }),
};
