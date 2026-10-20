/**
 * Signed-in planner (optional Google sign-in). App mounts this only in account mode, keyed by
 * `${user.id}:${epoch}`, and only after any guest-plan choice is resolved. Everything account-specific
 * — the server store, its cache, undo history — lives inside this subtree, so unmounting it (sign-out,
 * account switch) removes every trace of the account from the visible app.
 *
 * All requests go through client.forUser(user.id): if this browser's session now belongs to another
 * account (or none), the server refuses with accountChanged instead of reading or writing the wrong
 * account. The guard stops every save, retry and late response once this account session ends.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import PlannerApp from './ui/PlannerApp';
import type { AccountInfo } from './ui/auth';
import { useSignOutConfirm } from './ui/auth/SignOutDialog';
import type { ApiClient, ApiUser } from './state/api';
import type { AccountGuard } from './state/accountGuard';
import type { Session } from './state/session';
import { endAccountSession, signOutFlow } from './state/signOut';
import { useServerPlanLoad, useServerPlannerDocument, type LoadedPlan } from './state/useServerPlannerDocument';

export interface AccountAppProps {
  /** The app's raw client; AccountApp pins it to `user` with forUser. */
  client: ApiClient;
  user: ApiUser;
  session: Session;
  /** One per mount (App creates it and revokes it on unmount). */
  guard: AccountGuard;
  /** "Use this browser's plan for now" after the account plan could not be loaded → guest mode (accountUnavailable). */
  onUseGuestPlan(): void;
  /** Optional message shown above the planner (rendered in PlannerApp's prompt slot). */
  notice?: ReactNode;
}

export const ACCOUNT_LOAD_ERROR_TITLE = 'Your account plan could not be loaded.';
export const USE_BROWSER_PLAN_LABEL = 'Use this browser\'s plan for now';

export default function AccountApp({ client, user, session, guard, onUseGuestPlan, notice }: AccountAppProps) {
  const pinned = useMemo(() => client.forUser(user.id), [client, user.id]);
  const onUnauthorized = useCallback(() => endAccountSession({ guard, session, notice: 'expired', userId: user.id }), [guard, session, user.id]);
  const onLoadAccountChanged = useCallback(() => endAccountSession({ guard, session, notice: 'accountChanged', userId: user.id }), [guard, session, user.id]);
  const load = useServerPlanLoad({ api: pinned, userId: user.id, guard, onUnauthorized, onAccountChanged: onLoadAccountChanged });

  if (load.status === 'loading') return <p className="app-loading" role="status">Loading your plan…</p>;
  if (load.status === 'error') return <AccountLoadError message={load.message} onRetry={load.retry} onUseGuestPlan={onUseGuestPlan} />;
  return <LoadedPlanner client={pinned} user={user} session={session} guard={guard} loaded={load.loaded} onUnauthorized={onUnauthorized} notice={notice} />;
}

/** Not a dead end: retry, or keep planning with this browser's (guest) plan. No account data is shown. */
function AccountLoadError({ message, onRetry, onUseGuestPlan }: { message: string; onRetry(): void; onUseGuestPlan(): void }) {
  return (
    <main className="account-load-error">
      <div className="notice notice--warning auth-notice" role="alert">
        <span className="notice-icon" aria-hidden="true">!</span>
        <p><strong>{ACCOUNT_LOAD_ERROR_TITLE}</strong> {message} Nothing in your account was changed.</p>
        <p>
          <button type="button" onClick={onRetry}>Try again</button>{' '}
          <button type="button" onClick={onUseGuestPlan}>{USE_BROWSER_PLAN_LABEL}</button>
        </p>
      </div>
    </main>
  );
}

function LoadedPlanner({ client, user, session, guard, loaded, onUnauthorized, notice }: {
  client: ApiClient; user: ApiUser; session: Session; guard: AccountGuard; loaded: LoadedPlan; onUnauthorized(): void; notice?: ReactNode;
}) {
  const [accountChanged, setAccountChanged] = useState(false);
  const onAccountDeleted = useCallback(() => endAccountSession({ guard, session, notice: 'deleted', userId: user.id }), [guard, session, user.id]);
  // Another tab signed out or switched accounts: saving is already blocked; keep the edits on screen
  // until the user has had the chance to export them.
  const onAccountChanged = useCallback(() => setAccountChanged(true), []);
  const { store, flush, isDirty } = useServerPlannerDocument({ api: client, userId: user.id, guard, onUnauthorized, onAccountDeleted, onAccountChanged }, loaded);
  const signOutConfirm = useSignOutConfirm({ exportJson: store.exportJson });
  const { confirmUnsaved } = signOutConfirm;

  const account = useMemo<AccountInfo>(() => ({
    email: user.email,
    onSignOut: async () => {
      // signOutFlow saves first, asks before discarding unsaved changes, then revokes the guard,
      // clears this account's caches and ends the session. Signing out never deletes the saved plan.
      await signOutFlow({
        // isDirty: any edit the server has not confirmed (pending, saving, offline, error, conflict).
        guard, userId: user.id, session, flush, isDirty, confirmUnsaved,
      });
    },
  }), [confirmUnsaved, flush, guard, isDirty, session, user]);

  const prompt = accountChanged
    ? <AccountChangedNotice onContinue={() => endAccountSession({ guard, session, notice: 'accountChanged', userId: user.id })} />
    : notice;

  return (
    <>
      <PlannerApp store={store} account={account} workbook={client} devicePlanPrompt={prompt} />
      {signOutConfirm.dialog}
    </>
  );
}

function AccountChangedNotice({ onContinue }: { onContinue(): void }) {
  return (
    <div className="notice notice--warning auth-notice" role="alert" data-notice="accountChanged">
      <span className="notice-icon" aria-hidden="true">!</span>
      <p>
        <strong>You signed out or switched accounts in another tab or window.</strong> Changes on this page are no
        longer being saved to this account. Export a copy from Your data if you want to keep them, then continue.
      </p>
      <button type="button" onClick={onContinue}>Continue</button>
    </div>
  );
}
