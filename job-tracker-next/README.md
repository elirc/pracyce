# Job Application Tracker

Full-stack JavaScript app for tracking job applications with auth, protected routes, validation, CRUD, filtering/sorting, workflow transitions, and dashboard stats.

This copy lives in `job-tracker-next/`. Its `server/src` and `client/src` match the tracker at the
repository root file for file (the root `client/` additionally carries unused Vite template files),
so findings here apply to both copies. Run the commands below from inside `job-tracker-next/`.

## Stack
- Frontend: React 18 + Vite 6 + React Router 6 + Zustand 5 + React Hook Form + Zod + Axios (`client/package.json`)
- Backend: Node.js + Express 4 + SQLite (better-sqlite3) + JWT auth + Zod (`server/package.json`, CommonJS)

There are no automated tests and no lint configuration. Everything below was read from the
source; nothing was produced by running the app.

## Run
```bash
npm install
npm run install:all
npm run dev
```

`install:all` installs `server/` and `client/` separately; `dev` runs both with `concurrently`
(`package.json`). Before the first run, copy `server/.env.example` to `server/.env` — the server
refuses to start without `JWT_SECRET` (`server/src/server.js:8-10`). The client reads
`VITE_API_URL` (default `http://localhost:4000/api`, `client/src/lib/api.js:4`).

- Frontend: http://localhost:5173
- Backend: http://localhost:4000 (health check: `GET /api/health`)

The SQLite file is created at `server/data/job-tracker.db` on first start, with WAL mode on
(`server/src/db.js:5-14`). Tables and indexes are created with `CREATE ... IF NOT EXISTS`
(`db.js:16-46`); there are no migrations, so changing a column means deleting the file.

## Demo flow
1. Register a new user (name 2-100 chars, password 8-100 chars, `server/src/validation.js:7-11`).
2. Create applications. The form defaults the status to `applied`
   (`client/src/components/ApplicationFormModal.jsx:51`), but the API accepts **any** status on
   create (`validation.js:44`).
3. Move statuses with workflow buttons:
   - applied -> interview -> offer/rejected
   - applied -> rejected
   The rules live in `server/src/constants.js:10-15` and are mirrored for button rendering in
   `client/src/utils/status.js:13-18`.
4. Filter/search/sort in Applications. Search is debounced 300 ms
   (`client/src/pages/ApplicationsPage.jsx:34-45`) and matches company, role or location.
5. View stats and recent updates in Dashboard.

## API endpoints

All `/api/applications` and `/api/dashboard` routes require `Authorization: Bearer <jwt>`
(`server/src/routes/applications.js:10`, `server/src/routes/dashboard.js:8`).

| Endpoint | Behaviour |
| --- | --- |
| `POST /api/auth/register` | 201 `{ user, token }`; 409 if the email exists (`routes/auth.js:11-42`) |
| `POST /api/auth/login` | 200 `{ user, token }`; same 401 message for unknown email and wrong password (`auth.js:44-76`) |
| `GET /api/auth/me` | reloads the user by the id inside the token (`auth.js:78-89`) |
| `GET /api/dashboard/stats` | `{ total, byStatus, active, conversionRate }` (`dashboard.js:10-41`) |
| `GET /api/applications` | `search`, `status`, `sort_by`, `sort_order`, `page`, `page_size` ≤ 100; default sort `updated_at desc`, page size 10 (`applications.js:12-65`) |
| `GET /api/applications/:id` | 404 unless the row belongs to the caller (`applications.js:67-80`) |
| `POST /api/applications` | full create (`applications.js:82-114`) |
| `PUT /api/applications/:id` | partial update; a changed `status` must be an allowed transition (`applications.js:116-189`) |
| `PATCH /api/applications/:id/transition` | `{ status }` only (`applications.js:191-229`) |
| `DELETE /api/applications/:id` | 204, or 404 if nothing was deleted (`applications.js:231-244`) |

Validation failures return `400 { message: 'Validation failed', errors: [{ path, message }] }`
(`server/src/utils.js:1-19`). JWTs are signed with the user's id, name and email and expire after
7 days (`auth.js:36-38,71-73`); the client keeps the token in `localStorage` and re-checks it with
`/auth/me` on every page load (`client/src/store/authStore.js:11-31`).

See [ARCHITECTURE_DEEP_DIVE.md](ARCHITECTURE_DEEP_DIVE.md) for the full walkthrough.

## Exercises

1. **Goal:** prove ownership scoping.
   **Check:** register two users, create an application as user A, then `GET /api/applications/<id>`
   with user B's token returns 404 `Application not found`.
2. **Goal:** see the workflow enforced server-side.
   **Check:** `PATCH /api/applications/<id>/transition` with `{"status":"offer"}` on an `applied`
   row returns 400 `Invalid transition from applied to offer`.
3. **Goal:** find the create-time bypass.
   **Check:** `POST /api/applications` with `"status":"offer"` returns 201, and the dashboard's
   `byStatus.offer` goes up without the row ever passing through `interview`.
4. **Goal:** make the sort whitelist visible.
   **Check:** `GET /api/applications?sort_by=password_hash` returns 400 `Validation failed`, because
   `sort_by` is an enum (`validation.js:68`) before it is interpolated into `ORDER BY`
   (`applications.js:47-51`).

## Senior review (from reading the code)

1. **Create skips the workflow.** `createApplicationSchema` accepts any status
   (`validation.js:44,48-54`), so the transition rules only guard updates. Force `applied` on create
   or validate the initial state.
2. **Async errors escape Express.** `register` and `login` are `async` handlers
   (`routes/auth.js:11,44`). Express 4 does not catch a rejected promise, so a database error after
   `await bcrypt.hash` — for example two registrations with the same email racing past the existence
   check at line 18 into the `UNIQUE` constraint — never reaches the error middleware in
   `server.js:39-42`; the request hangs and Node reports an unhandled rejection.
3. **Zustand 5 object selectors.** `ProtectedRoute`, `LoginPage` and `RegisterPage` select
   `{ token, isReady }` as a fresh object each render (`client/src/components/ProtectedRoute.jsx:5-8`,
   `client/src/pages/LoginPage.jsx:17`, `client/src/pages/RegisterPage.jsx:23`). Zustand 5 compares
   selector results by reference, so this pattern needs `useShallow` or two separate selectors to
   avoid render loops; check the browser console on first load.
4. **Stale token claims.** The JWT carries `name` and `email` (`auth.js:30-38,65-73`) and is valid
   for 7 days with no revocation; `requireAuth` trusts it without a database lookup
   (`server/src/middleware/auth.js:14-15`).
5. **"Conversion rate" counts interviews.** It is `(offer + interview) / total`
   (`dashboard.js:33`), which is a progression rate, not an offer rate.
6. **Unescaped LIKE wildcards** in search (`applications.js:33-37`): `%` and `_` in the search box
   act as wildcards.
7. **No rate limiting** on login and register, and no tests at all.
