# Task Queue / Background Job System

A full JavaScript app that demonstrates async job processing with **BullMQ + Redis** using a bulk email sender workflow. No email is actually sent: the worker sleeps 400-1600 ms and fails at a configurable random rate (`server/src/workers/emailProcessor.js:8-29`).

There are no automated tests. Everything below was read from the source; nothing was produced by
running it (and, per the original notes, Redis was not available when the app was built).

## Features
- Bulk campaign creation (`N` unique recipients -> `N` queued jobs; recipients are lower-cased and de-duplicated, `server/src/routes/campaigns.js:45`)
- BullMQ worker with configurable concurrency (`WORKER_CONCURRENCY`, default 8)
- Retry logic with exponential backoff (per campaign: `maxAttempts` 1-10, default 4; `backoffMs` 250-60000, default 2000)
- Dead-letter queue for terminal failures (BullMQ queue `dead-letter-jobs` **and** SQLite table `dead_letters`)
- Dead-letter requeue action
- Monitoring dashboard (React UI, polls every 5 s — `client/src/App.jsx:91`)
- Bull Board admin dashboard (`/admin/queues`, no authentication)

## Stack
- Frontend: React + Vite
- Backend: Express + BullMQ 5 + ioredis + SQLite (`better-sqlite3`) + Zod, CommonJS
- Queue broker: Redis

## Process layout

Two Node processes share one SQLite file (`server/data/queue-system.db`, WAL mode):

- **API** — `server/src/server.js`: CORS, JSON body (2 MB), `/api/health`, `/api/campaigns`,
  `/api/dashboard`, Bull Board (`server.js:29-32,59`).
- **Worker** — `server/src/worker.js` is a one-line file that requires
  `server/src/workers/emailWorker.js`, which creates the BullMQ `Worker` (`emailWorker.js:28-38`)
  and translates worker events into `campaign_jobs` updates.

## Queue workflow
1. Create campaign via API/UI (`POST /api/campaigns`, `campaigns.js:40-110`).
2. Server inserts the campaign row, then `addBulk`s one `email-jobs` message per recipient with a
   deterministic `jobId` of `<campaignId>:<n>:<email>` (`campaigns.js:54-77`), then records one
   `campaign_jobs` row per queue job in a SQLite transaction (`campaigns.js:80-88`).
3. Worker processes jobs; `active` and `completed` events update the row (`emailWorker.js:44-70`).
4. Failures are retried automatically (`attempts`, `backoff`); each non-final failure sets the row to
   `retrying` (`emailWorker.js:72-91`).
5. On the final failure (`attemptsMade >= opts.attempts`, `emailWorker.js:78`) the job is copied to
   `dead-letter-jobs` and persisted in `dead_letters` with a payload snapshot (`emailWorker.js:95-126`).
6. Dead-letter entries can be requeued from the dashboard: a fresh job with a new id, a new
   `campaign_jobs` row, and the dead letter marked resolved (`server/src/routes/dashboard.js:113-178`).

## Local setup
1. Install Redis and run it on `127.0.0.1:6379`.
2. Install dependencies:

```bash
npm install
npm run install:all
```

3. Start API, worker, and frontend (three processes via `concurrently`, root `package.json`):

```bash
npm run dev
```

- API: `http://localhost:4100`
- Frontend: `http://localhost:5175`
- Bull Board: `http://localhost:4100/admin/queues`

## Environment
Server env file: `server/.env` (defaults in `server/src/lib/config.js`)

```env
PORT=4100
CLIENT_ORIGIN=http://localhost:5175
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
WORKER_CONCURRENCY=8
```

Client env file: `client/.env` (optional)

```env
VITE_API_URL=http://localhost:4100/api
```

