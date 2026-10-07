# Job Application Tracker - Architecture Deep Dive

This copy lives in `job-tracker-next/` and is intentionally isolated from the original tracker folder.

This document explains how the project is built, why each part exists, and how a junior developer could build the same system from zero.

## 1. What This App Does

The app is a full-stack tracker for a user's job pipeline:
- user authentication (register/login/session)
- protected app routes
- CRUD on job applications
- filter + sort + pagination
- workflow transitions (`applied -> interview -> offer/rejected`)
- dashboard metrics

## 2. Tech Stack and Why

### Backend
- Node + Express: fast API iteration, simple middleware model
- SQLite via `better-sqlite3`: zero external infra needed, fast local persistence
- JWT: stateless auth for API routes
- Zod: reliable runtime validation

### Frontend
- React + Vite: simple SPA setup
- React Router: route-level auth gating
- Zustand: lightweight global session state
- React Hook Form + Zod: form validation with minimal boilerplate
- Axios: shared API client + auth header interceptor

## 3. High-Level System Design

### Request flow
1. User authenticates (`/api/auth/register` or `/api/auth/login`).
2. Server returns JWT + user payload.
3. Client stores token in localStorage + Zustand.
4. Axios attaches `Authorization: Bearer <token>`.
5. Protected routes call API; backend middleware validates token.

### Data ownership
- Backend is source of truth for:
  - auth validation
  - workflow transition rules
  - query filtering/sorting/pagination
- Frontend is source of truth for:
  - current UI state (filters, modal open/close)
  - pending async loading/error states

## 4. Backend Structure

### Entry point (`server/src/server.js`)
Responsibilities:
- load env
- assert `JWT_SECRET`
- initialize DB schema (`require('./db')`)
- register middleware (`cors`, `json`, `morgan`)
- mount domain routes:
  - `/api/auth`
  - `/api/applications`
  - `/api/dashboard`

Why this order matters:
- DB schema must exist before any route handler runs
- JSON parsing middleware must be active before POST/PUT handlers

### DB bootstrap (`server/src/db.js`)
Creates tables and indexes once at startup:
- `users`
- `applications`
Indexes:
- user-scoped lookups
- status filters
- date sorting

Why create schema in code:
- easy onboarding
- no manual migration step for small project

### Validation (`server/src/validation.js`)
All request contracts are centrally defined:
- auth payloads
- application create/update payloads
- query params

Why centralize:
- avoids validation logic being scattered across routes
- easier to update contract in one place

### Auth middleware (`server/src/middleware/auth.js`)
- extracts bearer token
- verifies JWT with server secret
- attaches decoded user to `req.user`

Why middleware:
- all protected routes share one gate
- keeps handlers focused on business logic

### Application routes (`server/src/routes/applications.js`)
Core behaviors:
- list with filter/search/sort/page
- create, read single, update, delete
- explicit transition endpoint (`PATCH /:id/transition`)

Important design choices:
- all queries are user-scoped (`user_id = req.user.id`); reads, updates and deletes put both `id` and `user_id` in the `WHERE` clause (`applications.js:73,122,202,237`), so another user's id is a 404, never a 403
- workflow transitions validated server-side (never trust UI only) — on `PUT` (`applications.js:134-142`) and on `PATCH /:id/transition` (`applications.js:207-217`). Create is **not** guarded: `POST` accepts any status (`validation.js:44`)
- partial update salary check runs after merge to prevent invalid min/max combinations (`applications.js:153-164`)
- `sort_by` is interpolated into `ORDER BY` (`applications.js:51`), which is safe only because `querySchema` restricts it to six column names (`validation.js:68`)

### Dashboard route (`server/src/routes/dashboard.js`)
- grouped counts by status (`dashboard.js:11-18`), zero-filled for every status (`dashboard.js:22-25`)
- derived KPIs: `active = applied + interview`, `conversionRate = (offer + interview) / total` as a percentage with one decimal (`dashboard.js:31-33`). Despite the name, interviews count as conversions.

Why precompute on server:
- keeps frontend simple
- avoids recomputing from full dataset client-side

## 5. Frontend Structure

### Router and auth boot (`client/src/App.jsx`)
- `AuthBootstrap` runs once to hydrate session
- public routes: `/login`, `/register`
- protected app shell at `/`

Why hydrate before rendering protected content:
- prevents flash of unauthorized routes
- ensures stale tokens are cleaned by `/auth/me` validation

