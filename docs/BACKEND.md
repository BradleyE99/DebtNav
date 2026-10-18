# DebtNav backend: setup, deployment and operations

This covers US-1201 (Google sign-in) and US-1202 (hosted backend and durable database). The API lives in `server/`. It is a Hono app on Node, and it shares validation and contracts with the browser via `src/data` and `src/engine`. Configuration comes from environment variables only (see [`.env.example`](../.env.example) and `server/src/config.ts`).

## Local setup

**Quickest (no Google credentials):** run `npm ci`, then `npm run dev:local`, and open http://localhost:5173. This one command starts the mock sign-in page (port 8090, from `e2e/support/mock-oidc.mjs`), the API (8787) and Vite (5173), and Ctrl+C stops them all. Sign in with any test user name; each name is a separate account (`<name>@example.test`). Change ports with `LOCAL_APP_PORT`, `LOCAL_API_PORT` and `LOCAL_AUTH_PORT`.

**With real Google sign-in:**

1. Run `npm ci` (Node.js 22.12+).
2. Run `cp .env.example .env`. Leave `DATABASE_URL` unset to use embedded PGlite in `.data/pglite` (git-ignored).
3. Google credentials (optional for local work). In Google Cloud Console → APIs & Services → Credentials, create an **OAuth client ID** of type **Web application**:
   - Authorized JavaScript origin: `http://localhost:5173`
   - Authorized redirect URI: `http://localhost:5173/api/auth/callback`
   - Put the client ID and secret in `.env` as `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`.

   Without them the API still runs. The app shows a "sign-in is not set up" screen and never fakes authentication.
4. Start the API with `npm run dev:api` (it loads `.env` when present). Migrations apply at startup.
5. Start the app with `npm run dev`. Vite proxies `/api` to `API_PORT`, so the app and the cookie share one origin.

`npm run db:migrate` applies migrations without starting the server, using the same `DATABASE_URL` / `PGLITE_DIR`.

## Security model

- **Sign-in:** OpenID Connect authorization-code flow with PKCE, `state` and `nonce` via `openid-client` (no custom OAuth cryptography). Login state is stored server-side in `oidc_flows`, is single-use, and expires after 10 minutes. The ID token is validated by the library; users are keyed by `(issuer, subject)`.
- **Sessions:** a random token in an `httpOnly`, `SameSite=Lax` cookie. Only its SHA-256 hash is stored (`sessions`). Over HTTPS the cookie is `Secure` and uses the `__Host-` prefix. Expired sessions are purged hourly.
- **Ownership:** every `/api` route except `health` and `auth/config|login|callback` requires a session. The owner is always the session user and never a request parameter, so a user can reach only their own plan, imports and exports. `server/test/authz.test.ts` covers cross-user access.
- **Writes:** `PUT /api/plan` carries `baseRevision`. A stale revision gets `409` and the client asks the user which version to keep; nothing is silently overwritten. Every state-changing request must send `X-Requested-With: debtnav` (CSRF guard). Bodies are capped at 5 MB, and requests are rate limited per client IP (first `X-Forwarded-For` hop), so deploy behind a proxy that sets that header.
- **Logging:** request logs never include plan contents, financial inputs, tokens or secrets.
- **Portable files:** JSON and Excel exports never contain account IDs, emails, tokens or secrets. Excel imports are parsed and validated server-side, and commit atomically only after explicit confirmation.

## API

| Route | Purpose |
|---|---|
| `GET /api/health` | Liveness plus a database round-trip. Use it for load-balancer health checks. |
| `GET /api/auth/config` | `{ configured }`: whether Google credentials are set |
| `GET /api/auth/login`, `GET /api/auth/callback`, `POST /api/auth/logout` | OIDC redirect flow and sign-out (sign-out does not delete data) |
| `GET /api/me` | Current user |
| `GET /api/plan`, `PUT /api/plan` | Load or save the user's plan (versioned envelope + revision) |
| `DELETE /api/account/data` | Delete the user's plan, sessions and account row |
| `GET /api/workbook/template`, `GET /api/workbook/export` | Blank Excel template and Excel export |
| `POST /api/workbook/import/preview`, `POST /api/workbook/import/commit` | Validate and preview, then replace the plan atomically |

