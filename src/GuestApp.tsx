/**
 * Guest mode (optional sign-in): the full four-page planner without an account. The plan is saved on
 * this browser only (GUEST_PLAN_KEY via usePlannerDocument) and is never sent to the server: this
 * component takes no API client, so guest mode makes no /api/plan or /api/workbook requests. JSON
 * import/export works; Excel explains it needs an account.
 *
 * App.tsx renders it whenever there is no usable account session (signed out, sign-in not configured,
 * auth server unreachable, or the account plan could not be loaded) and keys it by session epoch, so
 * after sign-out it remounts fresh from browser storage.
 */
import { useCallback, useMemo, type ReactNode } from 'react';
import PlannerApp from './ui/PlannerApp';
import { GuestModeNotice } from './ui/auth';
import type { GuestInfo } from './ui/auth';
import type { PlannerDocument, Result, StorageLike } from './engine/planner-contracts';
import type { GuestReason } from './state/persistence';
import { usePlannerDocument, type GuestPlannerStore } from './state/usePlannerDocument';

/** What App needs to start sign-in from guest mode (contract E). */
export interface GuestSignInHandle {
  /** Writes pending edits now; saved = the plan shown is durably stored in this browser. */
  flushNow(): { saved: boolean };
  /** The plan as currently shown. */
  document: PlannerDocument;
  /** JSON export of the latest plan (same format as Your data → Export plan). */
  exportJson(): Result<string>;
}

export interface GuestAppProps {
  reason: GuestReason;
  /** False when sign-in can't be used (not configured, server unreachable, account unavailable). */
  signInAvailable: boolean;
  /** "Sign in with Google to save across devices" was chosen. */
  onSignIn(handle: GuestSignInHandle): void;
  /** Sign-in result / sign-out notice (SignInNotice), shown above the planner. */
  notice?: ReactNode;
  /** True while the browser is leaving for Google sign-in. */
  signInBusy?: boolean;
  /** authUnavailable: re-check the session; accountUnavailable: retry loading the account plan. */
  onRetry?(): void;
  /** Detail for authUnavailable / accountUnavailable. */
  errorMessage?: string | null;
  /** Slot for App's dialogs (e.g. "plan isn't saved" before sign-in). */
  devicePlanPrompt?: ReactNode;
  /** Tests only: storage to use instead of window.localStorage. */
  storage?: StorageLike;
}

const UNAVAILABLE_TEXT: Record<GuestReason, string> = {
  signedOut: 'Sign-in isn\'t available right now.',
  notConfigured: 'Sign-in isn\'t set up on this server, so you can\'t sign in here. You can still use every page without an account.',
  authUnavailable: 'Sign-in is unavailable while DebtNav can\'t reach its server. Use Try again in the message above.',
  accountUnavailable: 'Your account plan couldn\'t be loaded. Use the button in the message above to try again.',
};

export function storageWorks(store: GuestPlannerStore): boolean {
  const state = store.saveStatus.state;
  return state === 'saved' || state === 'pending' || state === 'saving';
}

export default function GuestApp({
  reason, signInAvailable, onSignIn, notice, signInBusy, onRetry, errorMessage, devicePlanPrompt, storage,
}: GuestAppProps) {
  const store = usePlannerDocument({ storage });
  const { flushNow, exportJson, document } = store;
  const works = storageWorks(store);

  const startSignIn = useCallback(() => {
    onSignIn({ flushNow, exportJson, document });
  }, [onSignIn, flushNow, exportJson, document]);

  const guest = useMemo<GuestInfo>(() => ({
    signInAvailable,
    onSignIn: startSignIn,
    signInBusy,
    signInUnavailableText: signInAvailable ? undefined : UNAVAILABLE_TEXT[reason],
    notice: (
      <>
        <GuestModeNotice reason={reason} storageWorks={works} message={errorMessage} onRetry={onRetry} />
        {notice}
      </>
    ),
  }), [signInAvailable, startSignIn, signInBusy, reason, works, errorMessage, onRetry, notice]);

  return <PlannerApp store={store} guest={guest} devicePlanPrompt={devicePlanPrompt} />;
}
