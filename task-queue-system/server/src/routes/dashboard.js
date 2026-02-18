const express = require('express');
const db = require('../db/database');
const { emailQueue, deadLetterQueue } = require('../queues');
const { idParamSchema, listQuerySchema, validateOrRespond } = require('../lib/validation');

const router = express.Router();

router.get('/summary', async (_req, res) => {
  // Pull queue-native counts and DB-derived counts together for one operator snapshot.
  const [emailCounts, deadLetterCounts] = await Promise.all([
    emailQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused'),
    deadLetterQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed')
  ]);

  const statusRows = db
    .prepare(
      `SELECT status, COUNT(*) as count
       FROM campaign_jobs
       GROUP BY status`
    )
    .all();

  const statusSummary = {
    queued: 0,
    active: 0,
    retrying: 0,
    completed: 0,
    failed: 0
  };

  for (const row of statusRows) {
    statusSummary[row.status] = row.count;
  }

  const campaignCount = db.prepare('SELECT COUNT(*) as total FROM campaigns').get().total;
  const deadLetterCount = db
    .prepare('SELECT COUNT(*) as unresolved FROM dead_letters WHERE resolved = 0')
    .get().unresolved;

  return res.json({
    campaigns: campaignCount,
    jobs: statusSummary,
    queue: {
      email: emailCounts,
      deadLetter: deadLetterCounts
    },
    deadLetters: {
      unresolved: deadLetterCount
    }
  });
});

router.get('/recent-jobs', (req, res) => {
  const query = validateOrRespond(listQuerySchema, req.query, res);
  if (!query) return;

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const offset = (page - 1) * pageSize;

  const totalRow = db.prepare('SELECT COUNT(*) as total FROM campaign_jobs').get();

  const rows = db
    .prepare(
      `SELECT queue_job_id, campaign_id, recipient_email, status, attempts_made, max_attempts, error_message, updated_at
       FROM campaign_jobs
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(pageSize, offset);

  return res.json({
    items: rows,
    pagination: {
      page,
      pageSize,
      total: totalRow.total,
      totalPages: Math.max(1, Math.ceil(totalRow.total / pageSize))
    }
  });
});

router.get('/dead-letters', (req, res) => {
  const query = validateOrRespond(listQuerySchema, req.query, res);
  if (!query) return;

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const offset = (page - 1) * pageSize;

  const totalRow = db.prepare('SELECT COUNT(*) as total FROM dead_letters').get();

  const rows = db
    .prepare(
      `SELECT id, original_queue_job_id, campaign_id, recipient_email, reason, resolved, resolved_at, created_at
       FROM dead_letters
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(pageSize, offset);

  return res.json({
    items: rows,
    pagination: {
      page,
      pageSize,
      total: totalRow.total,
      totalPages: Math.max(1, Math.ceil(totalRow.total / pageSize))
    }
  });
});

router.post('/dead-letters/:id/requeue', async (req, res) => {
  const params = validateOrRespond(idParamSchema, req.params, res);
  if (!params) return;

  const deadLetter = db.prepare('SELECT * FROM dead_letters WHERE id = ?').get(params.id);

  if (!deadLetter) {
    return res.status(404).json({ message: 'Dead letter not found' });
  }

  if (deadLetter.resolved) {
    return res.status(400).json({ message: 'Dead letter already resolved' });
  }

  const payload = JSON.parse(deadLetter.payload);

  // Requeue creates a fresh job lifecycle; old failed job remains immutable history.
  const job = await emailQueue.add(
    'send-email-requeue',
    {
      campaignId: payload.campaignId,
      campaignName: payload.campaignName,
      recipientEmail: payload.recipientEmail,
      subject: payload.subject,
      body: payload.body,
      failRate: payload.failRate
    },
    {
      attempts: payload.maxAttempts || 4,
      backoff: {
        type: 'exponential',
        delay: payload.backoffMs || 2000
      }
    }
  );

  db.prepare(
    `INSERT INTO campaign_jobs (
      campaign_id,
      queue_job_id,
      recipient_email,
      status,
      attempts_made,
      max_attempts,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)`
  ).run(
    payload.campaignId,
    String(job.id),
    payload.recipientEmail,
    payload.maxAttempts || 4,
    new Date().toISOString(),
    new Date().toISOString()
  );

  db.prepare('UPDATE dead_letters SET resolved = 1, resolved_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    params.id
  );

  return res.json({
    message: 'Dead letter requeued successfully',
    queueJobId: String(job.id)
  });
});

module.exports = router;