### Session store (`client/src/store/authStore.js`)
State:
- `user`, `token`, `isReady`
Actions:
- `hydrate()`
- `setSession()`
- `logout()`

Why `isReady` exists:
- UI can distinguish "still checking session" vs "not logged in"

### Applications page (`client/src/pages/ApplicationsPage.jsx`)
Major patterns:
- debounced search text -> API params
- `loadApplications()` reused after every mutation
- modal reused for create and edit
- transition buttons map to allowed next states

Why reuse one loader:
- every mutation gets fresh data from source of truth
- avoids client-side patch bugs on table rows

### Form modal (`client/src/components/ApplicationFormModal.jsx`)
- zod schema for field-level constraints
- supports both create and edit initial values

Why one modal component:
- avoids duplicate form logic and drift

## 6. Build-From-Scratch Plan (Junior-Friendly)

If building from zero, do this order:

1. Scaffold backend and frontend.
2. Add DB with `users` and `applications` tables.
3. Implement auth endpoints and JWT middleware.
4. Build protected `/applications` read endpoint first.
5. Add create/update/delete endpoints.
6. Add status transition rules and endpoint.
7. Add dashboard aggregate endpoint.
8. Build frontend auth pages and route guard.
9. Build list view (read-only first).
10. Add filters/sort/page query wiring.
11. Add create/edit modal forms.
12. Add delete + transition actions.
13. Add dashboard cards.
14. Add polish: loading/errors/empty states.

## 7. How Pieces Fit Together (Concrete Example)

Example: moving `applied -> interview`

1. User clicks "Move to Interview".
2. UI calls `PATCH /api/applications/:id/transition`.
3. Backend checks:
   - user owns row
   - current status is `applied`
   - `interview` is allowed transition
4. Backend updates row + `updated_at`.
5. UI reloads list using `loadApplications()`.
6. Dashboard stats reflect new counts on next fetch.

## 8. Security and Correctness Notes

- Auth token is server-verified (`/auth/me`) during hydrate (`client/src/store/authStore.js:22-30`); after that, every API call is checked by `requireAuth` (`server/src/middleware/auth.js`), which verifies the signature and expiry but does not look the user up.
- All app rows are user-scoped in SQL.
- Workflow enforcement for **updates** is backend-only source of truth; the initial status on create is whatever the client sends.
- Query param validation limits invalid sorting/filtering fields.
- Gaps found on review: async `register`/`login` handlers (`routes/auth.js:11,44`) can reject outside Express 4's error handling; no rate limiting on auth; JWTs cannot be revoked before their 7-day expiry; there are no tests.

## 9. Common Mistakes to Avoid

- trusting front-end-only transition validation
- forgetting `user_id` in WHERE clauses
- updating list UI optimistically without reconciling server truth
- not validating partial updates after merged state

## 10. Next Improvements (If Extending)

- refresh tokens and rotating JWT secrets
- per-field audit history (status changed by/date)
- stronger pagination (cursor-based)
- test suite (API + component tests) — none exists today
- force `applied` (or validate the initial state) on create
- wrap async handlers (or move to Express 5) so rejected promises reach the error middleware
- role-based collaboration (team view)

## 11. File Map to Study

Backend:
- `server/src/server.js`
- `server/src/db.js`
- `server/src/middleware/auth.js`
- `server/src/routes/auth.js`
- `server/src/routes/applications.js`
- `server/src/routes/dashboard.js`
- `server/src/validation.js`

Frontend:
- `client/src/App.jsx`
- `client/src/store/authStore.js`
- `client/src/lib/api.js`
- `client/src/pages/ApplicationsPage.jsx`
- `client/src/components/ApplicationFormModal.jsx`
- `client/src/pages/DashboardPage.jsx`

## 12. Exercises

1. **Goal:** trace one transition end to end.
   **Check:** you can point to the button handler (`client/src/pages/ApplicationsPage.jsx:126-138`), the route (`server/src/routes/applications.js:191-229`) and the rule table (`server/src/constants.js:10-15`), and predict the 400 message for `interview -> applied`.
2. **Goal:** prove the post-merge salary check matters.
   **Check:** on a row with `salary_min: 100000`, `PUT` with only `{"salary_max": 50000}` passes the Zod schema (the refine only sees one field) and is rejected by the merge check with 400 `salary_max must be greater than or equal to salary_min`.
3. **Goal:** see why hydrate exists.
   **Check:** put a garbage value in `localStorage.job_tracker_token` (with any `job_tracker_user`) and reload; `/auth/me` returns 401 and both keys are removed before the login page renders.
