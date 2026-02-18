import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import api from './lib/api';
import socket from './lib/socket';

const STORAGE_KEY = 'live_chat_user';
const SOCKET_BASE = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4200';

function getStoredUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    // Local storage is a convenience cache; backend /session still validates shape/role.
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function normalizeAttachmentUrl(attachment) {
  if (!attachment || !attachment.url) return null;
  if (attachment.url.startsWith('http')) return attachment.url;
  return `${SOCKET_BASE}${attachment.url}`;
}

function App() {
  const [user, setUser] = useState(() => getStoredUser());
  const [sessionForm, setSessionForm] = useState({ name: '', role: 'customer' });
  const [rooms, setRooms] = useState([]);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [messagesByRoom, setMessagesByRoom] = useState({});
  const [typingByRoom, setTypingByRoom] = useState({});
  const [messageInput, setMessageInput] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [createRoomName, setCreateRoomName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchAllRooms, setSearchAllRooms] = useState(true);
  const [searchResults, setSearchResults] = useState([]);
  const [activeConversations, setActiveConversations] = useState([]);
  const [connected, setConnected] = useState(socket.connected);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const typingTimeoutRef = useRef(null);

  const selectedMessages = useMemo(() => {
    // Cache messages per room to avoid refetching when users switch between active conversations.
    if (!selectedRoomId) return [];
    return messagesByRoom[selectedRoomId] || [];
  }, [messagesByRoom, selectedRoomId]);

  const typingUsers = useMemo(() => {
    if (!selectedRoomId) return [];
    return typingByRoom[selectedRoomId] || [];
  }, [typingByRoom, selectedRoomId]);

  const refreshRooms = useCallback(async () => {
    if (!user) return;

    const response = await api.get('/rooms', {
      params: {
        userId: user.userId,
        role: user.role
      }
    });

    setRooms(response.data.items);

    if (!selectedRoomId && response.data.items.length > 0) {
      setSelectedRoomId(response.data.items[0].id);
    }
  }, [selectedRoomId, user]);

  const refreshMessages = useCallback(async (roomId) => {
    if (!roomId) return;

    const response = await api.get(`/rooms/${roomId}/messages`, {
      params: {
        limit: 80
      }
    });

    setMessagesByRoom((prev) => ({
      ...prev,
      [roomId]: response.data.items
    }));

    return response.data.items;
  }, []);

  const refreshAgentDashboard = useCallback(async () => {
    if (!user || user.role !== 'agent') return;

    const response = await api.get('/agent/active-conversations');
    setActiveConversations(response.data.items);
  }, [user]);

  const markLatestAsRead = useCallback(
    (roomId, items) => {
      if (!user || !roomId || !items || items.length === 0) return;
      const latest = items[items.length - 1];
      socket.emit('mark_read', {
        roomId,
        userId: user.userId,
        uptoMessageId: latest.id
      });
    },
    [user]
  );

  useEffect(() => {
    // Centralized socket subscriptions keep realtime state transitions in one predictable place.
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    const onServerError = (payload) => {
      setError(payload?.message || 'Server error');
    };

    const onJoinedRoom = ({ roomId, messages }) => {
      setMessagesByRoom((prev) => ({
        ...prev,
        [roomId]: messages
      }));
    };

    const onNewMessage = (message) => {
      setMessagesByRoom((prev) => {
        const existing = prev[message.room_id] || [];
        // Ignore duplicate payloads that can appear during reconnect/replay windows.
        const duplicate = existing.some((item) => item.id === message.id);
        if (duplicate) return prev;

        const next = [...existing, message];
        return {
          ...prev,
          [message.room_id]: next
        };
      });

      if (user && selectedRoomId === message.room_id && message.sender_id !== user.userId) {
        socket.emit('mark_read', {
          roomId: message.room_id,
          userId: user.userId,
          uptoMessageId: message.id
        });
      }

      refreshRooms().catch(() => {});
    };

    const onTypingUpdate = ({ roomId, userId, name, isTyping }) => {
      if (!roomId || !userId || (user && user.userId === userId)) return;

      setTypingByRoom((prev) => {
        const existing = prev[roomId] || [];

        if (isTyping) {
          if (existing.some((entry) => entry.userId === userId)) {
            return prev;
          }

          return {
            ...prev,
            [roomId]: [...existing, { userId, name }]
          };
        }

        return {
          ...prev,
          [roomId]: existing.filter((entry) => entry.userId !== userId)
        };
      });
    };

    const onReadUpdate = ({ roomId }) => {
      if (!roomId) return;
      refreshMessages(roomId).catch(() => {});
      refreshRooms().catch(() => {});
    };

    const onRoomPresence = ({ roomId, onlineCount }) => {
      setRooms((prev) =>
        prev.map((room) => (room.id === roomId ? { ...room, onlineCount } : room))
      );
    };

    const onConversationUpdated = () => {
      refreshAgentDashboard().catch(() => {});
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('server_error', onServerError);
    socket.on('joined_room', onJoinedRoom);
    socket.on('new_message', onNewMessage);
    socket.on('typing_update', onTypingUpdate);
    socket.on('read_update', onReadUpdate);
    socket.on('room_presence', onRoomPresence);
    socket.on('conversation_updated', onConversationUpdated);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('server_error', onServerError);
      socket.off('joined_room', onJoinedRoom);
      socket.off('new_message', onNewMessage);
      socket.off('typing_update', onTypingUpdate);
      socket.off('read_update', onReadUpdate);
      socket.off('room_presence', onRoomPresence);
      socket.off('conversation_updated', onConversationUpdated);
    };
  }, [refreshAgentDashboard, refreshMessages, refreshRooms, selectedRoomId, user]);

  useEffect(() => {
    if (!user) return;

    let active = true;

    async function bootstrap() {
      try {
        // /session upsert guarantees this user exists server-side before socket events start.
        await api.post('/session', {
          userId: user.userId,
          name: user.name,
          role: user.role
        });

        await refreshRooms();
        if (user.role === 'agent') {
          // Agent sockets subscribe to a global room for cross-conversation update notifications.
          socket.emit('watch_as_agent', {
            userId: user.userId,
            name: user.name
          });
          await refreshAgentDashboard();
        }
      } catch (requestError) {
        if (active) {
          setError(requestError.response?.data?.message || 'Failed to initialize session');
        }
      }
    }

    bootstrap();

    return () => {
      active = false;
    };
  }, [refreshAgentDashboard, refreshRooms, user]);

  useEffect(() => {
    if (!user || rooms.length === 0) return;

    // Join every visible room so unread/typing/presence all stay live in the sidebar.
    for (const room of rooms) {
      socket.emit('join_room', {
        roomId: room.id,
        userId: user.userId,
        name: user.name,
        role: user.role
      });
    }
  }, [rooms, user]);

  useEffect(() => {
    if (!selectedRoomId) return;

    refreshMessages(selectedRoomId)
      .then((items) => {
        if (items && items.length > 0) {
          markLatestAsRead(selectedRoomId, items);
        }
      })
      .catch((requestError) => {
        setError(requestError.response?.data?.message || 'Failed to load messages');
      });
  }, [markLatestAsRead, refreshMessages, selectedRoomId]);

  useEffect(() => {
    if (!user || user.role !== 'agent') return;

    const timer = setInterval(() => {
      refreshAgentDashboard().catch(() => {});
    }, 5000);

    return () => clearInterval(timer);
  }, [refreshAgentDashboard, user]);

  async function handleStartSession(event) {
    event.preventDefault();
    setError('');

    if (!sessionForm.name.trim()) {
      setError('Name is required');
      return;
    }

    const nextUser = {
      userId: uuidv4(),
      name: sessionForm.name.trim(),
      role: sessionForm.role
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
  }

  function handleResetSession() {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
    setRooms([]);
    setSelectedRoomId('');
    setMessagesByRoom({});
    setSearchResults([]);
    setActiveConversations([]);
  }

  async function handleCreateRoom(event) {
    event.preventDefault();

    if (!user) return;

    if (!createRoomName.trim()) {
      setError('Room name is required');
      return;
    }

    try {
      setError('');
      const response = await api.post('/rooms', {
        name: createRoomName.trim(),
        createdBy: user.userId
      });

      setCreateRoomName('');
      await refreshRooms();
      setSelectedRoomId(response.data.room.id);
      setNotice(`Room created: ${response.data.room.name}`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to create room');
    }
  }

  async function handleSendMessage(event) {
    event.preventDefault();

    if (!user || !selectedRoomId) return;

    const text = messageInput.trim();

    if (!text && !selectedFile) {
      return;
    }

    setError('');

    let attachment = null;

    try {
      if (selectedFile) {
        const formData = new FormData();
        formData.append('file', selectedFile);

        const uploadResponse = await api.post('/uploads', formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        });

        attachment = uploadResponse.data.attachment;
      }

      socket.emit(
        'send_message',
        {
          roomId: selectedRoomId,
          userId: user.userId,
          name: user.name,
          role: user.role,
          content: text,
          attachment
        },
        (ack) => {
          if (!ack?.ok) {
            setError(ack?.error || 'Failed to send message');
            return;
          }

          // UI clears only after server ack to avoid showing unsent optimistic messages.
          setMessageInput('');
          setSelectedFile(null);
          socket.emit('typing', {
            roomId: selectedRoomId,
            userId: user.userId,
            name: user.name,
            isTyping: false
          });
          refreshRooms().catch(() => {});
          refreshAgentDashboard().catch(() => {});
        }
      );
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Failed to send message');
    }
  }

  function handleInputChange(value) {
    setMessageInput(value);

    if (!user || !selectedRoomId) return;

    socket.emit('typing', {
      roomId: selectedRoomId,
      userId: user.userId,
      name: user.name,
      isTyping: value.length > 0
    });

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      // Auto-stop typing signal keeps stale \"typing...\" indicators from sticking.
      socket.emit('typing', {
        roomId: selectedRoomId,
        userId: user.userId,
        name: user.name,
        isTyping: false
      });
    }, 900);
  }

  async function handleSearch(event) {
    event.preventDefault();

    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      setError('');
      const response = await api.get('/messages/search', {
        params: {
          q: searchQuery.trim(),
          roomId: searchAllRooms ? undefined : selectedRoomId,
          limit: 40
        }
      });
      setSearchResults(response.data.items);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Search failed');
    }
  }

  if (!user) {
    return (
      <div className="session-screen">
        <form className="session-card" onSubmit={handleStartSession}>
          <h1>Live Chat Support Platform</h1>
          <p>Create a session as customer or agent.</p>

          {error && <p className="error-text">{error}</p>}

          <label>
            Name
            <input
              value={sessionForm.name}
              onChange={(event) => setSessionForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Alex"
              required
            />
          </label>

          <label>
            Role
            <select
              value={sessionForm.role}
              onChange={(event) => setSessionForm((prev) => ({ ...prev, role: event.target.value }))}
            >
              <option value="customer">Customer</option>
              <option value="agent">Agent</option>
            </select>
          </label>

          <button type="submit">Start Session</button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <h2>{user.role === 'agent' ? 'Agent Console' : 'Customer Chat'}</h2>
          <p>{user.name}</p>
          <span className={`status-pill ${connected ? 'online' : 'offline'}`}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        <form className="create-room-form" onSubmit={handleCreateRoom}>
          <input
            placeholder="New room name"
            value={createRoomName}
            onChange={(event) => setCreateRoomName(event.target.value)}
          />
          <button type="submit">Create</button>
        </form>

        <div className="room-list">
          {rooms.map((room) => (
            <button
              key={room.id}
              className={`room-item ${selectedRoomId === room.id ? 'active' : ''}`}
              onClick={() => setSelectedRoomId(room.id)}
              type="button"
            >
              <div>
                <strong>{room.name}</strong>
                <small>{room.lastMessage?.content || 'No messages yet'}</small>
              </div>
              <div className="room-meta">
                <span className="tiny">Online: {room.onlineCount || 0}</span>
                {room.unread > 0 && <span className="badge-unread">{room.unread}</span>}
              </div>
            </button>
          ))}
        </div>

        <button className="reset-btn" type="button" onClick={handleResetSession}>
          Switch User
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <form className="search-form" onSubmit={handleSearch}>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search messages"
            />
            <label className="inline-check">
              <input
                type="checkbox"
                checked={searchAllRooms}
                onChange={(event) => setSearchAllRooms(event.target.checked)}
              />
              All rooms
            </label>
            <button type="submit">Search</button>
          </form>
        </header>

        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}

        <section className="chat-layout">
          <article className="chat-panel">
            <h3>{selectedRoomId ? rooms.find((room) => room.id === selectedRoomId)?.name || 'Room' : 'Select room'}</h3>

            <div className="message-list">
              {selectedMessages.map((message) => {
                const own = message.sender_id === user.userId;
                const attachmentUrl = normalizeAttachmentUrl(message.attachment);
                const imageAttachment =
                  attachmentUrl && message.attachment?.mimeType?.startsWith('image/');

                return (
                  <div key={message.id} className={`message ${own ? 'own' : ''}`}>
                    <div className="message-head">
                      <strong>{message.sender_name}</strong>
                      <span>{formatTime(message.created_at)}</span>
                    </div>
                    {message.content && <p>{message.content}</p>}
                    {attachmentUrl && (
                      <div className="attachment-wrap">
                        {imageAttachment ? (
                          <a href={attachmentUrl} target="_blank" rel="noreferrer">
                            <img src={attachmentUrl} alt={message.attachment?.filename || 'attachment'} />
                          </a>
                        ) : (
                          <a href={attachmentUrl} target="_blank" rel="noreferrer">
                            {message.attachment?.filename || 'Download file'}
                          </a>
                        )}
                      </div>
                    )}
                    {own && <small>Read by {message.read_count || 0}</small>}
                  </div>
                );
              })}
            </div>

            {typingUsers.length > 0 && (
              <div className="typing">
                {typingUsers.map((entry) => entry.name).join(', ')} typing...
              </div>
            )}

            <form className="composer" onSubmit={handleSendMessage}>
              <textarea
                rows={3}
                value={messageInput}
                onChange={(event) => handleInputChange(event.target.value)}
                placeholder="Type your message..."
                disabled={!selectedRoomId}
              />
              <div className="composer-actions">
                <input
                  type="file"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                  disabled={!selectedRoomId}
                />
                <button type="submit" disabled={!selectedRoomId}>
                  Send
                </button>
              </div>
            </form>
          </article>

          <aside className="insights-panel">
            <section className="panel-block">
              <h4>Search Results</h4>
              <div className="result-list">
                {searchResults.length === 0 ? (
                  <p>No results.</p>
                ) : (
                  searchResults.map((result) => (
                    <button
                      type="button"
                      key={result.id}
                      className="result-item"
                      onClick={() => {
                        setSelectedRoomId(result.room_id);
                        setNotice(`Jumped to ${result.room_name}`);
                      }}
                    >
                      <strong>{result.room_name}</strong>
                      <small>{result.sender_name}</small>
                      <p>{result.content}</p>
                    </button>
                  ))
                )}
              </div>
            </section>

            {user.role === 'agent' && (
              <section className="panel-block">
                <h4>Active Conversations</h4>
                <div className="result-list">
                  {activeConversations.length === 0 ? (
                    <p>No conversations yet.</p>
                  ) : (
                    activeConversations.map((conversation) => (
                      <button
                        type="button"
                        key={conversation.id}
                        className="result-item"
                        onClick={() => setSelectedRoomId(conversation.id)}
                      >
                        <strong>{conversation.name}</strong>
                        <small>
                          Online {conversation.online_count || 0} | Participants {conversation.participant_count}
                        </small>
                        <p>{conversation.last_message || 'No messages yet'}</p>
                      </button>
                    ))
                  )}
                </div>
              </section>
            )}
          </aside>
        </section>
      </main>
    </div>
  );
}

export default App;
