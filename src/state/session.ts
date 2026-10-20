/**
 * Sign-in state for the app shell. Google sign-in is optional: without it the app runs in guest mode.
 * Sign-in is a full-page redirect through the API (/api/auth/login → Google → /api/auth/callback); the
 * session is an httpOnly cookie the page cannot read, so status comes from /api/me. Cancelled/failed
 * sign-ins come back as ?authError=… .
 *
 * `epoch` increases every time the signed-in user changes (sign-in resolved, sign-out, expiry, another
 * tab switching accounts). The app keys the account subtree by `${user.id}:${epoch}`, so a new epoch
 * always unmounts the previous account's store, undo history and pending work.
 *
 * Other tabs learn about sign-out through a `storage` event on AUTH_SIGNAL_KEY (the value is only a
 * timestamp, never account data) and silently re-check /api/me.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api as defaultApi, type ApiClient, type ApiUser } from './api';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn' | 'notConfigured' | 'error';
export type AuthNotice = 'cancelled' | 'failed' | 'expired' | 'deleted' | 'signedOut';

export const AUTH_SIGNAL_KEY = 'debtnav.authSignal';
export const SIGN_OUT_INCOMPLETE_DETAIL =
  'DebtNav couldn\'t confirm sign-out with the server. Your account data was removed from this browser; sign out again or close the browser to end the session.';
const UNREACHABLE = 'DebtNav could not reach its server. Check your connection and try again.';

export interface Session {
  status: SessionStatus;
  user: ApiUser | null;
  /** Increases whenever the signed-in user changes (including to/from nobody). */
  epoch: number;
  /** Why the user is looking at guest mode (shown once, dismissible). */
  authNotice: AuthNotice | null;
  /** Extra detail for the notice, e.g. when the server could not confirm sign-out. */
  authNoticeDetail: string | null;
  /** Message for status 'error' (server unreachable). */
  error: string | null;
  signIn(returnTo?: string): void;
  /**
   * Ends the session on the server, then switches to guest mode (even if the server call failed; the
   * notice detail then says so). Callers must already have revoked the account guard and cleared
   * account caches — use signOutFlow (src/state/signOut.ts), not this directly.
   */
  signOut(): Promise<{ loggedOut: boolean }>;
  /** Switch to signed-out without a server call (after account deletion or an expired session). */
  markSignedOut(notice: AuthNotice | null): void;
  /** Silently re-checks /api/me; changes state (and epoch) only if the user differs. */
  recheck(): void;
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

/** Tells other tabs of this browser to re-check who is signed in. Never throws. */
function signalOtherTabs(): void {
  try {
    window.localStorage.setItem(AUTH_SIGNAL_KEY, String(Date.now()));
  } catch {
    // Storage unavailable: other tabs find out on their next request (401 / accountChanged).
  }
}

interface CoreState { status: SessionStatus; user: ApiUser | null; error: string | null; epoch: number }

/** Next state; the epoch moves only when the user identity changes. */
function next(previous: CoreState, status: SessionStatus, user: ApiUser | null, error: string | null = null): CoreState {
  const changed = (previous.user?.id ?? null) !== (user?.id ?? null);
  return { status, user, error, epoch: changed ? previous.epoch + 1 : previous.epoch };
}

export function useSession(client: ApiClient = defaultApi): Session {
  const [state, setState] = useState<CoreState>({ status: 'loading', user: null, error: null, epoch: 0 });
  const [notice, setNotice] = useState<{ kind: AuthNotice | null; detail: string | null }>(() => ({ kind: takeAuthErrorFromUrl(), detail: null }));
  const [attempt, setAttempt] = useState(0);
  // Every identity change bumps this; an async /api/me answer started before it is dropped.
  const generation = useRef(0);
  const stateRef = useRef(state);
  useLayoutEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    let cancelled = false;
    const started = generation.current;
    const stale = () => cancelled || started !== generation.current;
    void (async () => {
      const config = await client.authConfig();
      if (stale()) return;
      if (!config.ok) {
        setState(previous => next(previous, 'error', null, UNREACHABLE));
        return;
      }
      if (!config.configured) {
        setState(previous => next(previous, 'notConfigured', null));
        return;
      }
      const me = await client.me();
      if (stale()) return;
      if (!me.ok) setState(previous => next(previous, 'error', null, UNREACHABLE));
      else setState(previous => next(previous, me.user ? 'signedIn' : 'signedOut', me.user));
    })();
    return () => { cancelled = true; };
  }, [client, attempt]);

  const signIn = useCallback((returnTo?: string) => {
    const target = returnTo ?? `${window.location.pathname}${window.location.hash}`;
    window.location.assign(client.loginUrl(target.startsWith('/') ? target : '/'));
  }, [client]);

  const signOut = useCallback(async () => {
    generation.current += 1;
    const result = await client.logout();
    generation.current += 1;
    setState(previous => next(previous, 'signedOut', null));
    setNotice({ kind: 'signedOut', detail: result.ok ? null : SIGN_OUT_INCOMPLETE_DETAIL });
    signalOtherTabs();
    return { loggedOut: result.ok };
  }, [client]);

  const markSignedOut = useCallback((kind: AuthNotice | null) => {
    generation.current += 1;
    setState(previous => next(previous, 'signedOut', null));
    setNotice({ kind, detail: null });
  }, []);

  const recheck = useCallback(() => {
    const started = generation.current;
    void (async () => {
      const me = await client.me();
      if (started !== generation.current || !me.ok) return;
      const current = stateRef.current;
      if (current.status !== 'signedIn' && current.status !== 'signedOut') return;
      if ((current.user?.id ?? null) === (me.user?.id ?? null)) return;
      generation.current += 1;
      setState(previous => next(previous, me.user ? 'signedIn' : 'signedOut', me.user));
      // A user who disappeared (signed out in another tab) sees why.
      if (!me.user) setNotice({ kind: 'signedOut', detail: null });
    })();
  }, [client]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === AUTH_SIGNAL_KEY) recheck(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [recheck]);

  const dismissNotice = useCallback(() => setNotice({ kind: null, detail: null }), []);
  const retry = useCallback(() => {
    generation.current += 1;
    setState(previous => ({ ...previous, status: 'loading', error: null }));
    setAttempt(value => value + 1);
  }, []);

  return { ...state, authNotice: notice.kind, authNoticeDetail: notice.detail, signIn, signOut, markSignedOut, recheck, dismissNotice, retry };
}
