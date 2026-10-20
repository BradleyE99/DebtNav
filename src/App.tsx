/**
 * App shell: Google sign-in is optional (docs/REQUIREMENTS-v0.2.md §15). The persistence mode decides
 * which store holds the plan:
 * - guest (signed out, sign-in not configured, server unreachable, or account plan unavailable) →
 *   GuestApp: the full planner saved on this browser only; nothing financial is sent to the server.
 * - account → AccountApp: the plan is saved to the user's account. The subtree is keyed by
 *   `${user.id}:${epoch}` and gets one AccountGuard per mount, revoked on sign-out/switch, so late
 *   responses can't write caches or show one account's data to a guest or another account.
 * Before the account store mounts, a guest plan in this browser is offered (never uploaded just because
 * sign-in succeeded); see state/guestTransition.ts and GuestPlanChoice.
 */
import { useCallback, useEffect, useState } from 'react';
import GuestApp, { type GuestSignInHandle } from './GuestApp';
import AccountApp from './AccountApp';
import { SignInNotice } from './ui/auth';
import { GuestPlanChoice } from './ui/auth/GuestPlanChoice';
import { ConfirmDialog } from './ui/common/ConfirmDialog';
import { api as defaultApi, type ApiClient, type ApiUser } from './state/api';
import { useSession, type Session } from './state/session';
import { endAccountSession, useAccountGuard } from './state/signOut';
import { useGuestPlanChoice } from './state/guestTransition';
import type { GuestReason } from './state/persistence';
import type { AccountGuard } from './state/accountGuard';

export default function App({ client = defaultApi }: { client?: ApiClient }) {
  const session = useSession(client);
  /** "Use this browser's plan for now" after the account plan could not be loaded (per user + epoch). */
  const [guestFallback, setGuestFallback] = useState<string | null>(null);
  const [unsavedHandle, setUnsavedHandle] = useState<GuestSignInHandle | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [signInBusy, setSignInBusy] = useState(false);

  // Coming back from Google via the back button (bfcache) must not leave the button stuck.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => { if (event.persisted) setSignInBusy(false); };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const goToSignIn = useCallback(() => {
    setUnsavedHandle(null);
    setSignInBusy(true);
    session.signIn();
  }, [session]);

  const onSignIn = useCallback((handle: GuestSignInHandle) => {
    if (signInBusy) return;
    // The guest plan must survive the full-page redirect (and a cancelled or failed sign-in).
    const { saved } = handle.flushNow();
    if (saved) goToSignIn();
    else { setExportMessage(null); setUnsavedHandle(handle); }
  }, [goToSignIn, signInBusy]);

  const exportPlan = useCallback(() => {
    if (!unsavedHandle) return;
    const result = unsavedHandle.exportJson();
    if (!result.ok) { setExportMessage(result.errors[0]?.message ?? 'Export failed.'); return; }
    const url = URL.createObjectURL(new Blob([result.value], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `debtnav-plan-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setExportMessage('Plan exported as a JSON file. You can import it after signing in.');
  }, [unsavedHandle]);

  const user = session.status === 'signedIn' ? session.user : null;
  const accountKey = user ? `${user.id}:${session.epoch}` : null;

  let settled: GuestReason | null = null;
  if (user) settled = guestFallback === accountKey ? 'accountUnavailable' : null;
  else if (session.status === 'notConfigured') settled = 'notConfigured';
  else if (session.status === 'error') settled = 'authUnavailable';
  else if (session.status === 'signedOut') settled = 'signedOut';
  // While the session is re-checked (Try again), keep showing the guest planner rather than a blank screen.
  const [lastGuestReason, setLastGuestReason] = useState<GuestReason | null>(null);
  const checking = session.status === 'loading';
  if (!checking && settled !== lastGuestReason) setLastGuestReason(settled);
  const reason = checking ? lastGuestReason : settled;

  if (user && accountKey && reason === null) {
    return (
      <AccountShell
        key={accountKey}
        client={client}
        user={user}
        session={session}
        onUseGuestPlan={() => setGuestFallback(accountKey)}
      />
    );
  }
  if (reason === null) return <p className="app-loading" role="status">Loading DebtNav…</p>;

  const notice = session.authNotice && !user
    ? <SignInNotice kind={session.authNotice} detail={session.authNoticeDetail} onDismiss={session.dismissNotice} />
    : undefined;
  const onRetry = reason === 'authUnavailable' ? session.retry : reason === 'accountUnavailable' ? () => setGuestFallback(null) : undefined;

  return (
    <>
      <GuestApp
        key={`guest:${session.epoch}`}
        reason={reason}
        signInAvailable={reason === 'signedOut'}
        onSignIn={onSignIn}
        signInBusy={signInBusy}
        notice={notice}
        onRetry={onRetry}
        errorMessage={reason === 'authUnavailable' ? session.error : null}
      />
      {unsavedHandle && (
        <ConfirmDialog
          title="Your plan isn't saved on this browser"
          confirmLabel="Sign in anyway"
          onConfirm={goToSignIn}
          onCancel={() => setUnsavedHandle(null)}
        >
          <p>Your plan isn't saved on this browser, so it will be lost when you leave for Google sign-in. Export it first to keep a copy you can import afterwards.</p>
          <p><button type="button" onClick={exportPlan}>Export plan</button></p>
          {exportMessage && <p role="status">{exportMessage}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}

type AccountProps = { client: ApiClient; user: ApiUser; session: Session; onUseGuestPlan(): void };

const guardIds = new WeakMap<AccountGuard, number>();
let nextGuardId = 0;
function guardKey(guard: AccountGuard): number {
  let id = guardIds.get(guard);
  if (id === undefined) { id = ++nextGuardId; guardIds.set(guard, id); }
  return id;
}

/**
 * One signed-in account session. The guard is created per mount; React StrictMode's simulated
 * remount replaces a revoked guard, so the subtree is keyed by guard identity and anything started
 * with a dead guard restarts with the live one.
 */
function AccountShell(props: AccountProps) {
  const guard = useAccountGuard(props.user.id, props.session.epoch);
  return <AccountSession key={guardKey(guard)} {...props} guard={guard} />;
}

/** The guest-plan question, then the account planner. */
function AccountSession({ client, user, session, onUseGuestPlan, guard }: AccountProps & { guard: AccountGuard }) {
  const onUnauthorized = useCallback((kind: 'unauthorized' | 'accountChanged') => {
    endAccountSession({ guard, session, notice: kind === 'accountChanged' ? 'accountChanged' : 'expired' });
  }, [guard, session]);
  const choice = useGuestPlanChoice({ client, user, guard, onUnauthorized });

  if (choice.status !== 'resolved') return <GuestPlanChoice {...choice} email={user.email} />;
  const notice = choice.notice ? <p role="status" className="device-plan-error">{choice.notice}</p> : undefined;
  return <AccountApp client={client} user={user} session={session} guard={guard} onUseGuestPlan={onUseGuestPlan} notice={notice} />;
}
