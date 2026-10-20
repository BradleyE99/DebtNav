/**
 * Sign-out and session-end flows. Order matters: the account guard is revoked synchronously first, so
 * no pending save, retry, cache write, status change or late response from the old account can run
 * afterwards; then this user's account caches are removed; then the server session ends and the app
 * switches to guest mode (new session epoch → the account subtree unmounts). Account data is never
 * written to the guest plan key, and a separate guest draft is left untouched.
 */
import { useLayoutEffect, useState } from 'react';
import type { SaveStatus, StorageLike } from '../engine/planner-contracts';
import { createAccountGuard, type AccountGuard } from './accountGuard';
import { clearAccountCaches } from './persistence';
import type { AuthNotice, Session } from './session';

export type SignOutDecision = 'signOutAnyway' | 'stay';
export type SignOutOutcome =
  | { kind: 'stayed' }
  | { kind: 'alreadyEnded' }
  | { kind: 'signedOut'; discardedUnsavedChanges: boolean; serverLogout: boolean; cacheCleared: boolean };

export const SIGN_OUT_FLUSH_TIMEOUT_MS = 5000;

export interface SignOutFlowOptions {
  guard: AccountGuard;
  userId: string;
  session: Pick<Session, 'signOut'>;
  /** Saves pending account edits (resolves when done or given up). */
  flush(): Promise<void>;
  /** True while the account has edits the server has not confirmed. */
  isDirty(): boolean;
  /** Asks the user what to do with unsaved account changes (SignOutDialog / useSignOutConfirm). */
  confirmUnsaved(): Promise<SignOutDecision>;
  storage?: StorageLike;
  flushTimeoutMs?: number;
}

/** Save states in which the account has changes the server has not confirmed. */
export function hasUnsavedAccountChanges(status: Pick<SaveStatus, 'state'>): boolean {
  return status.state === 'pending' || status.state === 'saving' || status.state === 'offline' || status.state === 'error' || status.state === 'conflict';
}

function within(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    promise.then(() => { clearTimeout(timer); resolve(); }, () => { clearTimeout(timer); resolve(); });
  });
}

export async function signOutFlow(options: SignOutFlowOptions): Promise<SignOutOutcome> {
  const { guard, userId, session } = options;
  if (!guard.active()) return { kind: 'alreadyEnded' };
  let discardedUnsavedChanges = false;
  if (options.isDirty()) {
    // Try to save first; if that cannot finish (offline, error, conflict), ask before discarding.
    await within(Promise.resolve().then(() => options.flush()), options.flushTimeoutMs ?? SIGN_OUT_FLUSH_TIMEOUT_MS);
    if (!guard.active()) return { kind: 'alreadyEnded' };
    if (options.isDirty()) {
      const decision = await options.confirmUnsaved();
      if (decision === 'stay') return { kind: 'stayed' };
      if (!guard.active()) return { kind: 'alreadyEnded' };
      discardedUnsavedChanges = true;
    }
  }
  guard.revoke();
  const cleared = clearAccountCaches(userId, options.storage);
  const result = await session.signOut();
  return { kind: 'signedOut', discardedUnsavedChanges, serverLogout: result.loggedOut, cacheCleared: cleared.ok };
}

export type SessionEndReason = AuthNotice | 'accountChanged';

/**
 * The server ended or switched the session (401, account deleted, X-DebtNav-User mismatch). Revokes
 * the guard synchronously, then switches state. An expired or switched session keeps this user's
 * account cache, so unsaved edits are recovered only when the same user signs in again (auth failures
 * must not erase unsaved edits; the cache is keyed per user and never shown to guests or other
 * accounts). A deleted account's cache is removed.
 */
export function endAccountSession(options: {
  guard: AccountGuard;
  session: Pick<Session, 'markSignedOut' | 'retry'>;
  notice: SessionEndReason;
  userId?: string;
  storage?: StorageLike;
}): void {
  const { guard, session, notice: reason } = options;
  if (!guard.active()) return;
  guard.revoke();
  if (reason === 'deleted' && options.userId) clearAccountCaches(options.userId, options.storage);
  // Another account is signed in now (e.g. in another tab): reload who it is; the old subtree unmounts.
  if (reason === 'accountChanged') session.retry();
  else session.markSignedOut(reason);
}

/**
 * One guard per mounted account subtree (key it by `${user.id}:${epoch}`). Revoked in a layout-effect
 * cleanup, which runs before any child's passive-effect cleanup (such as an unmount flush).
 */
export function useAccountGuard(userId: string, epoch: number): AccountGuard {
  const [guard, setGuard] = useState(() => createAccountGuard(userId, epoch));
  useLayoutEffect(() => {
    // StrictMode re-runs effects on mount (cleanup, then setup): replace a guard revoked by that
    // simulated unmount. A guard revoked while mounted (sign-out, expiry) is never replaced, because
    // this effect does not re-run for it.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time replacement after StrictMode's simulated unmount
    if (!guard.active()) { setGuard(createAccountGuard(userId, epoch)); return; }
    return () => guard.revoke();
  }, [guard, userId, epoch]);
  return guard;
}
