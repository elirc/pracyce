const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { ALLOWED_TRANSITIONS } = require('../constants');
const { createApplicationSchema, updateApplicationSchema, querySchema } = require('../validation');
const { parseOrRespond } = require('../utils');

const router = express.Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const queryData = parseOrRespond(querySchema, req.query, res);
  if (!queryData) return;

  const {
    search,
    status,
    sort_by = 'updated_at',
    sort_order = 'desc',
    page = 1,
    page_size = 10
  } = queryData;

  const whereParts = ['user_id = ?'];
  const params = [req.user.id];

  if (status) {
    whereParts.push('status = ?');
    params.push(status);
  }

  if (search) {
    whereParts.push('(LOWER(company) LIKE ? OR LOWER(role) LIKE ? OR LOWER(location) LIKE ?)');
    const searchText = `%${search.toLowerCase()}%`;
    params.push(searchText, searchText, searchText);
  }

  const whereClause = whereParts.join(' AND ');
  const offset = (page - 1) * page_size;

  // Count + page query share the same WHERE clause so pagination always matches filtered results.
  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM applications WHERE ${whereClause}`)
    .get(...params);

  const rows = db
    .prepare(
      `SELECT * FROM applications
       WHERE ${whereClause}
       ORDER BY ${sort_by} ${sort_order.toUpperCase()}
       LIMIT ? OFFSET ?`
    )
    .all(...params, page_size, offset);

  return res.json({
    items: rows,
    pagination: {
      total: countRow.total,
      page,
      page_size,
      total_pages: Math.max(1, Math.ceil(countRow.total / page_size))
    }
  });
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'Invalid id' });
  }

  const row = db.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').get(id, req.user.id);

  if (!row) {
    return res.status(404).json({ message: 'Application not found' });
  }

  return res.json({ item: row });
});

router.post('/', (req, res) => {
  const data = parseOrRespond(createApplicationSchema, req.body, res);
  if (!data) return;

  const now = new Date().toISOString();

  const result = db
    .prepare(
      `INSERT INTO applications (
        user_id, company, role, location, job_url, salary_min, salary_max,
        applied_date, next_step_date, status, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      data.company,
      data.role,
      data.location || null,
      data.job_url || null,
      data.salary_min,
      data.salary_max,
      data.applied_date,
      data.next_step_date || null,
      data.status,
      data.notes || null,
      now,
      now
    );

  const inserted = db.prepare('SELECT * FROM applications WHERE id = ?').get(result.lastInsertRowid);

  return res.status(201).json({ item: inserted });
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'Invalid id' });
  }

  const existing = db.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!existing) {
    return res.status(404).json({ message: 'Application not found' });
  }

  const data = parseOrRespond(updateApplicationSchema, req.body, res);
  if (!data) return;

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: 'No fields provided' });
  }

  if (data.status && data.status !== existing.status) {
    const allowed = ALLOWED_TRANSITIONS[existing.status] || [];
    // Enforce one-way workflow transitions server-side so clients cannot skip process states.
    if (!allowed.includes(data.status)) {
      return res.status(400).json({
        message: `Invalid transition from ${existing.status} to ${data.status}`
      });
    }
  }

  const merged = {
    ...existing,
    ...data,
    location: data.location !== undefined ? data.location || null : existing.location,
    job_url: data.job_url !== undefined ? data.job_url || null : existing.job_url,
    notes: data.notes !== undefined ? data.notes || null : existing.notes,
    next_step_date: data.next_step_date !== undefined ? data.next_step_date || null : existing.next_step_date
  };

  // Partial updates can change only one salary field, so we validate after merge as well.
  if (
    merged.salary_min !== undefined &&
    merged.salary_max !== undefined &&
    merged.salary_min !== null &&
    merged.salary_max !== null &&
    merged.salary_max < merged.salary_min
  ) {
    return res.status(400).json({
      message: 'salary_max must be greater than or equal to salary_min'
    });
  }

  db.prepare(
    `UPDATE applications
     SET company = ?, role = ?, location = ?, job_url = ?, salary_min = ?, salary_max = ?,
         applied_date = ?, next_step_date = ?, status = ?, notes = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    merged.company,
    merged.role,
    merged.location,
    merged.job_url,
    merged.salary_min,
    merged.salary_max,
    merged.applied_date,
    merged.next_step_date,
    merged.status,
    merged.notes,
    new Date().toISOString(),
    id,
    req.user.id
  );

  const updated = db.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').get(id, req.user.id);
  return res.json({ item: updated });
});

router.patch('/:id/transition', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'Invalid id' });
  }

  const nextStatus = req.body?.status;
  if (!nextStatus || typeof nextStatus !== 'string') {
    return res.status(400).json({ message: 'status is required' });
  }

  const existing = db.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!existing) {
    return res.status(404).json({ message: 'Application not found' });
  }

  if (existing.status === nextStatus) {
    return res.status(400).json({ message: `Application is already ${nextStatus}` });
  }

  const allowed = ALLOWED_TRANSITIONS[existing.status] || [];

  if (!allowed.includes(nextStatus)) {
    return res.status(400).json({
      message: `Invalid transition from ${existing.status} to ${nextStatus}`
    });
  }

  db.prepare('UPDATE applications SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
    nextStatus,
    new Date().toISOString(),
    id,
    req.user.id
  );

  const updated = db.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').get(id, req.user.id);

  return res.json({ item: updated });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: 'Invalid id' });
  }

  const result = db.prepare('DELETE FROM applications WHERE id = ? AND user_id = ?').run(id, req.user.id);

  if (result.changes === 0) {
    return res.status(404).json({ message: 'Application not found' });
  }

  return res.status(204).send();
});

module.exports = router;
