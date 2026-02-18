const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const {
  sessionSchema,
  createRoomSchema,
  searchSchema,
  listMessagesSchema,
  validateOrRespond
} = require('../lib/validation');
const { ensureUser, ensureParticipant, getRoom, getRoomsForUser, getMessages } = require('../lib/chatService');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname || '').slice(0, 10);
    cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

router.post('/session', (req, res) => {
  // Session is idempotent: reconnecting client can safely call this repeatedly.
  const payload = validateOrRespond(sessionSchema, req.body, res);
  if (!payload) return;

  ensureUser(payload.userId, payload.name, payload.role);

  const user = db.prepare('SELECT id, name, role, updated_at FROM users WHERE id = ?').get(payload.userId);
  return res.status(201).json({ user });
});

router.get('/rooms', (req, res) => {
  const userId = req.query.userId;
  const role = req.query.role;

  if (!userId || !role) {
    return res.status(400).json({ message: 'userId and role are required' });
  }

  const getOnlineCount = req.app.locals.getOnlineCount || (() => 0);
  // REST room list merges persisted room metadata with live in-memory presence counts.
  const rooms = getRoomsForUser(String(userId), String(role)).map((room) => ({
    ...room,
    onlineCount: getOnlineCount(room.id)
  }));
  return res.json({ items: rooms });
});

router.post('/rooms', (req, res) => {
  const payload = validateOrRespond(createRoomSchema, req.body, res);
  if (!payload) return;

  const roomId = uuidv4();
  const now = new Date().toISOString();

  db.prepare('INSERT INTO rooms (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    roomId,
    payload.name,
    payload.createdBy || null,
    now,
    now
  );

  if (payload.createdBy) {
    // Creator auto-joins so first message can be sent immediately.
    ensureParticipant(roomId, payload.createdBy);
  }

  return res.status(201).json({
    room: {
      id: roomId,
      name: payload.name,
      created_at: now,
      updated_at: now
    }
  });
});

router.get('/rooms/:roomId/messages', (req, res) => {
  const roomId = req.params.roomId;
  const room = getRoom(roomId);

  if (!room) {
    return res.status(404).json({ message: 'Room not found' });
  }

  const query = validateOrRespond(listMessagesSchema, req.query, res);
  if (!query) return;

  const messages = getMessages(roomId, {
    limit: query.limit || 50,
    before: query.before
  });

  return res.json({
    room,
    items: messages
  });
});

router.get('/agent/active-conversations', (_req, res) => {
  const getOnlineCount = _req.app.locals.getOnlineCount || (() => 0);
  const rows = db
    .prepare(
      `SELECT
         r.id,
         r.name,
         r.updated_at,
         COUNT(DISTINCT rp.user_id) AS participant_count,
         (
           SELECT m.content
           FROM messages m
           WHERE m.room_id = r.id
           ORDER BY m.created_at DESC
           LIMIT 1
         ) AS last_message,
         (
           SELECT m.created_at
           FROM messages m
           WHERE m.room_id = r.id
           ORDER BY m.created_at DESC
           LIMIT 1
         ) AS last_message_at
       FROM rooms r
       LEFT JOIN room_participants rp ON rp.room_id = r.id
       GROUP BY r.id
       ORDER BY COALESCE(last_message_at, r.updated_at) DESC`
    )
    .all();

  return res.json({
    // Agent dashboard is intentionally denormalized for quick scanning of every active thread.
    items: rows.map((row) => ({
      ...row,
      online_count: getOnlineCount(row.id)
    }))
  });
});

router.get('/messages/search', (req, res) => {
  const query = validateOrRespond(searchSchema, req.query, res);
  if (!query) return;

  const limit = query.limit || 30;
  const likeValue = `%${query.q.toLowerCase()}%`;

  const rows = query.roomId
    ? db
        .prepare(
          `SELECT
             m.id,
             m.room_id,
             r.name AS room_name,
             m.content,
             m.created_at,
             u.name AS sender_name,
             u.role AS sender_role
           FROM messages m
           JOIN users u ON u.id = m.sender_id
           JOIN rooms r ON r.id = m.room_id
           WHERE m.room_id = ? AND LOWER(COALESCE(m.content, '')) LIKE ?
           ORDER BY m.created_at DESC
           LIMIT ?`
        )
        .all(query.roomId, likeValue, limit)
    : db
        .prepare(
          `SELECT
             m.id,
             m.room_id,
             r.name AS room_name,
             m.content,
             m.created_at,
             u.name AS sender_name,
             u.role AS sender_role
           FROM messages m
           JOIN users u ON u.id = m.sender_id
           JOIN rooms r ON r.id = m.room_id
           WHERE LOWER(COALESCE(m.content, '')) LIKE ?
           ORDER BY m.created_at DESC
           LIMIT ?`
        )
        .all(likeValue, limit);

  return res.json({ items: rows });
});

router.post('/uploads', upload.single('file'), (req, res) => {
  // Upload route returns metadata only; message send over socket references this attachment object.
  if (!req.file) {
    return res.status(400).json({ message: 'file is required' });
  }

  return res.status(201).json({
    attachment: {
      url: `/uploads/${req.file.filename}`,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size
    }
  });
});

module.exports = router;