## Key API routes
- `POST /api/campaigns` create bulk campaign and enqueue jobs (`campaignName`, `subject`, `body`, `recipients` ≤ 5000, optional `failRate` 0-1 default 0.25, `maxAttempts`, `backoffMs`)
- `GET /api/campaigns` list campaigns with per-status totals (`page`, `pageSize` ≤ 100)
- `GET /api/campaigns/:campaignId/jobs` list jobs for one campaign
- `GET /api/dashboard/summary` BullMQ job counts for both queues + SQLite status counts + unresolved dead letters
- `GET /api/dashboard/recent-jobs` latest job activity
- `GET /api/dashboard/dead-letters` dead-letter entries
- `POST /api/dashboard/dead-letters/:id/requeue` requeue dead-letter job

## Notes
- This machine did not have Redis installed during verification, so end-to-end queue execution requires starting Redis first.
- The API health endpoint reports Redis state without hanging: it races `PING` against an 800 ms
  timeout (`server.js:34-54`). Other Redis-backed routes have no such timeout; see review #3.

## Exercises

1. **Goal:** watch retries and the DLQ boundary.
   **Check:** create a campaign with `failRate: 1`, `maxAttempts: 2`, `backoffMs: 250`; each job's row
   goes `queued -> active -> retrying -> active -> failed`, and exactly one `dead_letters` row exists
   per recipient.
2. **Goal:** see that requeue is a new identity.
   **Check:** requeue one dead letter; `campaign_jobs` gains a row with a new `queue_job_id`, the old
   row stays `failed`, and the dead letter has `resolved = 1`.
3. **Goal:** reproduce the validation bug (review #1) safely.
   **Check:** `GET /api/campaigns?pageSize=500` returns 400 and the API log then shows an
   `ERR_HTTP_HEADERS_SENT` error from the same request.
4. **Goal:** close the enqueue/row race (review #2).
   **Check:** after inserting the `campaign_jobs` rows *before* `addBulk` (or upserting in the worker),
   a campaign with `failRate: 0` and 500 recipients ends with every row `completed`.

## Senior review (from reading the code)

1. **`validateOrRespond` returns a truthy value on failure.** It does
   `return res.status(400).json(...)` (`server/src/lib/validation.js:28`), which returns the Express
   `res` object, so every caller's `if (!data) return;` falls through. In `POST /api/campaigns` the
   handler then reads `res.recipients.map` and throws inside an `async` handler, which Express 4 does
   not catch (an unhandled rejection). Sync routes send a second response and log
   `ERR_HTTP_HEADERS_SENT`. Return `null` after responding, as the other pracyce projects do.
2. **Jobs can finish before their row exists.** Jobs are in Redis after `addBulk` (`campaigns.js:77`)
   but rows are inserted afterwards (`campaigns.js:80-88`). The worker's `UPDATE ... WHERE queue_job_id = ?`
   (`emailWorker.js:10-14`) silently matches nothing if it runs first, and the row is then inserted
   as `queued` forever.
3. **Redis outages hang requests instead of failing them.** The shared connection sets
   `maxRetriesPerRequest: null` (`server/src/lib/redis.js:9`), so commands wait for a reconnect.
   `/dashboard/summary` awaits `getJobCounts` before any SQLite read (`dashboard.js:10-13`), and
   campaign creation awaits `addBulk`; neither has a timeout.
4. **Requeue is not idempotent.** Two quick clicks can both pass the `resolved` check before either
   marks it resolved (`dashboard.js:113-172`), creating two jobs for one dead letter.
5. **Dead-lettering is two writes, not one.** The BullMQ DLQ add and the SQLite insert
   (`emailWorker.js:106-126`) can diverge if the process dies between them; only the SQLite insert is
   idempotent (`INSERT OR IGNORE`).
6. **Unused code.** `emailQueueEvents` is created (`server/src/queues/index.js:37`) but never used,
   and nothing consumes `dead-letter-jobs`.
7. **Operator surfaces are open.** Bull Board can retry, promote and delete jobs, and is mounted with
   no authentication (`server.js:59`).
