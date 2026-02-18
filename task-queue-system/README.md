# Task Queue / Background Job System

A full JavaScript app that demonstrates async job processing with **BullMQ + Redis** using a bulk email sender workflow.

## Features
- Bulk campaign creation (`N` recipients -> `N` queued jobs)
- BullMQ worker with configurable concurrency
- Retry logic with exponential backoff
- Dead-letter queue for terminal failures
- Dead-letter requeue action
- Monitoring dashboard (React UI)
- Bull Board admin dashboard (`/admin/queues`)

## Stack
- Frontend: React + Vite
- Backend: Express + BullMQ + ioredis + SQLite (`better-sqlite3`)
- Queue broker: Redis

## Queue workflow
1. Create campaign via API/UI.
2. Server enqueues one `email-jobs` message per recipient.
3. Worker processes jobs.
4. Failures are retried automatically (`attempts`, `backoff`).
5. Terminal failures are copied into `dead-letter-jobs` and persisted.
6. Dead-letter entries can be requeued from the dashboard.

## Local setup
1. Install Redis and run it on `127.0.0.1:6379`.
2. Install dependencies:

```bash
npm install
npm run install:all
```

3. Start API, worker, and frontend:

```bash
npm run dev
```

- API: `http://localhost:4100`
- Frontend: `http://localhost:5175`
- Bull Board: `http://localhost:4100/admin/queues`

## Environment
Server env file: `server/.env`

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
- `POST /api/campaigns` create bulk campaign and enqueue jobs
- `GET /api/campaigns` list campaigns with status totals
- `GET /api/campaigns/:campaignId/jobs` list jobs for one campaign
- `GET /api/dashboard/summary` queue + DB summary stats
- `GET /api/dashboard/recent-jobs` latest job activity
- `GET /api/dashboard/dead-letters` dead-letter entries
- `POST /api/dashboard/dead-letters/:id/requeue` requeue dead-letter job

## Notes
- This machine did not have Redis installed during verification, so end-to-end queue execution requires starting Redis first.
- The API health endpoint reports Redis state without hanging.