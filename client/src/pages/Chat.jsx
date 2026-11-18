import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext.jsx';
import { api, SERVER_URL } from '../api.js';
import { ROOMS } from '../constants.js';
import MessageBubble from '../components/MessageBubble.jsx';
import MessageInput from '../components/MessageInput.jsx';
import MoodSummary from '../components/MoodSummary.jsx';
import ProfilePanel from '../components/ProfilePanel.jsx';
import logo from '../assets/logo.svg';
import emptyChat from '../assets/empty-chat.svg';

const publicRooms = ROOMS.map((room) => ({ ...room, kind: 'public' }));
const dmKey = (first, second) => `dm:${[first, second].sort().join(':')}`;
const SUPPORT_QUESTIONS = [
  'How do I create a room?',
  'How do I invite someone?',
  'How do I ban or unban a member?',
  'How do I message a friend?',
];
const PUBLIC_MESSAGE_RETENTION_MS = 24 * 60 * 60 * 1000;

function readInviteToken(value) {
  try {
    return new URL(value, window.location.origin).searchParams.get('invite') || value.trim();
  } catch {
    return value.trim();
  }
}

export default function Chat() {
  const { user, token, logout } = useAuth();
  const [room, setRoom] = useState('general');
  const [rooms, setRooms] = useState(publicRooms);
  const [friends, setFriends] = useState({ friends: [], incoming: [], outgoing: [] });
  const [blockData, setBlockData] = useState({ blocked: [], hiddenIds: [] });
  const [profileUserId, setProfileUserId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [warningMessage, setWarningMessage] = useState('');
  const [online, setOnline] = useState([]);
  const [roomCounts, setRoomCounts] = useState({ general: 0, random: 0 });
  const [typers, setTypers] = useState({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [roomName, setRoomName] = useState('');
  const [inviteLifetime, setInviteLifetime] = useState('never');
  const [inviteInput, setInviteInput] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [friendId, setFriendId] = useState('');
  const [friendSearch, setFriendSearch] = useState(null);
  const [roomMembers, setRoomMembers] = useState(null);
  const [banTargetId, setBanTargetId] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);
  const inviteInputRef = useRef(null);
  const supportKey = `support:${user.id}`;

  const socketRef = useRef(null);
  const roomRef = useRef(room);
  const currentRoomRef = useRef(null);
  const roomMembersRef = useRef(roomMembers);
  const bottomRef = useRef(null);
  const inviteHandledRef = useRef(false);
  const unreadSnapshotRef = useRef(0);
  const pendingUnreadRef = useRef(new Map());
  roomMembersRef.current = roomMembers;

  const refreshFriends = useCallback(async () => {
    const data = await api.friends(token);
    setFriends(data);
  }, [token]);

  const refreshBlocked = useCallback(async () => {
    setBlockData(await api.blockedUsers(token));
  }, [token]);

  const refreshUnreadCounts = useCallback(async () => {
    const { unread, asOf } = await api.unreadCounts(token);
    const snapshot = new Date(asOf).getTime();
    unreadSnapshotRef.current = snapshot;
    const activeRoom = roomRef.current;
    for (const [messageId, event] of pendingUnreadRef.current) {
      if (
        event.createdAt <= snapshot ||
        event.room === activeRoom ||
        !(event.room in unread)
      ) {
        pendingUnreadRef.current.delete(messageId);
        continue;
      }
      unread[event.room] = (unread[event.room] || 0) + 1;
    }
    delete unread[activeRoom];
    setUnreadCounts(unread);
  }, [token]);

  const clearPendingDirectReads = useCallback((userIds) => {
    for (const [messageId, event] of pendingUnreadRef.current) {
      if (!event.room.startsWith('dm:')) continue;
      const partnerId = event.room.split(':').find((id) => id !== user.id);
      if (partnerId && userIds.includes(partnerId)) pendingUnreadRef.current.delete(messageId);
    }
  }, [user.id]);

  const refreshRooms = useCallback(async () => {
    const data = await api.rooms(token);
    setRooms([...publicRooms, ...data.rooms.filter((item) => item.kind === 'private')]);
  }, [token]);

  const currentRoom = useMemo(() => {
    const chatRoom = rooms.find((item) => item.id === room);
    if (chatRoom) return chatRoom;
    if (room === supportKey) {
      return {
        id: supportKey,
        name: 'Support',
        kind: 'support',
        desc: 'Private help conversation. Only you can see it.',
      };
    }
    const friend = friends.friends.find((item) => dmKey(user.id, item.id) === room);
    return friend ? { ...friend, id: room, kind: 'direct', desc: 'Private conversation' } : null;
  }, [friends.friends, room, rooms, supportKey, user.id]);
  currentRoomRef.current = currentRoom;

  const selectConversation = (conversationId) => {
    setInviteUrl('');
    setInviteCopied(false);
    setRoom(conversationId);
  };

  useEffect(() => {
    Promise.all([refreshRooms(), refreshFriends(), refreshBlocked(), refreshUnreadCounts()])
      .catch((e) => setError(e.message));
  }, [refreshBlocked, refreshFriends, refreshRooms, refreshUnreadCounts]);

  useEffect(() => {
    const inviteToken = new URLSearchParams(window.location.search).get('invite');
    if (!inviteToken || inviteHandledRef.current) return;
    inviteHandledRef.current = true;
    api.joinRoom(inviteToken, token)
      .then(async ({ room: joinedRoom }) => {
        await refreshRooms();
        selectConversation(joinedRoom.id);
        window.history.replaceState({}, '', window.location.pathname);
      })
      .catch((e) => setError(e.message));
  }, [refreshRooms, token]);

  useEffect(() => {
    const socket = io(SERVER_URL || window.location.origin, { auth: { token } });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      refreshUnreadCounts().catch((e) => setError(e.message));
      socket.emit('room:join', { room: roomRef.current }, (result) => {
        if (!result?.ok) setError(result?.error || 'Could not join conversation');
      });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => {
      setError(err.message);
      if (err.message === 'Unauthorized') logout();
    });
    socket.on('presence', setOnline);
    socket.on('presence:rooms', setRoomCounts);
    socket.on('friends:changed', ({ userIds = [] } = {}) => {
      clearPendingDirectReads(userIds);
      refreshFriends().catch((e) => setError(e.message));
      refreshUnreadCounts().catch((e) => setError(e.message));
      const partnerId = roomRef.current.startsWith('dm:')
        ? roomRef.current.slice(3).split(':').find((id) => id !== user.id)
        : null;
      if (partnerId && userIds.includes(partnerId)) {
        setRoom('general');
        setError('This conversation is no longer available because the friendship changed.');
      }
    });
    socket.on('blocks:changed', ({ userIds = [] } = {}) => {
      clearPendingDirectReads(userIds);
      for (const [messageId, event] of pendingUnreadRef.current) {
        if (event.senderId && event.senderId !== user.id && userIds.includes(event.senderId)) {
          pendingUnreadRef.current.delete(messageId);
        }
      }
      refreshFriends().catch((e) => setError(e.message));
      refreshBlocked().catch((e) => setError(e.message));
      refreshUnreadCounts().catch((e) => setError(e.message));
      const partnerId = roomRef.current.startsWith('dm:')
        ? roomRef.current.slice(3).split(':').find((id) => id !== user.id)
        : null;
      if (partnerId && userIds.includes(partnerId)) {
        setRoom('general');
        setError('This conversation is no longer available because one of its users was blocked.');
      }
    });
    socket.on('message:new', (msg) => {
      if (msg.room !== roomRef.current) return;
      setMessages((prev) => (prev.some((m) => m._id === msg._id) ? prev : [...prev, msg]));
    });
    socket.on('messages:expired', ({ room: expiredRoom, before }) => {
      const cutoff = new Date(before).getTime();
      if (!Number.isFinite(cutoff)) return;
      if (roomRef.current === expiredRoom) {
        setMessages((prev) => prev.filter((message) => new Date(message.createdAt).getTime() > cutoff));
      }
      for (const [messageId, event] of pendingUnreadRef.current) {
        if (event.room === expiredRoom && event.createdAt <= cutoff) {
          pendingUnreadRef.current.delete(messageId);
        }
      }
      refreshUnreadCounts().catch((e) => setError(e.message));
    });
    socket.on('room:unread', ({ room: unreadRoom, messageId, createdAt, senderId }) => {
      if (!unreadRoom) return;
      if (unreadRoom === roomRef.current) {
        pendingUnreadRef.current.delete(messageId);
        api.markRead(unreadRoom, token).catch((e) => setError(e.message));
        return;
      }
      const eventTime = new Date(createdAt).getTime();
      if (eventTime <= unreadSnapshotRef.current || pendingUnreadRef.current.has(messageId)) return;
      pendingUnreadRef.current.set(messageId, { room: unreadRoom, createdAt: eventTime, senderId });
      setUnreadCounts((prev) => ({ ...prev, [unreadRoom]: (prev[unreadRoom] || 0) + 1 }));
    });
    socket.on('room:warning', ({ message }) => {
      setWarningMessage(message);
    });
    socket.on('typing', ({ username, isTyping }) => {
      setTypers((prev) => {
        const next = { ...prev };
        if (isTyping) next[username] = true;
        else delete next[username];
        return next;
      });
    });
    socket.on('room:kicked', ({ roomId, message }) => {
      if (roomRef.current !== roomId) return;
      setError(message);
      selectConversation('general');
      refreshRooms().catch((e) => setError(e.message));
      refreshUnreadCounts().catch((e) => setError(e.message));
    });
    socket.on('room:deleted', ({ roomId, roomName }) => {
      refreshRooms().catch((e) => setError(e.message));
      refreshUnreadCounts().catch((e) => setError(e.message));
      if (roomRef.current === roomId) {
        setRoom('general');
        setInviteUrl('');
        setRoomMembers(null);
        setError(`The room "${roomName}" was deleted by its creator.`);
      }
    });
    socket.on('room:member-banned', ({ roomId }) => {
      if (roomRef.current === roomId && currentRoomRef.current?.isCreator) {
        refreshRooms().catch((e) => setError(e.message));
        if (roomMembersRef.current) {
          api.roomMembers(roomId, token).then(setRoomMembers).catch((e) => setError(e.message));
        }
      }
    });
    socket.on('room:member-joined', ({ roomId }) => {
      if (roomRef.current === roomId && currentRoomRef.current?.isCreator) {
        refreshRooms().catch((e) => setError(e.message));
        if (roomMembersRef.current) {
          api.roomMembers(roomId, token).then(setRoomMembers).catch((e) => setError(e.message));
        }
      }
    });

    return () => socket.disconnect();
    // The active conversation is rejoined by the room effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearPendingDirectReads, refreshBlocked, refreshFriends, refreshRooms, refreshUnreadCounts, token, user.id]);

  useEffect(() => {
    roomRef.current = room;
    setUnreadCounts((prev) => {
      if (!prev[room]) return prev;
      const next = { ...prev };
      delete next[room];
      return next;
    });
    for (const [messageId, event] of pendingUnreadRef.current) {
      if (event.room === room) pendingUnreadRef.current.delete(messageId);
    }
    setMessages([]);
    setTypers({});
    setRoomMembers(null);
    api.markRead(room, token).catch((e) => setError(e.message));
    if (connected) {
      socketRef.current?.emit('room:join', { room }, (result) => {
        if (!result?.ok) setError(result?.error || 'Could not join conversation');
      });
    }

    let cancelled = false;
    const dmPartnerId = room.startsWith('dm:')
      ? room.slice(3).split(':').find((id) => id !== user.id)
      : null;
    const historyRequest = room.startsWith('dm:')
      ? api.directMessages(dmPartnerId, token)
      : api.messages(room, token);
    historyRequest
      .then((history) => {
        if (cancelled) return;
        setMessages((prev) => {
          const ids = new Set(history.map((message) => message._id));
          return [...history, ...prev.filter((message) => !ids.has(message._id))];
        });
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, room, token, user.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!ROOMS.some((item) => item.id === room)) return undefined;
    const timer = setInterval(() => {
      const cutoff = Date.now() - PUBLIC_MESSAGE_RETENTION_MS;
      setMessages((prev) => prev.filter((message) => new Date(message.createdAt).getTime() > cutoff));
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, [room]);

  const sendMessage = (text) => {
    socketRef.current?.emit('message:send', { room, text }, (result) => {
      if (!result?.ok) setError(result?.error || 'Failed to send message');
    });
  };
  const sendTyping = (isTyping) => socketRef.current?.emit('typing', { room, isTyping });

  const createRoom = async (event) => {
    event.preventDefault();
    try {
      const { room: created, inviteToken } = await api.createRoom(roomName, inviteLifetime, token);
      setRooms((items) => [...items, created]);
      setRoom(created.id);
      setRoomName('');
      setInviteUrl(`${window.location.origin}/?invite=${inviteToken}`);
      setInviteCopied(false);
    } catch (e) {
      setError(e.message);
    }
  };

  const joinRoom = async (event) => {
    event.preventDefault();
    try {
      const result = await api.joinRoom(readInviteToken(inviteInput), token);
      await refreshRooms();
      selectConversation(result.room.id);
      setInviteInput('');
    } catch (e) {
      setError(e.message);
    }
  };

  const createInvite = async () => {
    try {
      const { inviteToken } = await api.createInvite(room, inviteLifetime, token);
      setInviteUrl(`${window.location.origin}/?invite=${inviteToken}`);
      setInviteCopied(false);
      await refreshRooms();
    } catch (e) {
      setError(e.message);
    }
  };

  const searchUser = async (event) => {
    event.preventDefault();
    try {
      setFriendSearch(await api.searchUser(friendId.trim(), token));
    } catch (e) {
      setFriendSearch(null);
      setError(e.message);
    }
  };

  const addFriend = async (targetId) => {
    try {
      const result = await api.requestFriend(targetId, token);
      await refreshFriends();
      if (friendSearch?.user.id === targetId) {
        setFriendSearch((current) => ({ ...current, relationship: result.relationship }));
      }
    } catch (e) {
      setError(e.message);
    }
  };

  const blockUser = async (targetId) => {
    try {
      await api.blockUser(targetId, token);
      await Promise.all([refreshFriends(), refreshBlocked()]);
      if (roomRef.current.startsWith('dm:') && roomRef.current.split(':').includes(targetId)) {
        setRoom('general');
      }
      if (friendSearch?.user.id === targetId) {
        setFriendSearch((current) => ({ ...current, relationship: 'blocked' }));
      }
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };

  const unblockUser = async (targetId) => {
    try {
      await api.unblockUser(targetId, token);
      await refreshBlocked();
      if (friendSearch?.user.id === targetId) {
        setFriendSearch((current) => ({ ...current, relationship: 'none' }));
      }
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };

  const unfriendUser = async (targetId) => {
    const friend = friends.friends.find((item) => item.id === targetId);
    if (!window.confirm(`Remove ${friend?.username || 'this user'} from your friends?`)) return;
    try {
      await api.unfriend(targetId, token);
      await refreshFriends();
      if (roomRef.current.startsWith('dm:') && roomRef.current.split(':').includes(targetId)) {
        setRoom('general');
      }
    } catch (e) {
      setError(e.message);
    }
  };

  const respondToFriend = async (targetId, accept) => {
    try {
      await api.respondFriend(targetId, accept, token);
      await refreshFriends();
    } catch (e) {
      setError(e.message);
    }
  };

  const manageRoom = async () => {
    try {
      setRoomMembers(await api.roomMembers(room, token));
    } catch (e) {
      setError(e.message);
    }
  };

  const banMember = async (memberId) => {
    try {
      await api.banMember(room, memberId, token);
      setRoomMembers(await api.roomMembers(room, token));
      await refreshRooms();
      setBanTargetId('');
    } catch (e) {
      setError(e.message);
    }
  };

  const unbanMember = async (memberId) => {
    try {
      await api.unbanMember(room, memberId, token);
      setRoomMembers(await api.roomMembers(room, token));
    } catch (e) {
      setError(e.message);
    }
  };

  const deleteRoom = async () => {
    if (!window.confirm(`Permanently delete "${currentRoom?.name}" and all of its messages? This cannot be undone.`)) {
      return;
    }
    try {
      await api.deleteRoom(room, token);
      setInviteUrl('');
      setRoomMembers(null);
      setRoom('general');
      await refreshRooms();
    } catch (e) {
      setError(e.message);
    }
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setInviteCopied(true);
    } catch {
      const input = inviteInputRef.current;
      if (input) {
        input.focus();
        input.select();
        if (document.execCommand('copy')) {
          setInviteCopied(true);
          return;
        }
      }
      setError('Copy was blocked. Select the invitation link and copy it manually.');
    }
  };

  const currentName = currentRoom?.name || 'Conversation';
  const typingNames = Object.keys(typers);
  const typingText =
    typingNames.length === 0
      ? ''
      : typingNames.length === 1
        ? `${typingNames[0]} is typing…`
        : 'Several people are typing…';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src={logo} width="34" height="34" alt="" />
          <span>MoodChat</span>
        </div>

        <h4>Channels</h4>
        <ul className="rooms">
          {rooms.map((item) => (
            <li key={item.id}>
              <button className={item.id === room ? 'active' : ''} onClick={() => selectConversation(item.id)}>
                # {item.name}
                {unreadCounts[item.id] > 0 && (
                  <span className="unread-badge" aria-label={`${unreadCounts[item.id]} unread messages`}>
                    {unreadCounts[item.id] > 99 ? '99+' : unreadCounts[item.id]}
                  </span>
                )}
                {(item.id === 'general' || item.id === 'random') && (
                  <span className="room-count">{roomCounts[item.id] || 0} online</span>
                )}
              </button>
            </li>
          ))}
        </ul>

        <h4>Help</h4>
        <ul className="rooms">
          <li>
            <button
              className={room === supportKey ? 'active' : ''}
              onClick={() => selectConversation(supportKey)}
              aria-label="Open private support"
            >
              Private support
              {unreadCounts[supportKey] > 0 && (
                <span className="unread-badge" aria-label={`${unreadCounts[supportKey]} unread support replies`}>
                  {unreadCounts[supportKey] > 99 ? '99+' : unreadCounts[supportKey]}
                </span>
              )}
            </button>
          </li>
        </ul>

        <div className="sidebar-section">
          <h4>Private rooms</h4>
          <label className="invite-expiry-choice">
            Invitation expiry
            <select value={inviteLifetime} onChange={(event) => setInviteLifetime(event.target.value)}>
              <option value="never">Never expires</option>
              <option value="1h">1 hour</option>
              <option value="1d">1 day</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
            </select>
          </label>
          <form className="sidebar-form" onSubmit={createRoom}>
            <input
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
              placeholder="New room name"
              maxLength={40}
              aria-label="New private room name"
            />
            <button disabled={roomName.trim().length < 2}>Create</button>
          </form>
          <form className="sidebar-form" onSubmit={joinRoom}>
            <input
              value={inviteInput}
              onChange={(event) => setInviteInput(event.target.value)}
              placeholder="Invitation link or token"
              aria-label="Room invitation link or token"
            />
            <button disabled={!inviteInput.trim()}>Join</button>
          </form>
        </div>

        <div className="sidebar-section">
          <h4>Friends</h4>
          <form className="sidebar-form" onSubmit={searchUser}>
            <input
              value={friendId}
              onChange={(event) => setFriendId(event.target.value)}
              placeholder="Search by user ID"
              aria-label="Search friends by user ID"
            />
            <button disabled={!friendId.trim()}>Find</button>
          </form>
          <div className="user-id">Your ID: <code>{user.id}</code></div>
          {friendSearch && (
            <div className="sidebar-card">
              <strong>{friendSearch.user.username}</strong>
              <code>{friendSearch.user.id}</code>
              <button className="subtle-button" onClick={() => setProfileUserId(friendSearch.user.id)}>View profile</button>
              {friendSearch.relationship === 'none' && (
                <button onClick={() => addFriend(friendSearch.user.id)}>Add friend</button>
              )}
              {friendSearch.relationship === 'incoming' && (
                <button onClick={() => addFriend(friendSearch.user.id)}>Add back</button>
              )}
              {friendSearch.relationship === 'outgoing' && <span>Request sent</span>}
              {friendSearch.relationship === 'friends' && <span>Friends</span>}
              {friendSearch.relationship === 'blocked' && <span>Blocked</span>}
              {blockData.blocked.some((item) => item.id === friendSearch.user.id) ? (
                <button className="subtle-button" onClick={() => unblockUser(friendSearch.user.id)}>Unblock</button>
              ) : (
                <button className="subtle-button" onClick={() => blockUser(friendSearch.user.id)}>Block</button>
              )}
            </div>
          )}
          {friends.incoming.map((request) => (
            <div className="sidebar-card" key={request.id}>
              <span>{request.username} wants to connect</span>
              <button className="subtle-button" onClick={() => setProfileUserId(request.id)}>View profile</button>
              <button onClick={() => respondToFriend(request.id, true)}>Accept</button>
              <button className="subtle-button" onClick={() => respondToFriend(request.id, false)}>Decline</button>
            </div>
          ))}
          {friends.outgoing.map((request) => (
            <div className="sidebar-card" key={request.id}>
              {request.username} (request sent)
              <button className="subtle-button" onClick={() => setProfileUserId(request.id)}>View profile</button>
              <button className="subtle-button" onClick={() => blockUser(request.id)}>Block</button>
            </div>
          ))}
          <ul className="online">
            {friends.friends.map((friend) => {
              const directId = dmKey(user.id, friend.id);
              return (
                <li className="friend-item" key={friend.id}>
                  <div className="friend-heading">
                    <span className="dot" style={{ background: friend.avatarColor }} />
                    <button className="friend-name" onClick={() => setProfileUserId(friend.id)}>{friend.username}</button>
                    {unreadCounts[directId] > 0 && (
                      <span className="unread-badge" aria-label={`${unreadCounts[directId]} unread messages`}>
                        {unreadCounts[directId] > 99 ? '99+' : unreadCounts[directId]}
                      </span>
                    )}
                  </div>
                  <div className="friend-actions">
                    <button
                      className={`friend-action ${directId === room ? 'active' : ''}`}
                      onClick={() => selectConversation(directId)}
                    >Chat</button>
                    <button className="friend-action" onClick={() => unfriendUser(friend.id)}>Unfriend</button>
                    <button className="friend-action danger" onClick={() => blockUser(friend.id)}>Block</button>
                  </div>
                </li>
              );
            })}
          </ul>
          {blockData.blocked.length > 0 && (
            <div className="sidebar-card">
              <strong>Blocked users</strong>
              {blockData.blocked.map((blockedUser) => (
                <div className="management-row" key={blockedUser.id}>
                  <button className="friend-name" onClick={() => setProfileUserId(blockedUser.id)}>
                    {blockedUser.username}
                  </button>
                  <button className="subtle-button" onClick={() => unblockUser(blockedUser.id)}>Unblock</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sidebar-section">
          <h4>Online ({online.length})</h4>
          <ul className="online">
            {online.map((person) => (
              <li key={person.id}>
                <span className="dot" style={{ background: person.avatarColor }} />
                <button className="friend-name" onClick={() => setProfileUserId(person.id)}>
                  {person.username}{person.id === user.id && ' (you)'}
                </button>
                {person.id !== user.id && !blockData.blocked.some((item) => item.id === person.id) && (
                  <button className="subtle-button" onClick={() => blockUser(person.id)}>Block</button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {currentRoom?.kind === 'private' && currentRoom.isCreator && (
          <div className="sidebar-section">
            <h4>Room management</h4>
            <div className="sidebar-card">
              <strong>{currentRoom.name}</strong>
              <span>{currentRoom.memberCount} members · invitation only</span>
              <span>Created {new Date(currentRoom.createdAt).toLocaleDateString()}</span>
              <span>
                Invitation {currentRoom.inviteExpiresAt
                  ? `expires ${new Date(currentRoom.inviteExpiresAt).toLocaleString()}`
                  : 'does not expire'}
              </span>
            </div>
            <label className="invite-expiry-choice">
              New invitation expiry
              <select value={inviteLifetime} onChange={(event) => setInviteLifetime(event.target.value)}>
                <option value="never">Never expires</option>
                <option value="1h">1 hour</option>
                <option value="1d">1 day</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
              </select>
            </label>
            <button className="wide-button" onClick={createInvite}>Create invitation link</button>
            {inviteUrl && (
              <div className="sidebar-card">
                <input
                  ref={inviteInputRef}
                  aria-label="Invitation link"
                  readOnly
                  value={inviteUrl}
                  onFocus={(event) => event.target.select()}
                />
                <button type="button" onClick={copyInvite}>
                  {inviteCopied ? 'Copied!' : 'Copy link'}
                </button>
              </div>
            )}
            <button className="wide-button" onClick={manageRoom}>Manage members and bans</button>
            {roomMembers && (
              <div className="sidebar-card">
                <strong>Members</strong>
                <form
                  className="sidebar-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (banTargetId.trim()) banMember(banTargetId.trim());
                  }}
                >
                  <input
                    value={banTargetId}
                    onChange={(event) => setBanTargetId(event.target.value)}
                    placeholder="Ban user by ID"
                    aria-label="Ban user by ID"
                  />
                  <button disabled={!banTargetId.trim()}>Ban</button>
                </form>
                {roomMembers.members.map((member) => (
                  <div className="management-row" key={member.id}>
                    <button className="friend-name" onClick={() => setProfileUserId(member.id)}>{member.username}</button>
                    {member.id !== user.id && <button onClick={() => banMember(member.id)}>Ban</button>}
                  </div>
                ))}
                <strong>Banned forever</strong>
                {roomMembers.bans.length === 0 && <span>No banned members</span>}
                {roomMembers.bans.map((ban) => (
                  <div className="management-row" key={ban.id}>
                    <span>{ban.username} · {ban.reason}</span>
                    <button onClick={() => unbanMember(ban.id)}>Unban</button>
                  </div>
                ))}
              </div>
            )}
            <button className="wide-button danger-button" onClick={deleteRoom}>Delete room and messages</button>
          </div>
        )}

        <div className="me">
          <div className="avatar" style={{ background: user.avatarColor }}>
            {user.username[0].toUpperCase()}
          </div>
          <button className="me-profile" onClick={() => setProfileUserId(user.id)}>
            {user.username}<small>Profile</small>
          </button>
          <button className="link" onClick={logout}>Log out</button>
        </div>
      </aside>

      <main className="chat">
        <header className="chat-header">
          <div>
            <h2>
              {currentRoom?.kind === 'direct'
                ? currentName
                : currentRoom?.kind === 'support'
                  ? currentName
                  : `# ${currentName}`}
            </h2>
            <p>{currentRoom?.desc || (currentRoom?.kind === 'private' ? `${currentRoom.memberCount} members · invitation only` : '')}</p>
          </div>
          <span className={`status ${connected ? 'on' : 'off'}`}>{connected ? 'Connected' : 'Reconnecting…'}</span>
        </header>

        <MoodSummary messages={messages} />

        {room === supportKey && (
          <div className="support-faq" aria-label="Frequently asked questions">
            <span>Quick answers</span>
            {SUPPORT_QUESTIONS.map((question) => (
              <button key={question} type="button" disabled={!connected} onClick={() => sendMessage(question)}>
                {question}
              </button>
            ))}
          </div>
        )}

        <div className="messages">
          {messages.length === 0 ? (
            <div className="empty">
              <img src={emptyChat} alt="" width="220" />
              <p>No messages yet. Say hello!</p>
            </div>
          ) : (
            messages.map((message) => (
              <MessageBubble
                key={message._id}
                message={message}
                isOwn={!message.system && message.sender === user.id}
                onOpenProfile={setProfileUserId}
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <div className="typing">{typingText}</div>
        {error && (
          <div className="error toast" onClick={() => setError('')} role="alert">
            {error} (click to dismiss)
          </div>
        )}
        {warningMessage && (
          <div className="warning-toast" role="alert">
            <span>{warningMessage}</span>
            <button onClick={() => setWarningMessage('')} aria-label="Dismiss warning">×</button>
          </div>
        )}

        <MessageInput onSend={sendMessage} onTyping={sendTyping} disabled={!connected} />
      </main>
      {profileUserId && (
        <ProfilePanel
          userId={profileUserId}
          token={token}
          blockedByMe={blockData.blocked.some((item) => item.id === profileUserId)}
          onClose={() => setProfileUserId(null)}
          onBlock={blockUser}
          onUnblock={unblockUser}
        />
      )}
    </div>
  );
}
