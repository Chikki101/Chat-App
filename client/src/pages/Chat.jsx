import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext.jsx';
import { api, SERVER_URL } from '../api.js';
import { ROOMS } from '../constants.js';
import MessageBubble from '../components/MessageBubble.jsx';
import MessageInput from '../components/MessageInput.jsx';
import MoodSummary from '../components/MoodSummary.jsx';
import logo from '../assets/logo.svg';
import emptyChat from '../assets/empty-chat.svg';

const publicRooms = ROOMS.map((room) => ({ ...room, kind: 'public' }));
const dmKey = (first, second) => `dm:${[first, second].sort().join(':')}`;

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
  const [messages, setMessages] = useState([]);
  const [online, setOnline] = useState([]);
  const [roomCounts, setRoomCounts] = useState({ general: 0, random: 0 });
  const [typers, setTypers] = useState({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [roomName, setRoomName] = useState('');
  const [inviteInput, setInviteInput] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [friendId, setFriendId] = useState('');
  const [friendSearch, setFriendSearch] = useState(null);
  const [roomMembers, setRoomMembers] = useState(null);
  const [banTargetId, setBanTargetId] = useState('');

  const socketRef = useRef(null);
  const roomRef = useRef(room);
  const currentRoomRef = useRef(null);
  const roomMembersRef = useRef(roomMembers);
  const bottomRef = useRef(null);
  const inviteHandledRef = useRef(false);
  roomMembersRef.current = roomMembers;

  const refreshFriends = useCallback(async () => {
    const data = await api.friends(token);
    setFriends(data);
  }, [token]);

  const refreshRooms = useCallback(async () => {
    const data = await api.rooms(token);
    setRooms([...publicRooms, ...data.rooms.filter((item) => item.kind === 'private')]);
  }, [token]);

  const currentRoom = useMemo(() => {
    const chatRoom = rooms.find((item) => item.id === room);
    if (chatRoom) return chatRoom;
    const friend = friends.friends.find((item) => dmKey(user.id, item.id) === room);
    return friend ? { ...friend, id: room, kind: 'direct', desc: 'Private conversation' } : null;
  }, [friends.friends, room, rooms, user.id]);
  currentRoomRef.current = currentRoom;

  const selectConversation = (conversationId) => {
    setInviteUrl('');
    setRoom(conversationId);
  };

  useEffect(() => {
    Promise.all([refreshRooms(), refreshFriends()]).catch((e) => setError(e.message));
  }, [refreshFriends, refreshRooms]);

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
    socket.on('friends:changed', () => {
      refreshFriends().catch((e) => setError(e.message));
    });
    socket.on('message:new', (msg) => {
      if (msg.room !== roomRef.current) return;
      setMessages((prev) => (prev.some((m) => m._id === msg._id) ? prev : [...prev, msg]));
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
  }, [refreshFriends, refreshRooms, token]);

  useEffect(() => {
    roomRef.current = room;
    setMessages([]);
    setTypers({});
    setRoomMembers(null);
    setInviteUrl('');
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
  }, [connected, currentRoom, room, token, user.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (text) => {
    socketRef.current?.emit('message:send', { room, text }, (result) => {
      if (!result?.ok) setError(result?.error || 'Failed to send message');
    });
  };
  const sendTyping = (isTyping) => socketRef.current?.emit('typing', { room, isTyping });

  const createRoom = async (event) => {
    event.preventDefault();
    try {
      const { room: created, inviteToken } = await api.createRoom(roomName, token);
      setRooms((items) => [...items, created]);
      setRoom(created.id);
      setRoomName('');
      setInviteUrl(`${window.location.origin}/?invite=${inviteToken}`);
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
      const { inviteToken } = await api.createInvite(room, token);
      setInviteUrl(`${window.location.origin}/?invite=${inviteToken}`);
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

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } catch {
      setError('Select and copy the invitation link shown below');
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
                {(item.id === 'general' || item.id === 'random') && (
                  <span className="room-count">{roomCounts[item.id] || 0} online</span>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="sidebar-section">
          <h4>Private rooms</h4>
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
              {friendSearch.relationship === 'none' && (
                <button onClick={() => addFriend(friendSearch.user.id)}>Add friend</button>
              )}
              {friendSearch.relationship === 'incoming' && (
                <button onClick={() => addFriend(friendSearch.user.id)}>Add back</button>
              )}
              {friendSearch.relationship === 'outgoing' && <span>Request sent</span>}
              {friendSearch.relationship === 'friends' && <span>Friends</span>}
            </div>
          )}
          {friends.incoming.map((request) => (
            <div className="sidebar-card" key={request.id}>
              <span>{request.username} wants to connect</span>
              <button onClick={() => respondToFriend(request.id, true)}>Accept</button>
              <button className="subtle-button" onClick={() => respondToFriend(request.id, false)}>Decline</button>
            </div>
          ))}
          {friends.outgoing.map((request) => (
            <div className="sidebar-card" key={request.id}>{request.username} (request sent)</div>
          ))}
          <ul className="online">
            {friends.friends.map((friend) => (
              <li key={friend.id}>
                <button
                  className={`friend-link ${dmKey(user.id, friend.id) === room ? 'active' : ''}`}
                  onClick={() => selectConversation(dmKey(user.id, friend.id))}
                >
                  <span className="dot" style={{ background: friend.avatarColor }} />
                  {friend.username}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="sidebar-section">
          <h4>Online ({online.length})</h4>
          <ul className="online">
            {online.map((person) => (
              <li key={person.id}>
                <span className="dot" style={{ background: person.avatarColor }} />
                {person.username}
                {person.id === user.id && ' (you)'}
              </li>
            ))}
          </ul>
        </div>

        {currentRoom?.kind === 'private' && currentRoom.isCreator && (
          <div className="sidebar-section">
            <h4>Room management</h4>
            <button className="wide-button" onClick={createInvite}>Create invitation link</button>
            {inviteUrl && (
              <div className="sidebar-card">
                <input aria-label="Invitation link" readOnly value={inviteUrl} onFocus={(event) => event.target.select()} />
                <button onClick={copyInvite}>Copy link</button>
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
                    <span>{member.username}</span>
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
          </div>
        )}

        <div className="me">
          <div className="avatar" style={{ background: user.avatarColor }}>
            {user.username[0].toUpperCase()}
          </div>
          <span>{user.username}</span>
          <button className="link" onClick={logout}>Log out</button>
        </div>
      </aside>

      <main className="chat">
        <header className="chat-header">
          <div>
            <h2>{currentRoom?.kind === 'direct' ? currentName : `# ${currentName}`}</h2>
            <p>{currentRoom?.desc || (currentRoom?.kind === 'private' ? `${currentRoom.memberCount} members · invitation only` : '')}</p>
          </div>
          <span className={`status ${connected ? 'on' : 'off'}`}>{connected ? 'Connected' : 'Reconnecting…'}</span>
        </header>

        <MoodSummary messages={messages} />

        <div className="messages">
          {messages.length === 0 ? (
            <div className="empty">
              <img src={emptyChat} alt="" width="220" />
              <p>No messages yet. Say hello!</p>
            </div>
          ) : (
            messages.map((message) => (
              <MessageBubble key={message._id} message={message} isOwn={message.sender === user.id} />
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

        <MessageInput onSend={sendMessage} onTyping={sendTyping} disabled={!connected} />
      </main>
    </div>
  );
}
