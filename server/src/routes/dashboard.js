const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { STATUS_VALUES } = require('../constants');

const router = express.Router();

router.use(requireAuth);

router.get('/stats', (req, res) => {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) as count
       FROM applications
       WHERE user_id = ?
       GROUP BY status`
    )
    .all(req.user.id);

  const totalRow = db.prepare('SELECT COUNT(*) as total FROM applications WHERE user_id = ?').get(req.user.id);

  const byStatus = STATUS_VALUES.reduce((acc, status) => {
    acc[status] = 0;
    return acc;
  }, {});

  for (const row of rows) {
    byStatus[row.status] = row.count;
  }

  const total = totalRow.total;
  const active = byStatus.applied + byStatus.interview;
  const conversionRate = total === 0 ? 0 : Number((((byStatus.offer + byStatus.interview) / total) * 100).toFixed(1));

  res.json({
    total,
    byStatus,
    active,
    conversionRate
  });
});

module.exports = router;