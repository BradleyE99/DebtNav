/** Server entry point: `npm run dev:api` (watch) or `npm start`. Applies migrations at startup. */
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig, oidcConfigured, startupProblem } from './config';
import { openDb } from './db';
import { migrate } from './migrate';
import { purgeExpired } from './auth/session';

const config = loadConfig();
const problem = startupProblem(config);
if (problem) {
  console.error(`[config] ${problem}`);
  process.exit(1);
}
const db = await openDb(config);
const applied = await migrate(db);
if (applied.length) console.log(`[db] applied migrations: ${applied.join(', ')}`);
console.log(`[db] ${config.database.kind === 'postgres' ? 'PostgreSQL (DATABASE_URL)' : config.database.dir ? `PGlite at ${config.database.dir}` : 'PGlite in memory'}`);
if (!oidcConfigured(config)) console.warn('[auth] OIDC_CLIENT_ID / OIDC_CLIENT_SECRET are not set: sign-in is disabled and the app shows a setup screen.');

const app = createApp({ db, config });
const server = serve({ fetch: app.fetch, port: config.port }, info => {
  console.log(`[api] listening on http://localhost:${info.port}${config.staticDir ? ` (serving ${config.staticDir})` : ''}`);
});
const housekeeping = setInterval(() => { purgeExpired(db).catch(() => undefined); }, 60 * 60_000);
housekeeping.unref();

// Graceful shutdown closes the database cleanly (PGlite must be closed to reopen its directory).
let stopping = false;
const shutdown = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(0), 8000).unref();
  await new Promise<void>(resolve => {
    server.close(() => resolve());
    (server as { closeAllConnections?: () => void }).closeAllConnections?.();
  });
  await db.close().catch(() => undefined);
  process.exit(0);
};
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
// Test supervisors (Windows has no SIGTERM for child processes) send 'shutdown' over IPC.
process.on('message', message => { if (message === 'shutdown') void shutdown(); });
