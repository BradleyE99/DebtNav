// Mock OpenID Connect issuer for automated tests only (oauth2-mock-server). Never used in production.
//
// Usage: MOCK_OIDC_PORT=5504 node e2e/support/mock-oidc.mjs
//
// Behaviour
// - Issuer URL http://localhost:<port>; RS256 signing key; PKCE (S256) and nonce are enforced by oauth2-mock-server.
// - GET /authorize?...&login_hint=<user>: signs in as <user> without a page (loginAs helper).
//     id_token claims: sub = "e2e|<user>", email = "<user>@example.test", email_verified = true.
// - GET /authorize without login_hint: a minimal account-chooser page (like Google's) with a user-name field,
//   "Continue" and "Cancel" buttons, so UI tests can click through the real redirect flow.
// - login_hint "__cancel__" (or the Cancel button): redirects back with error=access_denied (user cancelled).
// - login_hint "__fail__": the token endpoint answers 400 invalid_grant (authentication failure).
import http from 'node:http';
import { OAuth2Issuer, OAuth2Service, Events } from 'oauth2-mock-server';

const port = Number(process.env.MOCK_OIDC_PORT ?? 8090);
const issuer = new OAuth2Issuer();
issuer.url = `http://localhost:${port}`;
await issuer.keys.generate('RS256');
const service = new OAuth2Service(issuer);

/** authorization code → login hint (user name). */
const users = new Map();

service.on(Events.BeforeAuthorizeRedirect, (redirect, req) => {
  const hint = new URL(req.url ?? '/', issuer.url).searchParams.get('login_hint') ?? '';
  const code = redirect.url.searchParams.get('code');
  if (hint === '__cancel__') {
    redirect.url.searchParams.delete('code');
    redirect.url.searchParams.set('error', 'access_denied');
    redirect.url.searchParams.set('error_description', 'The user cancelled sign-in.');
    return;
  }
  if (code) users.set(code, hint);
});

service.on(Events.BeforeTokenSigning, (token, req) => {
  // RFC 6749 §2.3.1: client_secret_basic credentials are form-urlencoded (openid-client encodes '-' as %2D);
  // oauth2-mock-server copies the raw id into `aud`, so decode it as a real provider would.
  if (typeof token.payload.aud === 'string') token.payload.aud = decodeURIComponent(token.payload.aud.replace(/\+/g, ' '));
  const code = req.body?.code;
  const user = typeof code === 'string' ? users.get(code) : undefined;
  if (!user) return;
  token.payload.sub = `e2e|${user}`;
  token.payload.email = `${user}@example.test`;
  token.payload.email_verified = true;
});

service.on(Events.BeforeResponse, (response, req) => {
  const code = req.body?.code;
  const user = typeof code === 'string' ? users.get(code) : undefined;
  if (typeof code === 'string') users.delete(code);
  if (user === '__fail__') {
    response.statusCode = 400;
    response.body = { error: 'invalid_grant', error_description: 'Simulated authentication failure.' };
  }
});

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function chooserPage(url) {
  const hidden = [...url.searchParams].map(([k, v]) => `<input type="hidden" name="${escape(k)}" value="${escape(v)}">`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Mock Google sign-in</title></head><body>
<main><h1>Mock Google sign-in (test only)</h1>
<form method="get" action="/authorize">${hidden}
<label for="login_hint">Test user name</label> <input id="login_hint" name="login_hint" value="e2e-user" required>
<button type="submit">Continue</button></form>
<form method="get" action="/authorize">${hidden}<input type="hidden" name="login_hint" value="__cancel__">
<button type="submit">Cancel</button></form></main></body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', issuer.url);
  if (req.method === 'GET' && url.pathname === '/authorize' && !url.searchParams.get('login_hint')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(chooserPage(url));
    return;
  }
  if (url.pathname === '/health') { res.writeHead(200); res.end('ok'); return; }
  service.requestHandler(req, res);
});
server.listen(port, () => console.log(`mock OIDC issuer listening on ${issuer.url}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
