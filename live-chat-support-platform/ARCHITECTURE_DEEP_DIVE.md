# Live Chat Support Platform - Architecture Deep Dive

This document explains the live-chat project in detail: architecture choices, data flow, and a build-from-scratch path for junior developers.

## 1. Product Goal

Build a real-time support platform with:
- multi-room chat
- typing indicators
- read receipts
- file uploads
- agent dashboard for active conversations
- persistent messages and search

## 2. System Architecture

## 2.1 Components
- Express API (`server/src/server.js` + routes)
- Socket.IO realtime server (`server/src/socket.js`)
- SQLite persistence (`server/src/db/database.js`)
- React client (`client/src/App.jsx`)

All components run in one backend process:
- REST endpoints for CRUD/read models/uploads
- websocket events for realtime collaboration

Why single server:
- easiest local setup
- same origin for API + websocket + static uploads

## 2.2 Data ownership
- SQLite is source of truth for users, rooms, messages, read receipts.
- In-memory maps in socket server are source of truth for *current online presence* only.

This split keeps durable history persistent while keeping presence fast.

## 3. Database Model

Tables:
- `users` (`agent` or `customer`)
- `rooms`
- `room_participants`
- `messages`
- `read_receipts`

Key relationships:
- room has many participants
- room has many messages
- message has many read receipts

Why separate `read_receipts` table:
- supports per-user read status
- avoids mutating message records for each viewer

## 4. Realtime Event Model

### Client -> Server events
- `join_room`
- `send_message`
- `typing`
- `mark_read`
- `watch_as_agent`

### Server -> Client events
- `joined_room`
- `new_message`
- `typing_update`
- `read_update`
- `room_presence`
- `conversation_updated`

Design principle:
- save to DB first, then broadcast authoritative record
- avoids UI seeing messages that never persisted

## 5. REST API Responsibilities

File: `server/src/routes/api.js`

REST is used for:
- session upsert (`POST /session`)
- room creation/list
- message history fetch
- message search
- file uploads
- agent active-conversation read model

Why REST + Socket together:
- websocket is ideal for push updates
- REST is still best for initial load, search, pagination-like reads, and uploads

## 6. Socket Server Responsibilities

File: `server/src/socket.js`

### Presence
- `onlineByRoom: Map<roomId, Set<userDescriptor>>`
- updated on join/disconnect
- emitted via `room_presence`

### Message send
1. Validate payload.
2. Ensure room/user/participant state.
3. Insert message row.
4. Mark sender as read for own message.
5. Query inserted row with sender/read metadata.
6. Emit `new_message` to room.
7. Emit `conversation_updated` to agents room.

### Read receipts
- `mark_read` takes an `uptoMessageId` cursor.
- server marks all earlier messages as read in one transaction.

Why cursor-based mark-read:
- robust against out-of-order deliveries
- simpler client contract than per-message acknowledgements

### Typing indicators
- transient, not persisted
- relayed only to other users in same room

## 7. Client Architecture

File: `client/src/App.jsx`

Single-page structure:
- session entry (choose role + name)
- sidebar (rooms + unread + online count)
- chat panel (message list + composer)
- insights panel (search + agent conversation board)

Key client state buckets:
- identity/session
- room list + selected room
- message cache by room (`messagesByRoom`)
- typing indicators by room (`typingByRoom`)
- search results
- agent active conversations

## 8. Data Flow Examples

### Example A: sending a message with file
1. User picks file.
2. Client uploads via REST `/uploads`.
3. API returns attachment metadata + URL.
4. Client emits `send_message` with text + attachment metadata.
5. Server persists message and broadcasts.
6. All room participants render message.

### Example B: read receipt update
1. Room opened.
2. Client fetches messages via REST.
3. Client emits `mark_read` for latest message.
4. Server marks message range read in DB.
5. Server broadcasts `read_update`.
6. Clients refresh room message view/read counts.

### Example C: agent dashboard refresh
1. Message sent in any room.
2. Server emits `conversation_updated` to `agents` channel.
3. Agent client refreshes active conversation list.

## 9. Build-From-Scratch Plan (Junior-Friendly)

1. Create Express API + SQLite schema.
2. Add room/message REST endpoints (no realtime yet).
3. Add React UI that can create rooms and load messages.
4. Integrate Socket.IO on server and client.
5. Implement `join_room` and `new_message` events.
6. Persist messages on send before broadcast.
7. Add typing events.
8. Add read receipts table + `mark_read` event.
9. Add file uploads (`multer`) + attachment rendering.
10. Add room summaries and unread counts in service layer.
11. Add message search endpoint + UI.
12. Add agent dashboard endpoint + socket refresh hook.
13. Add online presence tracking and display.

## 10. Why Certain Choices Were Made

- SQLite instead of Postgres:
  - lower setup friction for portfolio/local demo
- in-memory presence map instead of DB:
  - presence is highly volatile and low-value to persist long-term
- room summary computed on backend:
  - avoids heavy client-side joins/N+1 calls
- one App component for this size:
  - fastest delivery; can be split into feature modules later

## 11. Common Mistakes to Avoid

- broadcasting unsaved message payloads (can create ghost messages)
- forgetting room membership validation on send
- storing typing indicators in DB (unnecessary churn)
- not cleaning online presence on disconnect
- calculating unread counts only client-side from partial cache

## 12. Production-Readiness Upgrades

- authentication/authorization with real identities
- file scanning + object storage (S3/GCS) instead of local disk
- message pagination cursors for very large rooms
- rate limiting and websocket abuse protection
- horizontal scaling with socket adapter (Redis adapter)

## 13. File Map to Study

Backend:
- `server/src/server.js`
- `server/src/socket.js`
- `server/src/routes/api.js`
- `server/src/lib/chatService.js`
- `server/src/db/database.js`

Frontend:
- `client/src/App.jsx`
- `client/src/lib/socket.js`
- `client/src/lib/api.js`
- `client/src/styles.css`