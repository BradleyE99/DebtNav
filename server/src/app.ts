/**
 * createApp(deps) builds the whole HTTP app (used by index.ts and by tests with in-memory PGlite).
 *
 * Security model: every /api route except health, auth config/login/callback requires a session;
 * the plan owner is always the session user; non-GET requests need the CSRF header; bodies are
 * limited to 5 MB; requests are rate limited; logs carry method, path, status and timing only.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from '@hono/node-server/serve-static';
import { oidcConfigured } from './config';
import { createOidcClient } from './auth/oidc';
import { type AppDeps, type Env, clientKey, csrfGuard, json, rateLimit } from './http';
import { createPreviewStore } from './workbook/previews';
import { accountRoutes, planRoutes } from './routes/plan';
import { authRoutes, meRoute } from './routes/auth';
import { workbookRoutes } from './routes/workbook';

export type { AppDeps } from './http';

export function createApp(deps: AppDeps): Hono<Env> {
  const ctx = {
    deps: {
      db: deps.db,
      config: deps.config,
      oidc: deps.oidc !== undefined ? deps.oidc : oidcConfigured(deps.config) ? createOidcClient(deps.config) : null,
      now: deps.now ?? (() => new Date()),
      previews: createPreviewStore(),
    },
  };
  const app = new Hono<Env>();
  const quiet = process.env.NODE_ENV === 'test' || process.env.VITEST !== undefined;

  app.use('*', async (c, next) => {
    c.set('ctx', ctx);
    const started = Date.now();
    await next();
    // Never log query strings or bodies: they may carry plan values or login hints.
    if (!quiet && c.req.path.startsWith('/api/')) console.log(`[api] ${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - started}ms`);
  });
  app.use('*', secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"], workerSrc: ["'self'", 'blob:'], frameAncestors: ["'none'"], formAction: ["'self'"], baseUri: ["'self'"],
    },
    strictTransportSecurity: deps.config.session.secure ? 'max-age=31536000; includeSubDomains' : false,
  }));
  app.onError((error, c) => {
    console.error('[api] unhandled error', c.req.method, c.req.path, error.name);
    return json(c, 500, { error: 'server', message: 'Something went wrong on the server. Try again.' });
  });

  const api = new Hono<Env>();
  api.use('*', bodyLimit({ maxSize: deps.config.bodyLimitBytes, onError: c => json(c, 413, { error: 'tooLarge', message: 'The request is larger than the 5 MB limit.' }) }));
  api.use('*', csrfGuard);
  api.use('*', rateLimit(deps.config.rateLimitPerMinute, c => clientKey(c)));

  api.get('/health', async c => {
    try {
      await deps.db.query('SELECT 1');
      return json(c, 200, { ok: true, db: 'ok' });
    } catch {
      return json(c, 503, { ok: false, db: 'unavailable' });
    }
  });
  api.route('/auth', authRoutes());
  api.route('/me', meRoute());
  api.route('/plan', planRoutes());
  api.route('/account', accountRoutes());
  api.route('/workbook', workbookRoutes());
  api.all('*', c => json(c, 404, { error: 'notFound' }));
  app.route('/api', api);

  const staticDir = deps.config.staticDir ? resolve(deps.config.staticDir) : null;
  if (staticDir && existsSync(join(staticDir, 'index.html'))) {
    const indexHtml = readFileSync(join(staticDir, 'index.html'), 'utf8');
    app.use('/*', serveStatic({ root: staticDir }));
    // SPA fallback: unknown non-API paths render the app shell.
    app.get('*', c => c.html(indexHtml));
  }
  return app;
}