## Data model

The tables are in `server/migrations/001_init.sql`: `users`, `sessions`, `plans` (one per user: `schema_version`, `document` jsonb, `revision`, timestamps) and `oidc_flows`. Plans store inputs only; projections are always recomputed. Money stays as exact decimal strings inside the document, and dates are ISO calendar strings. New migrations go in `server/migrations/NNN_name.sql`. Each runs once in its own transaction and is recorded in `schema_migrations`.

## Deployment

**Render:** follow [DEPLOY-RENDER.md](DEPLOY-RENDER.md). The repo's `render.yaml` Blueprint creates the web service and a private Postgres database, and the server reads Render's `RENDER_EXTERNAL_URL`, so `APP_ORIGIN` is only needed for a custom domain.

The repository includes deployment artifacts but nothing has been deployed: no infrastructure has been provisioned, purchased or published. To deploy you need:

1. **A managed PostgreSQL 15+** database (for example Neon, Supabase, Render, RDS or Cloud SQL) with TLS, and `DATABASE_URL` set with `sslmode=require`. The role needs DDL rights for migrations and must have `gen_random_uuid()` available (built into PostgreSQL 13+). Database credentials live only on the server.
2. **A Node host or container platform** (for example Render, Fly.io, Railway or Cloud Run). The `Dockerfile` builds the SPA and runs the API, which serves `dist/` in production. One origin serves both the app and `/api`, so no CORS configuration is needed.
3. **HTTPS** terminated by the platform, with `APP_ORIGIN=https://your-domain` and `NODE_ENV=production`.
4. **A Google OAuth client** for the production origin, with redirect URI `https://your-domain/api/auth/callback`. Before external users can sign in, publish the OAuth consent screen (app name, support email, privacy policy URL).
5. **Secrets** set in the platform's secret store: `DATABASE_URL`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`. Never put them in the image or the repo.
6. **A health check** on `GET /api/health`.

```bash
docker build -t debtnav .
docker run -p 8787:8787 --env-file .env.production debtnav
```

## Backups, restore and retention

- **Backups:** use the provider's automated backups or point-in-time recovery, with retention set to **7 days**. The app's Delete-my-data screen tells users that deleted data may remain in encrypted backups for up to 7 days, so retention must not be longer.
- **Restore:** restore into a new database instance from the provider console (or `pg_restore` from a `pg_dump -Fc` file), point `DATABASE_URL` at it and restart. Migrations are idempotent. Before switching traffic, verify with `GET /api/health` and a test sign-in. After restoring, re-run deletions requested since the backup was taken: any account that deleted its data in that window must be deleted again.
- **Manual export:** run `pg_dump -Fc "$DATABASE_URL" > debtnav-$(date +%F).dump`. Dumps contain personal financial data: store them encrypted and delete them within the same 7 days.
- **Deletion:** `DELETE /api/account/data` removes the user's plan, sessions and account row from the live database immediately, and the client clears its local cache. Signing out alone deletes nothing.
- **Retention:** plans are kept until the user deletes them. Sessions expire after `SESSION_TTL_DAYS`. Login state expires after 10 minutes.
- **PGlite** (the default without `DATABASE_URL`) is for local development and tests. To back it up, stop the server and copy the `PGLITE_DIR` directory.

## Tests

- `npm test` includes the server tests (`server/test`): authorization, migrations and workbook round-trips.
- `npm run test:e2e` starts a mock OIDC issuer, the real API on a temporary PGlite database (restartable by tests) and the production build. The tests then sign in through the real redirect flow; see the comment block in `playwright.config.ts`.
