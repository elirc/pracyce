# Live Chat Support Platform

Multi-room real-time support chat with typing indicators, read receipts, file uploads, agent-facing active conversation dashboard, persistent storage, and message search.

This is a single-process demo with **no authentication**: every identity is a client-generated
UUID plus a self-chosen name and role. Read the Senior review before treating any of the
"agent" features as access-controlled. There are no automated tests. Everything below was read
from the source; nothing was produced by running it.

## Stack
- Frontend: React + Vite + Socket.IO client (`client/src/App.jsx`, one ~690-line component)
- Backend: Express + Socket.IO + SQLite (`better-sqlite3`) + Multer + Zod, CommonJS
  (`server/src/server.js`)

REST and Socket.IO share one HTTP server (`server/src/server.js:34-43`), so the API, websocket
and uploaded files are all served from port 4200.

## Features
- Multi-room chat (`customer` or `agent` sessions)
- Typing indicators per room (relayed, never stored — `server/src/socket.js:94-104`)
- Read receipts (`Read by N`, counting readers other than the sender — `server/src/lib/chatService.js:95`)
- File uploads up to 10 MB, any type (`server/src/routes/api.js:23-36`), served from `/uploads`
- Agent dashboard showing every room, newest activity first (`api.js:118-155`)
- Message persistence in SQLite (`server/data/chat.db`, WAL mode — `server/src/db/database.js:5-14`)
- Message search, all rooms or one room, case-insensitive substring (`api.js:157-203`)

## Local Run
```bash
npm install
npm run install:all
npm run dev
```

- Client: `http://localhost:5176` (`vite --port 5176` in `client/package.json`)
- API: `http://localhost:4200`
- Health: `http://localhost:4200/api/health`

## Environment
Server: `server/.env` (defaults in `server/src/lib/config.js`)
```env
PORT=4200
CLIENT_ORIGIN=http://localhost:5176
```

Client: `client/.env` (optional; a copy with these values is committed)
```env
VITE_API_URL=http://localhost:4200/api
VITE_SOCKET_URL=http://localhost:4200
```

`CLIENT_ORIGIN` is used for both Express CORS and Socket.IO CORS (`server.js:16-20,37-41`).

## Data model

Five tables, created on startup with `CREATE TABLE IF NOT EXISTS` (`server/src/db/database.js:16-68`):
`users` (role constrained to `agent`/`customer` by a `CHECK`, line 20), `rooms`,
`room_participants` (composite key room + user), `messages` (text and/or `attachment_json`),
`read_receipts` (composite key message + user). Presence is **not** stored; it lives in an
in-memory `Map` inside the socket server (`socket.js:7`).

## Core API
| Endpoint | Behaviour |
| --- | --- |
| `POST /api/session` | upserts `{ userId (uuid), name, role }`; an existing id gets its name and role **overwritten** (`chatService.js:3-10`, `api.js:38-47`) |
| `GET /api/rooms?userId=<uuid>&role=agent\|customer` | agents get every room, customers only rooms they joined; each with `lastMessage`, `unread`, `onlineCount` (`chatService.js:33-78`) |
| `POST /api/rooms` | creates a room; `createdBy` is auto-joined (`api.js:66-94`) |
| `GET /api/rooms/:roomId/messages` | newest 50 by default (max 100), optional `before` timestamp cursor, returned oldest-first (`chatService.js:80-126`) |
| `GET /api/agent/active-conversations` | every room with participant count, last message and live online count |
| `GET /api/messages/search?q=...&roomId=...` | up to 30 hits by default (max 100) |
| `POST /api/uploads` | multipart `file`; returns `{ attachment: { url, filename, mimeType, size } }` |

Validation errors are `400 { message: 'Validation failed', errors: [...] }`
(`server/src/lib/validation.js:26-43`).

## Socket Events
- Client -> Server: `join_room`, `send_message` (with ack callback), `typing`, `mark_read`, `watch_as_agent`
- Server -> Client: `joined_room` (with the last 50 messages), `new_message`, `typing_update`, `read_update`, `room_presence`, `conversation_updated`, `server_error`

`send_message` (`socket.js:106-182`) saves the message, marks it read by its sender, re-reads the
saved row with sender name and read count, then emits `new_message` to the room and
`conversation_updated` to the `agents` channel. See
[ARCHITECTURE_DEEP_DIVE.md](ARCHITECTURE_DEEP_DIVE.md) for the full flows.

## Exercises

1. **Goal:** watch save-then-broadcast.
   **Check:** send a message with two browser tabs in the same room; both render the same `id`,
   and that id is already a row in `messages` when the ack callback fires.
2. **Goal:** see why read receipts use a cursor.
   **Check:** after `mark_read` with the newest message id, `read_receipts` has one row per earlier
   message in that room for your user (`socket.js:184-211`), written in one transaction.
3. **Goal:** reproduce the presence bug (review #4).
   **Check:** join a room as the same user in two tabs, close one; the remaining tab's
   `room_presence` reports zero users even though it is still connected.
4. **Goal:** add a membership check to `send_message`.
   **Check:** a socket that never emitted `join_room` for a room gets `{ ok: false }` from
   `send_message` and no row is inserted.

## Senior review (from reading the code)

1. **One bad event crashes the server.** `join_room` (`socket.js:56-92`) has no `try/catch` and
   passes the client's `role` straight to `ensureUser`. Any role other than `agent`/`customer`
   violates the `CHECK` constraint (`database.js:20`), `better-sqlite3` throws synchronously inside
   the Socket.IO listener, and no code in the app catches it, so it surfaces as an uncaught
   exception (which ends a Node process by default). `send_message` is wrapped (line 107);
   `join_room` and `mark_read` are not. Validate socket payloads with the same Zod schemas the
   REST routes use.
2. **Identity is whatever the client says.** Every socket payload carries its own `userId`, `name`
   and `role`; `send_message` and `join_room` upsert them (`socket.js:68,131`), so any client can
   post as another user id and rename that user. Any socket can also join any room id, and
   `GET /api/rooms?role=agent` hands out every room id.
3. **Agent-only data is open to everyone.** `watch_as_agent` (`socket.js:213-217`) joins the
   `agents` channel without a role check, and `/agent/active-conversations` and global
   `/messages/search` have no caller check at all.
4. **Presence is per user, not per socket.** `removeOnline` deletes every entry for the user id
   (`socket.js:40-53`) when *any* of that user's sockets disconnects.
5. **Uploads are stored XSS on the API origin.** Any file type is accepted, the original extension
   is kept (`api.js:26`), and `express.static` serves it from `/uploads` (`server.js:23`), so an
   uploaded `.html` or `.svg` runs script on `localhost:4200`.
6. **Server-side N+1.** `getRoomsForUser` prepares and runs two queries per room inside a `map`
   (`chatService.js:46-69`); the comment's "no N+1" refers to the client only.
7. **Unbounded resources.** No rate limiting, no upload quota, no cleanup of `uploads/`.
