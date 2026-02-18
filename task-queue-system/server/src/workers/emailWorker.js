const { Worker } = require('bullmq');
const config = require('../lib/config');
const db = require('../db/database');
const { connection } = require('../lib/redis');
const { QUEUE_NAMES, deadLetterQueue } = require('../queues');
const { simulateEmailSend } = require('./emailProcessor');

require('../db/database');

const updateJobStmt = db.prepare(`
  UPDATE campaign_jobs
  SET status = ?, attempts_made = ?, error_message = ?, result_payload = ?, updated_at = ?, processed_at = ?
  WHERE queue_job_id = ?
`);

const insertDeadLetterStmt = db.prepare(`
  INSERT OR IGNORE INTO dead_letters (
    original_queue_job_id,
    campaign_id,
    recipient_email,
    reason,
    payload,
    resolved,
    created_at
  ) VALUES (?, ?, ?, ?, ?, 0, ?)
`);

const worker = new Worker(
  QUEUE_NAMES.EMAIL,
  async (job) => {
    // Processor intentionally simulates transient SMTP behavior to exercise retry and DLQ paths.
    return simulateEmailSend(job.data);
  },
  {
    connection,
    concurrency: config.workerConcurrency
  }
);

worker.on('ready', () => {
  console.log(`[worker] started for queue ${QUEUE_NAMES.EMAIL} with concurrency=${config.workerConcurrency}`);
});

worker.on('active', (job) => {
  if (!job) return;

  updateJobStmt.run(
    'active',
    job.attemptsMade,
    null,
    null,
    new Date().toISOString(),
    null,
    String(job.id)
  );
});

worker.on('completed', (job, result) => {
  if (!job) return;

  updateJobStmt.run(
    'completed',
    job.attemptsMade,
    null,
    JSON.stringify(result),
    new Date().toISOString(),
    new Date().toISOString(),
    String(job.id)
  );
});

worker.on('failed', async (job, error) => {
  if (!job) return;

  const maxAttempts = job.opts.attempts || 1;
  const attemptsMade = job.attemptsMade;
  // BullMQ emits "failed" for every attempt; terminal means attempts budget is exhausted.
  const terminalFailure = attemptsMade >= maxAttempts;

  updateJobStmt.run(
    terminalFailure ? 'failed' : 'retrying',
    attemptsMade,
    error?.message || 'Unknown worker error',
    null,
    new Date().toISOString(),
    terminalFailure ? new Date().toISOString() : null,
    String(job.id)
  );

  if (!terminalFailure) {
    return;
  }

  // Persist enough payload detail to safely requeue later from the operator dashboard.
  const payload = {
    campaignId: job.data.campaignId,
    campaignName: job.data.campaignName,
    recipientEmail: job.data.recipientEmail,
    subject: job.data.subject,
    body: job.data.body,
    failRate: job.data.failRate,
    maxAttempts,
    backoffMs: typeof job.opts.backoff === 'object' ? job.opts.backoff.delay : 2000
  };

  await deadLetterQueue.add(
    'dead-letter-email',
    {
      originalQueueJobId: String(job.id),
      ...payload,
      reason: error?.message || 'Unknown worker error'
    },
    {
      removeOnComplete: false,
      removeOnFail: false
    }
  );

  insertDeadLetterStmt.run(
    String(job.id),
    payload.campaignId,
    payload.recipientEmail,
    error?.message || 'Unknown worker error',
    JSON.stringify(payload),
    new Date().toISOString()
  );
});

worker.on('error', (error) => {
  console.error('[worker] fatal error:', error.message);
});

process.on('SIGINT', async () => {
  await worker.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await worker.close();
  process.exit(0);
});
