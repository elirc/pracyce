const { v4: uuidv4 } = require('uuid');
const db = require('./db/database');
const { ensureUser, ensureParticipant, getRoom, getMessages } = require('./lib/chatService');

function createSocketServer(io) {
  // Presence is tracked in-memory for low latency, while messages/read receipts are persisted in SQLite.
  const onlineByRoom = new Map();
  const socketState = new Map();

  const insertMessageStmt = db.prepare(`
    INSERT INTO messages (id, room_id, sender_id, content, attachment_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const updateRoomStmt = db.prepare('UPDATE rooms SET updated_at = ? WHERE id = ?');

  const markReadStmt = db.prepare(`
    INSERT INTO read_receipts (message_id, user_id, read_at)
    VALUES (?, ?, ?)
    ON CONFLICT(message_id, user_id) DO UPDATE SET read_at = excluded.read_at
  `);

  function emitPresence(roomId) {
    const users = Array.from(onlineByRoom.get(roomId) || []);
    io.to(roomId).emit('room_presence', {
      roomId,
      onlineUsers: users,
      onlineCount: users.length
    });
  }

  function upsertOnline(roomId, user) {
    if (!onlineByRoom.has(roomId)) {
      onlineByRoom.set(roomId, new Set());
    }

    onlineByRoom.get(roomId).add(`${user.userId}|${user.name}|${user.role}`);
  }

  function removeOnline(roomId, userId) {
    if (!onlineByRoom.has(roomId)) return;

    const set = onlineByRoom.get(roomId);
    for (const entry of set) {
      if (entry.startsWith(`${userId}|`)) {
        set.delete(entry);
      }
    }

    if (set.size === 0) {
      onlineByRoom.delete(roomId);
    }
  }

  io.on('connection', (socket) => {
    socket.on('join_room', ({ roomId, userId, name, role }) => {
      // join_room doubles as a safety gate: validates room and materializes participation.
      if (!roomId || !userId || !name || !role) {
        return;
      }

      const room = getRoom(roomId);
      if (!room) {
        socket.emit('server_error', { message: 'Room not found' });
        return;
      }

      ensureUser(userId, name, role);
      ensureParticipant(roomId, userId);

      socket.join(roomId);
      const current = socketState.get(socket.id) || {
        userId,
        name,
        role,
        roomIds: new Set()
      };
      current.userId = userId;
      current.name = name;
      current.role = role;
      current.roomIds.add(roomId);
      socketState.set(socket.id, current);

      upsertOnline(roomId, { userId, name, role });
      emitPresence(roomId);

      socket.emit('joined_room', {
        roomId,
        // Send recent history immediately so client does not need a second websocket round trip.
        messages: getMessages(roomId, { limit: 50 })
      });
    });

    socket.on('typing', ({ roomId, userId, name, isTyping }) => {
      if (!roomId || !userId) return;

      // Typing is broadcast to peers only (sender already knows their own state).
      socket.to(roomId).emit('typing_update', {
        roomId,
        userId,
        name,
        isTyping: Boolean(isTyping)
      });
    });

    socket.on('send_message', (payload, callback) => {
      try {
        const roomId = payload?.roomId;
        const userId = payload?.userId;
        const name = payload?.name;
        const role = payload?.role;
        const content = (payload?.content || '').trim();
        const attachment = payload?.attachment || null;

        if (!roomId || !userId || !name || !role) {
          if (callback) callback({ ok: false, error: 'Missing required fields' });
          return;
        }

        const room = getRoom(roomId);
        if (!room) {
          if (callback) callback({ ok: false, error: 'Room not found' });
          return;
        }

        if (!content && !attachment) {
          if (callback) callback({ ok: false, error: 'Message content or attachment required' });
          return;
        }

        ensureUser(userId, name, role);
        ensureParticipant(roomId, userId);

        // Message write path is authoritative: save first, then broadcast the saved record.
        const messageId = uuidv4();
        const now = new Date().toISOString();

        insertMessageStmt.run(
          messageId,
          roomId,
          userId,
          content || null,
          attachment ? JSON.stringify(attachment) : null,
          now
        );

        updateRoomStmt.run(now, roomId);

        markReadStmt.run(messageId, userId, now);

        const message = db
          .prepare(
            `SELECT
               m.id,
               m.room_id,
               m.sender_id,
               m.content,
               m.attachment_json,
               m.created_at,
               u.name as sender_name,
               u.role as sender_role,
               (SELECT COUNT(*) FROM read_receipts rr WHERE rr.message_id = m.id AND rr.user_id != m.sender_id) as read_count
             FROM messages m
             JOIN users u ON u.id = m.sender_id
             WHERE m.id = ?`
          )
          .get(messageId);

        const output = {
          ...message,
          attachment: message.attachment_json ? JSON.parse(message.attachment_json) : null
        };

        io.to(roomId).emit('new_message', output);
        // Agents get a lightweight refresh trigger for their cross-room dashboard.
        io.to('agents').emit('conversation_updated', { roomId });

        if (callback) callback({ ok: true, message: output });
      } catch (error) {
        if (callback) callback({ ok: false, error: error.message });
      }
    });

    socket.on('mark_read', ({ roomId, userId, uptoMessageId }) => {
      if (!roomId || !userId || !uptoMessageId) return;

      const targetMessage = db
        .prepare('SELECT id, created_at FROM messages WHERE id = ? AND room_id = ?')
        .get(uptoMessageId, roomId);

      if (!targetMessage) return;

      const toMark = db
        .prepare('SELECT id FROM messages WHERE room_id = ? AND created_at <= ?')
        .all(roomId, targetMessage.created_at);

      const now = new Date().toISOString();
      // Mark all messages up to a known point to make read receipts robust against out-of-order events.
      const tx = db.transaction((rows) => {
        for (const row of rows) {
          markReadStmt.run(row.id, userId, now);
        }
      });
      tx(toMark);

      io.to(roomId).emit('read_update', {
        roomId,
        userId,
        uptoMessageId
      });
    });

    socket.on('watch_as_agent', ({ userId, name }) => {
      if (!userId || !name) return;
      // Agent-only room receives lightweight conversation refresh signals.
      socket.join('agents');
    });

    socket.on('disconnect', () => {
      const state = socketState.get(socket.id);
      socketState.delete(socket.id);

      if (!state?.roomIds || !state?.userId) return;

      for (const roomId of state.roomIds) {
        removeOnline(roomId, state.userId);
        emitPresence(roomId);
      }
    });
  });

  return {
    getOnlineCount(roomId) {
      const set = onlineByRoom.get(roomId);
      return set ? set.size : 0;
    }
  };
}

module.exports = {
  createSocketServer
};
