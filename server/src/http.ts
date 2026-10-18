/** Shared Hono types, middleware and helpers. */
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { ServerConfig } from './config';
import type { Db } from './db';
import type { OidcClient } from './auth/oidc';
import { resolveSession, type SessionUser } from './auth/session';
import type { PreviewStore } from './workbook/previews';

export interface AppDeps {
  db: Db;
  config: ServerConfig;
  /** Injected in tests; built from config otherwise (null when OIDC is not configured). */
  oidc?: OidcClient | null;
  now?: () => Date;
}
export interface AppContext { deps: Required<Pick<AppDeps, 'db' | 'config'>> & { oidc: OidcClient | null; now: () => Date; previews: PreviewStore } }
export type Env = { Variables: { user: SessionUser; ctx: AppContext } };

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'debtnav';

export const json = (c: Context, status: number, body: unknown) =>
  c.json(body as object, status as 200);

export function sessionCookie(c: Context<Env>): string | undefined {
  return getCookie(c, c.var.ctx.deps.config.session.cookieName);
}

export function setSessionCookie(c: Context<Env>, token: string, expiresAt: Date): void {
  const { session } = c.var.ctx.deps.config;
  setCookie(c, session.cookieName, token, {
    httpOnly: true, sameSite: 'Lax', secure: session.secure, path: '/', expires: expiresAt,
  });
}

export function clearSessionCookie(c: Context<Env>): void {
  const { session } = c.var.ctx.deps.config;
  deleteCookie(c, session.cookieName, { path: '/', secure: session.secure, httpOnly: true, sameSite: 'Lax' });
}

/** Non-GET API requests must carry `X-Requested-With: debtnav` (cross-site forms cannot set it). */
export const csrfGuard: MiddlewareHandler<Env> = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header(CSRF_HEADER) !== CSRF_VALUE) {
    return json(c, 403, { error: 'csrf', message: 'Missing request header X-Requested-With: debtnav.' });
  }
  await next();
};

/** Resolves the session cookie; 401 when absent/expired. The owner of every query comes from here. */
export const requireUser: MiddlewareHandler<Env> = async (c, next) => {
  const { deps } = c.var.ctx;
  const user = await resolveSession(deps.db, sessionCookie(c), deps.config.session.ttlDays, deps.now());
  if (!user) {
    if (sessionCookie(c)) clearSessionCookie(c);
    return json(c, 401, { error: 'unauthenticated', message: 'Sign in to continue.' });
  }
  c.set('user', user);
  await next();
};

/** Simple fixed-window limiter per key (user id, else client address). In-memory: per process. */
export function rateLimit(perMinute: number, keyOf: (c: Context<Env>) => string): MiddlewareHandler<Env> {
  const windows = new Map<string, { start: number; count: number }>();
  return async (c, next) => {
    const now = c.var.ctx.deps.now().getTime();
    const key = keyOf(c);
    let entry = windows.get(key);
    if (!entry || now - entry.start >= 60_000) {
      entry = { start: now, count: 0 };
      windows.set(key, entry);
      if (windows.size > 10_000) for (const [k, v] of windows) if (now - v.start >= 60_000) windows.delete(k);
    }
    if (++entry.count > perMinute) {
      c.header('Retry-After', String(Math.ceil((entry.start + 60_000 - now) / 1000)));
      return json(c, 429, { error: 'rateLimited', message: 'Too many requests. Wait a minute and try again.' });
    }
    await next();
  };
}

export function clientKey(c: Context<Env>): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || c.req.header('x-real-ip') || 'local';
}
