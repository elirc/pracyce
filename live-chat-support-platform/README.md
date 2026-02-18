# Live Chat Support Platform

Multi-room real-time support chat with typing indicators, read receipts, file uploads, agent-facing active conversation dashboard, persistent storage, and message search.

## Stack
- Frontend: React + Vite + Socket.IO client
- Backend: Express + Socket.IO + SQLite (`better-sqlite3`) + Multer

## Features
- Multi-room chat (`customer` or `agent` sessions)
- Typing indicators per room
- Read receipts (`Read by N`)
- File uploads (images/files) and attachment rendering
- Agent dashboard showing all active conversations
- Message persistence in SQLite
- Message search (all rooms or current room)

## Local Run
```bash
npm install
npm run install:all
npm run dev
```

- Client: `http://localhost:5176`
- API: `http://localhost:4200`
- Health: `http://localhost:4200/api/health`

## Environment
Server: `server/.env`
```env
PORT=4200
CLIENT_ORIGIN=http://localhost:5176
```

Client: `client/.env` (optional)
```env
VITE_API_URL=http://localhost:4200/api
VITE_SOCKET_URL=http://localhost:4200
```

## Core API
- `POST /api/session`
- `GET /api/rooms?userId=<uuid>&role=agent|customer`
- `POST /api/rooms`
- `GET /api/rooms/:roomId/messages`
- `GET /api/agent/active-conversations`
- `GET /api/messages/search?q=...`
- `POST /api/uploads`

## Socket Events
- Client -> Server: `join_room`, `send_message`, `typing`, `mark_read`, `watch_as_agent`
- Server -> Client: `joined_room`, `new_message`, `typing_update`, `read_update`, `room_presence`, `conversation_updated`