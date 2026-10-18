/**
 * Server configuration from environment variables (see .env.example and docs/BACKEND.md).
 * Secrets are read here only and never logged.
 */
export interface ServerConfig {
  production: boolean;
  port: number;
  /** Public origin of the app (scheme://host[:port]); the OIDC redirect URI is `${appOrigin}/api/auth/callback`. */
  appOrigin: string;
  database: { kind: 'postgres'; url: string } | { kind: 'pglite'; dir: string | null };
  oidc: {
    issuer: string;
    clientId: string | null;
    clientSecret: string | null;
    /** Plain-HTTP issuer for local mock servers. Never honoured in production. */
    allowInsecure: boolean;
    /** Pass `login_hint` through to the issuer (local test issuers only). Never honoured in production. */
    allowLoginHint: boolean;
  };
  session: { ttlDays: number; cookieName: string; secure: boolean };
  /** Requests per minute per user/IP. */
  rateLimitPerMinute: number;
  /** Directory with a built SPA to serve (production). null = API only. */
  staticDir: string | null;
  /** Max request body (bytes). */
  bodyLimitBytes: number;
}

export const BODY_LIMIT_BYTES = 5 * 1024 * 1024;

const flag = (value: string | undefined): boolean => value === '1' || value === 'true';
const int = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const parsed = value === undefined || value === '' ? NaN : Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const production = env.NODE_ENV === 'production';
  // Render sets RENDER_EXTERNAL_URL (https://<service>.onrender.com); an explicit APP_ORIGIN (e.g. a custom domain) wins.
  const appOrigin = (env.APP_ORIGIN || env.RENDER_EXTERNAL_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const secure = production || appOrigin.startsWith('https://');
  const memory = flag(env.PGLITE_MEMORY) || env.PGLITE_DIR === 'memory://';
  const warnings: string[] = [];
  if (production && flag(env.OIDC_ALLOW_INSECURE)) warnings.push('OIDC_ALLOW_INSECURE is ignored in production.');
  if (production && flag(env.OIDC_ALLOW_LOGIN_HINT)) warnings.push('OIDC_ALLOW_LOGIN_HINT is ignored in production.');
  if (production && !appOrigin.startsWith('https://')) warnings.push('APP_ORIGIN should use https:// in production.');
  for (const warning of warnings) console.warn(`[config] ${warning}`);
  return {
    production,
    port: int(env.API_PORT ?? env.PORT, 8787, 1, 65535),
    appOrigin,
    database: env.DATABASE_URL
      ? { kind: 'postgres', url: env.DATABASE_URL }
      : { kind: 'pglite', dir: memory ? null : (env.PGLITE_DIR || '.data/pglite') },
    oidc: {
      issuer: env.OIDC_ISSUER || 'https://accounts.google.com',
      clientId: env.OIDC_CLIENT_ID || null,
      clientSecret: env.OIDC_CLIENT_SECRET || null,
      allowInsecure: !production && flag(env.OIDC_ALLOW_INSECURE),
      allowLoginHint: !production && flag(env.OIDC_ALLOW_LOGIN_HINT),
    },
    session: {
      ttlDays: int(env.SESSION_TTL_DAYS, 30, 1, 365),
      // __Host- requires Secure, Path=/ and no Domain: the cookie cannot be set by subdomains.
      cookieName: secure ? '__Host-debtnav_session' : 'debtnav_session',
      secure,
    },
    rateLimitPerMinute: int(env.RATE_LIMIT_PER_MINUTE, 300, 1, 100000),
    staticDir: env.SERVE_STATIC_DIR || (production ? 'dist' : null),
    bodyLimitBytes: BODY_LIMIT_BYTES,
  };
}

export const oidcConfigured = (config: ServerConfig): boolean => Boolean(config.oidc.clientId && config.oidc.clientSecret);
