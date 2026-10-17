/**
 * Test helpers: an app over in-memory PGlite (migrated), direct session minting (real token hashing,
 * no OIDC round trip) and a request helper that adds the CSRF header and cookies.
 */
import { createApp } from '../src/app';
import { loadConfig, type ServerConfig } from '../src/config';
import { openPglite, type Db } from '../src/db';
import { migrate } from '../src/migrate';
import { createSession, upsertUser } from '../src/auth/session';
import type { OidcClient } from '../src/auth/oidc';

export interface TestContext {
  app: ReturnType<typeof createApp>;
  db: Db;
  config: ServerConfig;
  close(): Promise<void>;
}

export interface TestContextOptions {
  env?: Record<string, string | undefined>;
  db?: Db;
  oidc?: OidcClient | null;
  now?: () => Date;
}

export const TEST_ISSUER = 'https://issuer.test';

export async function createTestContext(options: TestContextOptions = {}): Promise<TestContext> {
  const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5173', PGLITE_MEMORY: '1', RATE_LIMIT_PER_MINUTE: '100000', ...options.env });
  const db = options.db ?? await openPglite(null);
  await migrate(db);
  const app = createApp({ db, config, oidc: options.oidc === undefined ? null : options.oidc, now: options.now });
  return { app, db, config, close: () => (options.db ? Promise.resolve() : db.close()) };
}

/** Create (or reuse) the user for `subject` and a session; returns the Cookie header value. */
export async function signInAs(ctx: TestContext, subject: string, email: string | null = `${subject.replace(/\W/g, '')}@example.test`): Promise<{ cookie: string; userId: string; token: string }> {
  const user = await upsertUser(ctx.db, { issuer: TEST_ISSUER, subject, email });
  const session = await createSession(ctx.db, user.id, ctx.config.session.ttlDays);
  return { cookie: `${ctx.config.session.cookieName}=${session.token}`, userId: user.id, token: session.token };
}

export interface ApiOptions { cookie?: string; body?: unknown; headers?: Record<string, string>; csrf?: boolean }

export function api(ctx: TestContext, method: string, path: string, options: ApiOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.csrf !== false) headers['X-Requested-With'] = 'debtnav';
  if (options.cookie) headers.Cookie = options.cookie;
  let body: BodyInit | undefined;
  if (options.body instanceof FormData || typeof options.body === 'string' || options.body instanceof Uint8Array) {
    body = options.body as BodyInit;
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }
  return Promise.resolve(ctx.app.request(path, { method, headers, body }));
}

/** Upload helper for workbook preview. */
export function uploadForm(bytes: Uint8Array, filename = 'plan.xlsx'): FormData {
  const form = new FormData();
  form.append('file', new File([bytes as BlobPart], filename, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  return form;
}
