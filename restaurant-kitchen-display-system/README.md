# Restaurant Kitchen Display System (KDS)

Real-time kitchen operations app with multi-channel intake, station routing, item lifecycle tracking, priority bumping, 86 handling, and late-order alerts.

## Features
- Intake channels: `dine_in`, `delivery_app`, `phone`
- Fan-out: each order item routes to station (`grill`, `fryer`, `salad`)
- Station workflow: `queued -> started -> cooking -> ready`
- Fan-in aggregation: order becomes `ready` only when all items are terminal (`ready` or `eighty_sixed`)
- Priority bumping: `normal`, `high`, `rush`
- Mid-service 86 handling:
  - manual per item
  - global menu-item 86 that auto-updates active queued/cooking items
- Timing targets + late alerts (`due_at`, `is_late`)
- WebSocket live updates via Socket.IO

## Stack
- Backend: Node.js + Express + Socket.IO + SQLite (`better-sqlite3`)
- Frontend: React + Vite + Socket.IO client

## Run
```bash
npm install
npm run install:all
npm run dev
```

- Frontend: `http://localhost:5177`
- API: `http://localhost:4300`

## Key API endpoints
- `GET /api/menu-items`
- `PATCH /api/menu-items/:menuItemId/availability`
- `POST /api/orders`
- `GET /api/orders`
- `GET /api/orders/:orderId`
- `PATCH /api/orders/:orderId/priority`
- `PATCH /api/order-items/:itemId/status`
- `PATCH /api/order-items/:itemId/eighty-six`
- `GET /api/stations/:station/board`
- `GET /api/alerts/late`

## Realtime event channel
Server emits `kds_event` payloads when:
- orders/items/menu change
- late alert set changes

## Notes
- Seed menu items are inserted automatically on first boot.
- Data lives in `server/data/kds.db`.