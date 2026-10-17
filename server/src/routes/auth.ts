/**
 * Sign-in routes. /login stores state, nonce and PKCE verifier server-side (single use, 10 minutes)
 * and redirects to the issuer; /callback lets openid-client validate everything, then creates a
 * session. Cancellation and failures redirect back to the app with ?authError=cancelled|failed.
 */
import { Hono } from 'hono';
import { oidcConfigured } from '../config';
import { createSession, deleteSession, purgeExpired, upsertUser } from '../auth/session';
import { redirectUri } from '../auth/oidc';
import { type Env, clearSessionCookie, json, requireUser, sessionCookie, setSessionCookie } from '../http';

const FLOW_TTL_MS = 10 * 60_000;

/** Only same-site relative paths ("/x", not "//host" or "/\host") can be return targets. */
export function safeReturnTo(value: string | undefined): string {
  if (!value || value.length > 500 || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || /[\r\n]/.test(value)) return '/';
  return value;
}

const appUrl = (origin: string, path: string) => `${origin}${path}`;

export function authRoutes() {
  const routes = new Hono<Env>();

  routes.get('/config', c => json(c, 200, { configured: oidcConfigured(c.var.ctx.deps.config) }));

  routes.get('/login', async c => {
    const { deps } = c.var.ctx;
    if (!deps.oidc) return json(c, 503, { error: 'notConfigured', message: 'Google sign-in is not configured on this server.' });
    const returnTo = safeReturnTo(c.req.query('returnTo'));
    try {
      const start = await deps.oidc.start({ loginHint: c.req.query('login_hint') });
      await purgeExpired(deps.db, deps.now());
      await deps.db.query('INSERT INTO oidc_flows (state, code_verifier, nonce, return_to, created_at) VALUES ($1, $2, $3, $4, $5)',
        [start.state, start.codeVerifier, start.nonce, returnTo, deps.now()]);
      return c.redirect(start.url.href, 302);
    } catch (error) {
      console.error('[auth] login start failed', (error as Error)?.name ?? 'Error');
      return c.redirect(appUrl(deps.config.appOrigin, '/?authError=failed'), 302);
    }
  });

  routes.get('/callback', async c => {
    const { deps } = c.var.ctx;
    const origin = deps.config.appOrigin;
    const state = c.req.query('state');
    // Consume the flow first so a state value can never be replayed, whatever happens next.
    const flow = state
      ? (await deps.db.query<{ code_verifier: string; nonce: string; return_to: string; created_at: Date }>(
        'DELETE FROM oidc_flows WHERE state = $1 RETURNING code_verifier, nonce, return_to, created_at', [state])).rows[0]
      : undefined;
    const error = c.req.query('error');
    if (error) return c.redirect(appUrl(origin, error === 'access_denied' ? '/?authError=cancelled' : '/?authError=failed'), 302);
    if (!deps.oidc || !flow || !state || deps.now().getTime() - new Date(flow.created_at).getTime() > FLOW_TTL_MS) {
      return c.redirect(appUrl(origin, '/?authError=failed'), 302);
    }
    try {
      // The callback URL as the issuer redirected to it (requests may arrive through a proxy).
      const callbackUrl = new URL(redirectUri(deps.config));
      callbackUrl.search = new URL(c.req.url).search;
      const identity = await deps.oidc.finish(callbackUrl, { state, codeVerifier: flow.code_verifier, nonce: flow.nonce });
      const user = await upsertUser(deps.db, identity);
      const session = await createSession(deps.db, user.id, deps.config.session.ttlDays, deps.now());
      setSessionCookie(c, session.token, session.expiresAt);
      return c.redirect(appUrl(origin, safeReturnTo(flow.return_to)), 302);
    } catch (failure) {
      console.error('[auth] callback failed', (failure as Error)?.name ?? 'Error', (failure as { code?: string })?.code ?? '');
      return c.redirect(appUrl(origin, '/?authError=failed'), 302);
    }
  });

  routes.post('/logout', async c => {
    await deleteSession(c.var.ctx.deps.db, sessionCookie(c));
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  return routes;
}

export function meRoute() {
  const routes = new Hono<Env>();
  routes.get('/', requireUser, c => json(c, 200, { user: c.var.user }));
  return routes;
}
