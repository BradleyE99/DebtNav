/**
 * Sign-in state for the app shell (US-1201). Google sign-in is a full-page redirect through the API
 * (/api/auth/login → Google → /api/auth/callback); the session is an httpOnly cookie the page cannot
 * read, so status comes from /api/me. Cancelled/failed sign-ins come back as ?authError=… .
 */
import { useCallback, useEffect, useState } from 'react';
import { api as defaultApi, type ApiClient, type ApiUser } from './api';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn' | 'notConfigured' | 'error';
export type AuthNotice = 'cancelled' | 'failed' | 'expired' | 'deleted' | 'signedOut';

export interface Session {
  status: SessionStatus;
  user: ApiUser | null;
  /** Why the user is looking at the signed-out screen (shown once, dismissible). */
  authNotice: AuthNotice | null;
  /** Message for status 'error' (server unreachable). */
  error: string | null;
  signIn(returnTo?: string): void;
  /** Ends the session on the server. Saved plans stay on the account. */
  signOut(): Promise<void>;
  /** Switch to signed-out without a server call (after account deletion or an expired session). */
  markSignedOut(notice: AuthNotice | null): void;
  dismissNotice(): void;
  retry(): void;
}

/** Reads and removes ?authError=cancelled|failed from the address bar. */
function takeAuthErrorFromUrl(): AuthNotice | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const value = url.searchParams.get('authError');
  if (value === null) return null;
  url.searchParams.delete('authError');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return value === 'cancelled' ? 'cancelled' : 'failed';
}

export function useSession(client: ApiClient = defaultApi): Session {
  const [state, setState] = useState<{ status: SessionStatus; user: ApiUser | null; error: string | null }>({ status: 'loading', user: null, error: null });
  const [authNotice, setAuthNotice] = useState<AuthNotice | null>(() => takeAuthErrorFromUrl());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const config = await client.authConfig();
      if (cancelled) return;
      if (!config.ok) {
        setState({ status: 'error', user: null, error: 'DebtNav could not reach its server. Check your connection and try again.' });
        return;
      }
      if (!config.configured) {
        setState({ status: 'notConfigured', user: null, error: null });
        return;
      }
      const me = await client.me();
      if (cancelled) return;
      if (!me.ok) setState({ status: 'error', user: null, error: 'DebtNav could not reach its server. Check your connection and try again.' });
      else setState({ status: me.user ? 'signedIn' : 'signedOut', user: me.user, error: null });
    })();
    return () => { cancelled = true; };
  }, [client, attempt]);

  const signIn = useCallback((returnTo?: string) => {
    const target = returnTo ?? `${window.location.pathname}${window.location.hash}`;
    window.location.assign(client.loginUrl(target.startsWith('/') ? target : '/'));
  }, [client]);

  const signOut = useCallback(async () => {
    await client.logout();
    setState({ status: 'signedOut', user: null, error: null });
    setAuthNotice('signedOut');
  }, [client]);

  const markSignedOut = useCallback((notice: AuthNotice | null) => {
    setState({ status: 'signedOut', user: null, error: null });
    setAuthNotice(notice);
  }, []);

  const dismissNotice = useCallback(() => setAuthNotice(null), []);
  const retry = useCallback(() => {
    setState({ status: 'loading', user: null, error: null });
    setAttempt(value => value + 1);
  }, []);

  return { ...state, authNotice, signIn, signOut, markSignedOut, dismissNotice, retry };
}
