# Restaurant Kitchen Display System (KDS)

Real-time kitchen operations app with multi-channel intake, station routing, item lifecycle tracking, priority bumping, 86 handling, and late-order alerts.

Single-process demo: no authentication, no automated tests. Everything below was read from the
source in `server/src` and `client/src`; nothing was produced by running it.

## Features
- Intake channels: `dine_in`, `delivery_app`, `phone` (`server/src/lib/validation.js:3-8`)
- Fan-out: each order item is routed to its menu item's station (`grill`, `fryer`, `salad`) at
  creation time, inside one transaction (`server/src/routes/api.js:164-195`)
- Station workflow: `queued -> started -> cooking -> ready`. The server allows **skipping forward**
  (`queued -> ready` and `started -> ready` are legal, `api.js:25-31`); it only forbids going back.
- Fan-in aggregation: after every item change, `recomputeOrder` sets the order to `ready` when all
  items are terminal (`ready` or `eighty_sixed`), `in_progress` when any item is `started` or
  `cooking`, otherwise `queued` (`server/src/lib/kdsService.js:12-51`)
- Priority bumping: orders start `normal` and can be bumped to `high` or `rush`
  (`validation.js:14-16`); boards sort `rush`, then `high`, then `normal`, then by due time
  (`kdsService.js:3-4`). There is no way back down to `normal`.
- Mid-service 86 handling:
  - manual per item, refused only for `ready` items (`api.js:306-350`)
  - global menu-item 86 (`PATCH /menu-items/:id/availability` with `isAvailable: false`) marks
    every `queued`, `started` or `cooking` item of that menu item as `eighty_sixed`
    (`api.js:76-105`), and new orders containing it are rejected with 400 (`api.js:136-141`)
- Timing targets + late alerts: `due_at = created + targetMinutes` (default 20, 5-120,
  `api.js:143-146`); `is_late` is recomputed on every order change and by a timer
- WebSocket live updates via Socket.IO, all on one event name, `kds_event`
- An append-only `kitchen_events` table records every routing, status change, 86 and priority bump
  (`kdsService.js:6-10`); nothing reads it back yet

## Stack
- Backend: Node.js + Express + Socket.IO + SQLite (`better-sqlite3`) + Zod, CommonJS
- Frontend: React + Vite + Socket.IO client (`client/src/App.jsx`, one ~500-line component)

## Run
```bash
npm install
npm run install:all
npm run dev
```

- Frontend: `http://localhost:5177` (`vite --port 5177`)
- API: `http://localhost:4300` (health: `GET /api/health`)

Server settings come from `server/.env` with defaults in `server/src/lib/config.js`: `PORT` (4300),
`CLIENT_ORIGIN` (`http://localhost:5177`) and `LATE_ALERT_POLL_MS` (10000; the timer never runs
faster than every 3 s, `server/src/server.js:38-49`).

## Key API endpoints

| Endpoint | Notes |
| --- | --- |
| `GET /api/menu-items` | ordered by station, then name |
| `PATCH /api/menu-items/:menuItemId/availability` | `{ isAvailable, reason? }`; returns `affectedOrders` |
| `POST /api/orders` | `{ channel, ticketName?, targetMinutes?, items: [{ menuItemId, notes? }] }`, 1-30 items |
| `GET /api/orders` | `station`, `status` (`queued`/`in_progress`/`ready`), `includeLateOnly`; items loaded with one `IN (...)` query, not per order (`kdsService.js:107-170`) |
| `GET /api/orders/:orderId` | order with items in position order |
| `PATCH /api/orders/:orderId/priority` | `{ priority: 'high' \| 'rush' }` |
| `PATCH /api/order-items/:itemId/status` | `{ status: 'started' \| 'cooking' \| 'ready' }` |
| `PATCH /api/order-items/:itemId/eighty-six` | `{ reason? }` |
| `GET /api/stations/:station/board` | active items (`queued`/`started`/`cooking`) for one station |
| `GET /api/alerts/late` | refreshes late flags, then lists late, not-ready orders |

## Realtime event channel

Every event is `io.emit('kds_event', { type, payload, timestamp })` to **all** clients
(`api.js:36-42`). Types: `connected`, `order_created`, `order_updated`, `item_updated`,
`menu_item_updated`, `late_alerts_changed`. The late-alert timer (`server.js:37-49`) only emits
when the set of late order ids changes.

## Notes
- Six seed menu items (burger, steak, fries, onion rings, two salads) are inserted on first boot
  when `menu_items` is empty (`server/src/db/database.js:74-97`).
- Data lives in `server/data/kds.db` (WAL mode). Schema is `CREATE TABLE IF NOT EXISTS`; there are
  no migrations.

## Exercises

1. **Goal:** watch fan-in.
   **Check:** create an order with a burger and fries; mark the burger `ready` and the order stays
   `queued` (no item is `started`/`cooking`); mark the fries `cooking` and it becomes `in_progress`;
   mark the fries `ready` and it becomes `ready` with `ready_at` set.
2. **Goal:** see the global 86 cascade.
   **Check:** with two open orders containing fries, `PATCH /api/menu-items/fries/availability`
   with `{"isAvailable": false}` returns both order ids in `affectedOrders`, and a new order with
   fries returns 400 `Menu item unavailable: Fries`.
3. **Goal:** reproduce the query-flag bug (review #1).
   **Check:** `GET /api/orders?includeLateOnly=false` returns only late orders.
4. **Goal:** make the workflow strictly linear, if that is the product rule.
   **Check:** after editing `TRANSITIONS`, `queued -> ready` returns 400 `Invalid transition from queued to ready`.

## Senior review (from reading the code)

1. **`includeLateOnly=false` means true.** `z.coerce.boolean()` (`validation.js:25`) turns any
   non-empty string, including `"false"`, into `true`. Use an explicit `'true' | 'false'` enum.
2. **A fully 86'd order reads as "ready".** `recomputeOrder` treats `eighty_sixed` as terminal
   (`kdsService.js:29-34`), so an order whose every item was 86'd gets `status = 'ready'` and a
   `ready_at`, and drops out of late alerts, although nothing is ready to serve.
3. **Partially ready orders read as "queued".** Only `started`/`cooking` count as activity
   (`kdsService.js:19,35-37`); an order with one `ready` and one `queued` item is `queued`.
4. **Global 86 is not atomic.** The menu update, each item update and each event insert are
   separate statements (`api.js:62-104`); a failure part-way leaves some items 86'd and others not.
   Item creation, by contrast, uses `db.transaction` (`api.js:164-195`).
5. **The late timer rewrites every order.** `refreshLateFlags` runs an `UPDATE orders` with no
   `WHERE` clause every poll (`kdsService.js:53-62`), including long-finished orders.
6. **Manual 86 is not idempotent.** An item that is already `eighty_sixed` can be 86'd again,
   which overwrites its note and writes another event (`api.js:318-334`).
7. **Open to anyone on the network.** No auth on any route, and every client receives every event.
