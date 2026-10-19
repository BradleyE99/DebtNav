/** Production configuration as Render runs it (docs/DEPLOY-RENDER.md). */
import { describe, expect, it } from 'vitest';
import { credential, loadConfig, oidcConfigured, startupProblem } from '../src/config';
import { describeAuthFailure } from '../src/routes/auth';
import { redirectUri } from '../src/auth/oidc';

const render = {
  NODE_ENV: 'production',
  PORT: '10000',
  RENDER_EXTERNAL_URL: 'https://debtnav.onrender.com',
  DATABASE_URL: 'postgres://user:pass@dpg-internal/debtnav',
  OIDC_CLIENT_ID: 'id.apps.googleusercontent.com',
  OIDC_CLIENT_SECRET: 'secret',
};

describe('production config on Render', () => {
  it('uses Render\'s URL, port and database, with secure cookies and the built SPA', () => {
    const config = loadConfig(render);
    expect(config.appOrigin).toBe('https://debtnav.onrender.com');
    expect(redirectUri(config)).toBe('https://debtnav.onrender.com/api/auth/callback');
    expect(config.port).toBe(10000);
    expect(config.database).toEqual({ kind: 'postgres', url: render.DATABASE_URL });
    expect(config.session).toMatchObject({ secure: true, cookieName: '__Host-debtnav_session' });
    expect(config.staticDir).toBe('dist');
    expect(config.oidc.issuer).toBe('https://accounts.google.com');
    expect(oidcConfigured(config)).toBe(true);
  });

  it('an explicit APP_ORIGIN (custom domain) wins, and a trailing slash is removed', () => {
    expect(loadConfig({ ...render, APP_ORIGIN: 'https://debtnav.example.com/' }).appOrigin).toBe('https://debtnav.example.com');
  });

  it('never honours the local test-login switches in production', () => {
    const config = loadConfig({ ...render, OIDC_ALLOW_INSECURE: '1', OIDC_ALLOW_LOGIN_HINT: '1' });
    expect(config.oidc.allowInsecure).toBe(false);
    expect(config.oidc.allowLoginHint).toBe(false);
  });

  it('refuses to start in production without DATABASE_URL (the embedded DB needs ~700 MB and loses data on restart)', () => {
    const { DATABASE_URL: _omit, ...withoutDb } = render;
    expect(startupProblem(loadConfig(render))).toBeNull();
    expect(startupProblem(loadConfig(withoutDb))).toMatch(/DATABASE_URL is not set/);
    expect(startupProblem(loadConfig({ ...withoutDb, ALLOW_EMBEDDED_DB: '1' }))).toBeNull();
    // Development and tests keep the embedded database by default.
    expect(startupProblem(loadConfig({ NODE_ENV: 'development' }))).toBeNull();
    expect(startupProblem(loadConfig({ NODE_ENV: 'test', PGLITE_MEMORY: '1' }))).toBeNull();
  });

  it('without Google credentials sign-in reports "not configured" instead of faking it', () => {
    expect(oidcConfigured(loadConfig({ ...render, OIDC_CLIENT_ID: '', OIDC_CLIENT_SECRET: '' }))).toBe(false);
  });
});

describe('pasted Google credentials', () => {
  it('ignores surrounding whitespace, line breaks and quote marks', () => {
    expect(credential('  abc.apps.googleusercontent.com\n')).toBe('abc.apps.googleusercontent.com');
    expect(credential('"GOCSPX-secret"')).toBe('GOCSPX-secret');
    expect(credential("'GOCSPX-secret' ")).toBe('GOCSPX-secret');
    expect(credential('   ')).toBeNull();
    expect(credential(undefined)).toBeNull();
    const config = loadConfig({ ...render, OIDC_CLIENT_ID: ' id.apps.googleusercontent.com ', OIDC_CLIENT_SECRET: '"secret"\n' });
    expect(config.oidc).toMatchObject({ clientId: 'id.apps.googleusercontent.com', clientSecret: 'secret' });
  });
});

describe('sign-in failure log line', () => {
  it('names Google\'s reason and the fix, without secrets', () => {
    const failure = Object.assign(new Error('server responded with an error in the response body'), {
      name: 'ResponseBodyError', code: 'OAUTH_RESPONSE_BODY_ERROR', error: 'invalid_client', error_description: 'Unauthorized',
    });
    const line = describeAuthFailure(failure);
    expect(line).toMatch(/^ResponseBodyError OAUTH_RESPONSE_BODY_ERROR invalid_client \(Unauthorized\): Google rejected the client ID\/secret/);
    expect(describeAuthFailure(new TypeError('fetch failed'))).toBe('TypeError');
    expect(describeAuthFailure(null)).toBe('Error');
  });
});
