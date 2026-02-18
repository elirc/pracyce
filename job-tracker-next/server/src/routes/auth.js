const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { registerSchema, loginSchema } = require('../validation');
const { parseOrRespond } = require('../utils');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/register', async (req, res) => {
  // Validate and normalize user input before any DB access.
  const data = parseOrRespond(registerSchema, req.body, res);
  if (!data) return;

  const { name, email, password } = data;

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ message: 'Email is already in use' });
  }

  // Hashing prevents password disclosure even if DB is leaked.
  const passwordHash = await bcrypt.hash(password, 10);

  const result = db
    .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name, email.toLowerCase(), passwordHash);

  const user = {
    id: result.lastInsertRowid,
    name,
    email: email.toLowerCase()
  };

  const token = jwt.sign(user, process.env.JWT_SECRET, {
    expiresIn: '7d'
  });

  // Return token immediately so the client can enter authenticated flow without separate login.
  return res.status(201).json({ user, token });
});

router.post('/login', async (req, res) => {
  // Login schema is intentionally minimal: credential presence + valid email shape.
  const data = parseOrRespond(loginSchema, req.body, res);
  if (!data) return;

  const { email, password } = data;

  const userRow = db
    .prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?')
    .get(email.toLowerCase());

  if (!userRow) {
    // Same generic message for missing user and bad password to avoid account enumeration.
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  const passwordMatches = await bcrypt.compare(password, userRow.password_hash);
  if (!passwordMatches) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }

  const user = {
    id: userRow.id,
    name: userRow.name,
    email: userRow.email
  };

  const token = jwt.sign(user, process.env.JWT_SECRET, {
    expiresIn: '7d'
  });

  return res.json({ user, token });
});

router.get('/me', requireAuth, (req, res) => {
  // /me is used by client hydration to verify persisted tokens are still valid.
  const user = db
    .prepare('SELECT id, name, email, created_at FROM users WHERE id = ?')
    .get(req.user.id);

  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  return res.json({ user });
});

module.exports = router;
