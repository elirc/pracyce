const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { emailQueue } = require('../queues');
const { campaignSchema, listQuerySchema, validateOrRespond } = require('../lib/validation');

const router = express.Router();

const insertCampaignStmt = db.prepare(`
  INSERT INTO campaigns (id, name, subject, body, recipient_count, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertCampaignJobStmt = db.prepare(`
  INSERT INTO campaign_jobs (
    campaign_id,
    queue_job_id,
    recipient_email,
    status,
    attempts_made,
    max_attempts,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)
`);

const insertCampaignJobsTx = db.transaction((rows) => {
  for (const row of rows) {
    insertCampaignJobStmt.run(
      row.campaignId,
      row.queueJobId,
      row.recipientEmail,
      row.maxAttempts,
      row.timestamp,
      row.timestamp
    );
  }
});

router.post('/', async (req, res) => {
  const data = validateOrRespond(campaignSchema, req.body, res);
  if (!data) return;

  // One recipient should map to one job, so dedupe upfront before enqueueing.
  const recipients = Array.from(new Set(data.recipients.map((entry) => entry.trim().toLowerCase())));
  const failRate = data.failRate ?? 0.25;
  const maxAttempts = data.maxAttempts ?? 4;
  const backoffMs = data.backoffMs ?? 2000;

  const campaignId = uuidv4();
  const now = new Date().toISOString();

  // Persist campaign first so every queued job has a stable foreign key for monitoring.
  insertCampaignStmt.run(campaignId, data.campaignName, data.subject, data.body, recipients.length, now);

  try {
    const jobsToAdd = recipients.map((recipientEmail, index) => ({
      name: 'send-email',
      data: {
        campaignId,
        campaignName: data.campaignName,
        recipientEmail,
        subject: data.subject,
        body: data.body,
        failRate
      },
      opts: {
        jobId: `${campaignId}:${index + 1}:${recipientEmail}`,
        attempts: maxAttempts,
        backoff: {
          type: 'exponential',
          delay: backoffMs
        }
      }
    }));

    const enqueuedJobs = await emailQueue.addBulk(jobsToAdd);

    // Queue ids are written back to DB so UI can correlate BullMQ runtime state with app-level rows.
    insertCampaignJobsTx(
      enqueuedJobs.map((job, index) => ({
        campaignId,
        queueJobId: String(job.id),
        recipientEmail: recipients[index],
        maxAttempts,
        timestamp: now
      }))
    );

    return res.status(201).json({
      campaign: {
        id: campaignId,
        name: data.campaignName,
        subject: data.subject,
        recipientCount: recipients.length,
        failRate,
        maxAttempts,
        backoffMs,
        createdAt: now
      }
    });
  } catch (error) {
    // Roll back orphan campaign record when queueing fails.
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaignId);
    return res.status(500).json({
      message: 'Failed to enqueue campaign',
      details: error.message
    });
  }
});

router.get('/', (req, res) => {
  const query = validateOrRespond(listQuerySchema, req.query, res);
  if (!query) return;

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const totalRow = db.prepare('SELECT COUNT(*) as total FROM campaigns').get();
  // Aggregate query materializes per-campaign status buckets for list view cards/table.
  const campaigns = db
    .prepare(
      `SELECT
        c.id,
        c.name,
        c.subject,
        c.recipient_count,
        c.created_at,
        SUM(CASE WHEN j.status = 'queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN j.status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN j.status = 'retrying' THEN 1 ELSE 0 END) AS retrying,
        SUM(CASE WHEN j.status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN j.status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM campaigns c
      LEFT JOIN campaign_jobs j ON j.campaign_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?`
    )
    .all(pageSize, offset);

  return res.json({
    items: campaigns,
    pagination: {
      page,
      pageSize,
      total: totalRow.total,
      totalPages: Math.max(1, Math.ceil(totalRow.total / pageSize))
    }
  });
});

router.get('/:campaignId/jobs', (req, res) => {
  const query = validateOrRespond(listQuerySchema, req.query, res);
  if (!query) return;

  const campaignId = req.params.campaignId;
  const campaign = db.prepare('SELECT id, name FROM campaigns WHERE id = ?').get(campaignId);

  if (!campaign) {
    return res.status(404).json({ message: 'Campaign not found' });
  }

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  const offset = (page - 1) * pageSize;

  const totalRow = db.prepare('SELECT COUNT(*) as total FROM campaign_jobs WHERE campaign_id = ?').get(campaignId);

  const jobs = db
    .prepare(
      `SELECT queue_job_id, recipient_email, status, attempts_made, max_attempts, error_message, updated_at, processed_at
       FROM campaign_jobs
       WHERE campaign_id = ?
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(campaignId, pageSize, offset);

  return res.json({
    campaign,
    items: jobs,
    pagination: {
      page,
      pageSize,
      total: totalRow.total,
      totalPages: Math.max(1, Math.ceil(totalRow.total / pageSize))
    }
  });
});

module.exports = router;
