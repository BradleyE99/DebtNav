/**
 * Google (or any OpenID Connect) sign-in through openid-client v6. All protocol checks — PKCE S256,
 * state, nonce, ID-token signature/issuer/audience/expiry — are performed by the library; this file
 * only stores the per-login secrets and maps the validated claims to an identity.
 */
import * as client from 'openid-client';
import type { ServerConfig } from '../config';

export interface LoginStart { url: URL; state: string; codeVerifier: string; nonce: string }
export interface Identity { issuer: string; subject: string; email: string | null }

export interface OidcClient {
  /** Build the authorization URL and the secrets to remember for the callback. */
  start(options: { loginHint?: string }): Promise<LoginStart>;
  /** Exchange the code (validating state, PKCE and nonce) and return the ID-token identity. */
  finish(callbackUrl: URL, checks: { state: string; codeVerifier: string; nonce: string }): Promise<Identity>;
}

export const redirectUri = (config: ServerConfig): string => `${config.appOrigin}/api/auth/callback`;

export function createOidcClient(config: ServerConfig): OidcClient {
  const { issuer, clientId, clientSecret, allowInsecure } = config.oidc;
  if (!clientId || !clientSecret) throw new Error('OIDC client is not configured');
  let discovered: Promise<client.Configuration> | null = null;
  const configuration = (): Promise<client.Configuration> => {
    discovered ??= client.discovery(new URL(issuer), clientId, { redirect_uris: [redirectUri(config)], response_types: ['code'] },
      client.ClientSecretBasic(clientSecret), allowInsecure ? { execute: [client.allowInsecureRequests] } : undefined)
      // A failed discovery (issuer unreachable) is retried on the next login instead of being cached.
      .catch(error => { discovered = null; throw error; });
    return discovered;
  };
  return {
    async start({ loginHint }) {
      const cfg = await configuration();
      const codeVerifier = client.randomPKCECodeVerifier();
      const state = client.randomState();
      const nonce = client.randomNonce();
      const params: Record<string, string> = {
        redirect_uri: redirectUri(config),
        scope: 'openid email',
        response_type: 'code',
        code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        state,
        nonce,
        prompt: 'select_account',
      };
      if (loginHint && config.oidc.allowLoginHint) params.login_hint = loginHint;
      return { url: client.buildAuthorizationUrl(cfg, params), state, codeVerifier, nonce };
    },
    async finish(callbackUrl, checks) {
      const cfg = await configuration();
      const tokens = await client.authorizationCodeGrant(cfg, callbackUrl, {
        pkceCodeVerifier: checks.codeVerifier,
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims?.sub) throw new Error('ID token without subject');
      const email = typeof claims.email === 'string' && claims.email_verified !== false ? claims.email : null;
      return { issuer: claims.iss, subject: claims.sub, email };
    },
  };
}
