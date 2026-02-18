const db = require('../db/database');

const upsertUserStmt = db.prepare(`
  INSERT INTO users (id, name, role, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    role = excluded.role,
    updated_at = excluded.updated_at
`);

const addParticipantStmt = db.prepare(`
  INSERT INTO room_participants (room_id, user_id, joined_at, last_seen_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(room_id, user_id) DO UPDATE SET
    last_seen_at = excluded.last_seen_at
`);

function ensureUser(userId, name, role) {
  const now = new Date().toISOString();
  upsertUserStmt.run(userId, name, role, now, now);
}

function ensureParticipant(roomId, userId) {
  const now = new Date().toISOString();
  addParticipantStmt.run(roomId, userId, now, now);
}

function getRoom(roomId) {
  return db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
}

function getRoomsForUser(userId, role) {
  const base =
    role === 'agent'
      ? `SELECT r.id, r.name, r.created_at, r.updated_at FROM rooms r ORDER BY r.updated_at DESC`
      : `SELECT r.id, r.name, r.created_at, r.updated_at
         FROM rooms r
         JOIN room_participants rp ON rp.room_id = r.id
         WHERE rp.user_id = ?
         ORDER BY r.updated_at DESC`;

  const rows = role === 'agent' ? db.prepare(base).all() : db.prepare(base).all(userId);

  // Room list endpoint returns a precomputed summary so clients don't issue N+1 message queries.
  return rows.map((room) => {
    const lastMessage = db
      .prepare(
        `SELECT m.id, m.content, m.created_at, u.name as sender_name
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.room_id = ?
         ORDER BY m.created_at DESC
         LIMIT 1`
      )
      .get(room.id);

    const unread = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM messages m
         WHERE m.room_id = ?
           AND m.sender_id != ?
           AND NOT EXISTS (
             SELECT 1 FROM read_receipts rr
             WHERE rr.message_id = m.id AND rr.user_id = ?
           )`
      )
      .get(room.id, userId, userId).count;

    // Returning unread + lastMessage here keeps sidebar rendering to a single API request.
    return {
      ...room,
      lastMessage,
      unread
    };
  });
}

function getMessages(roomId, options = {}) {
  const limit = options.limit || 50;
  const before = options.before || null;

  const query =
    before
      ? `SELECT
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
         WHERE m.room_id = ? AND m.created_at < ?
         ORDER BY m.created_at DESC
         LIMIT ?`
      : `SELECT
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
         WHERE m.room_id = ?
         ORDER BY m.created_at DESC
         LIMIT ?`;

  const rows = before
    ? db.prepare(query).all(roomId, before, limit)
    : db.prepare(query).all(roomId, limit);

  // Query reads newest-first for index efficiency; reverse to render oldest->newest in UI.
  return rows.reverse().map((row) => ({
    ...row,
    attachment: row.attachment_json ? JSON.parse(row.attachment_json) : null
  }));
}

module.exports = {
  ensureUser,
  ensureParticipant,
  getRoom,
  getRoomsForUser,
  getMessages
};
