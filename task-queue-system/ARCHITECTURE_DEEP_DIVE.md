# Task Queue System - Architecture Deep Dive

This document explains how the BullMQ + Redis project works, why each subsystem exists, and how a junior developer can build the same system from scratch.

## 1. Product Goal

Provide a realistic async-processing app (bulk email sender) with:
- queue-based background processing
- retries + backoff
- dead-letter handling for terminal failures
- requeue operations
- operator dashboard for queue/job state

## 2. Core Architecture

## 2.1 Runtime components
- API server (`server/src/server.js`)
  - accepts campaign requests
  - writes metadata to SQLite
  - enqueues jobs in Redis via BullMQ
  - exposes dashboard APIs and Bull Board
- Worker (`server/src/worker.js`, `server/src/workers/emailWorker.js`)
  - consumes queue jobs
  - executes processing logic
  - updates job status in SQLite
  - moves terminal failures into dead-letter queue/table
- Redis
  - stores queue internals and scheduling state
- SQLite
  - stores business-level audit trail and dashboard state
- React dashboard (`client/src/App.jsx`)
  - sends campaigns
  - monitors processing lifecycle
  - triggers dead-letter requeue

## 2.2 Why both Redis and SQLite
- Redis is the queue engine (fast transient queue state).
- SQLite is the reporting system (durable business history).

You should not depend on Redis alone for historical dashboards, because completed/failed jobs may be cleaned up or rotated.

## 3. Data Model

Tables (`server/src/db/database.js`):
- `campaigns`
  - one user action to send bulk emails
- `campaign_jobs`
  - one row per recipient/job
  - stores attempts/status/error/result
- `dead_letters`
  - terminal failures only
  - includes payload snapshot for safe requeue

Why payload snapshot in dead letters:
- if campaign payload format changes later, requeue still has complete original context

## 4. Queue Design

Queues (`server/src/queues/index.js`):
- `email-jobs`
- `dead-letter-jobs`

Default options on email queue:
- `attempts: 4`
- exponential backoff
- retention policies for completed/failed jobs

Why defaults at queue level:
- keeps behavior consistent
- endpoint handlers can override only when needed

## 5. Campaign Creation Flow

File: `server/src/routes/campaigns.js`

Step-by-step:
1. Validate request with Zod.
2. Normalize + dedupe recipient list.
3. Insert campaign row first.
4. Build one BullMQ job payload per recipient.
5. `addBulk` to queue.
6. Save `queue_job_id` mappings to `campaign_jobs` in a DB transaction.
7. Return campaign metadata.

Failure behavior:
- if queueing fails after campaign insert, campaign row is deleted to avoid orphan records.

Why this order:
- job rows need stable campaign foreign key
- dashboard should never show phantom campaigns with zero queue linkage

## 6. Worker + Retry + DLQ Flow

File: `server/src/workers/emailWorker.js`

Worker event handling:
- `active` -> mark `campaign_jobs.status = active`
- `completed` -> status completed + persist result payload
- `failed` ->
  - if attempts remain: status `retrying`
  - if attempts exhausted: status `failed`, enqueue dead-letter record and persist in `dead_letters`

Important BullMQ nuance:
- `failed` event fires for each failed attempt.
- You must detect terminal failure (`attemptsMade >= maxAttempts`) before moving to DLQ.

## 7. Dead Letter Requeue

File: `server/src/routes/dashboard.js`

Endpoint: `POST /api/dashboard/dead-letters/:id/requeue`

Steps:
1. Load unresolved dead-letter row.
2. Parse saved payload snapshot.
3. Enqueue a fresh email job (new queue job id).
4. Insert new `campaign_jobs` row for that new id.
5. Mark dead-letter as resolved.

Why new job id matters:
- preserves immutable history
- avoids reusing failed execution identity

## 8. Monitoring APIs and Views

### API summary endpoint
`GET /api/dashboard/summary`
Combines:
- DB grouped statuses
- BullMQ queue counts
- campaign total
- unresolved dead-letter count

### Recent jobs / dead letters
Used to populate operator tables with actionable context.

### Bull Board
Mounted at `/admin/queues`.
Gives low-level queue internals useful for diagnosing stuck or delayed jobs.

## 9. Frontend Dashboard Design

File: `client/src/App.jsx`

Patterns:
- one polling loop (`setInterval`) every 5s
- all panels fetched together with `Promise.all`
- campaign form allows test-tuning (`failRate`, `maxAttempts`, `backoffMs`)
- dead-letter table includes per-row requeue action

Why polling was chosen:
- simpler than websocket streaming
- still good enough for operator visibility at this project scale

## 10. Build-From-Scratch Plan (Junior-Friendly)

1. Create Express server + health route.
2. Add Redis connection and BullMQ queue.
3. Add worker that logs job execution.
4. Add SQLite schema for campaigns/jobs.
5. Build campaign create endpoint that enqueues jobs.
6. Store queue job ids in DB.
7. Add worker event listeners and DB status updates.
8. Add retry/backoff options.
9. Add dead-letter queue + table and terminal-failure writes.
10. Add requeue endpoint.
11. Build dashboard read APIs.
12. Build React UI panels and form.
13. Add polling + error states.
14. Add Bull Board integration.

## 11. End-to-End Example

Campaign with 3 recipients:
1. User submits campaign.
2. API enqueues 3 jobs (`email-jobs`).
3. Worker processes each:
   - Recipient A succeeds immediately.
   - Recipient B fails twice then succeeds.
   - Recipient C fails 4 times -> terminal failure.
4. Recipient C gets dead-letter row + dead-letter queue entry.
5. Operator clicks requeue.
6. New job for recipient C is created and tracked independently.

## 12. Operational Notes

- Redis must be running before queue operations.
- Health endpoint is timeout-protected so API does not hang when Redis is down.
- If Redis is down:
  - dashboard DB reads still work
  - enqueue/worker operations fail as expected

## 13. Common Mistakes to Avoid

- not persisting queue job ids -> impossible to correlate events
- moving to DLQ on any failed attempt (instead of terminal failure only)
- forgetting to mark dead-letter row resolved after requeue
- relying only on BullMQ storage for historical analytics

## 14. File Map to Study

Backend:
- `server/src/server.js`
- `server/src/queues/index.js`
- `server/src/routes/campaigns.js`
- `server/src/routes/dashboard.js`
- `server/src/workers/emailWorker.js`
- `server/src/workers/emailProcessor.js`
- `server/src/db/database.js`

Frontend:
- `client/src/App.jsx`
- `client/src/components/StatCard.jsx`
- `client/src/lib/api.js`