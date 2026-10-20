/**
 * Asked once after Google sign-in when this browser holds a guest plan (see state/guestTransition.ts).
 * Nothing is copied, replaced or merged until the user chooses; replacing needs a second, explicit
 * confirmation and shows both plans.
 */
import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { formatDate, formatMonthYear } from '../format';
import type { GuestChoiceActions, GuestChoiceState, PlanSummary } from '../../state/guestTransition';

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

export function describePlan(summary: PlanSummary): string {
  const saved = summary.savedAt ? `, last saved ${formatDate(summary.savedAt.slice(0, 10), 'recently')}` : '';
  return `${plural(summary.schoolYears, 'school year')} (${formatMonthYear(summary.startDate)} to ${formatMonthYear(summary.graduationDate)}) and ${plural(summary.loans, 'loan')}${saved}`;
}

type ChoiceProps = GuestChoiceState & GuestChoiceActions & { email: string | null };

export function GuestPlanChoice(props: ChoiceProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [props.status]);

  const who = props.email ? ` (${props.email})` : '';
  let body;
  if (props.status === 'checking' || props.status === 'resolved') {
    body = (
      <>
        <h2 id="guest-choice-heading" ref={headingRef} tabIndex={-1}>Checking your account…</h2>
        <p role="status">Your plan on this browser is unchanged.</p>
      </>
    );
  } else if (props.status === 'loadError') {
    body = (
      <>
        <h2 id="guest-choice-heading" ref={headingRef} tabIndex={-1}>Your account could not be checked</h2>
        <p className="field-error" role="alert">{props.message}</p>
        <div className="button-row">
          <button type="button" className="button-primary" onClick={props.retry}>Try again</button>
          <button type="button" onClick={props.skip}>Continue without copying</button>
        </div>
      </>
    );
  } else {
    const { guest, account, busy, error } = props;
    body = (
      <>
        <h2 id="guest-choice-heading" ref={headingRef} tabIndex={-1}>You have a plan on this browser</h2>
        <p>You're signed in{who}. This browser has a plan you made without signing in: {describePlan(guest)}.</p>
        {account === null ? (
          <>
            <p>Your account doesn't have a plan yet. Save this browser's plan to your account to open it on other devices? Nothing is copied unless you choose to.</p>
            {error && <p className="field-error" role="alert">{error}</p>}
            <div className="button-row">
              <button type="button" className="button-primary" onClick={props.saveToAccount} disabled={busy} aria-busy={busy || undefined}>
                {busy ? 'Saving to your account…' : 'Save this plan to my account'}
              </button>
              <button type="button" onClick={props.keepSeparate} disabled={busy}>Not now — keep it on this browser</button>
            </div>
          </>
        ) : (
          <>
            <p>Your account already has a plan: {describePlan(account.summary)}. An account holds one plan, and plans are never merged.</p>
            {error && <p className="field-error" role="alert">{error}</p>}
            <div className="button-row">
              <button type="button" className="button-primary" onClick={props.keepSeparate} disabled={busy}>Open my account plan</button>
              <button type="button" onClick={() => setConfirming(true)} disabled={busy} aria-busy={busy || undefined}>
                {busy ? 'Replacing your account plan…' : "Replace my account plan with this browser's plan…"}
              </button>
            </div>
            <p className="field-hint">Opening your account plan keeps this browser's plan here; it appears again if you sign out.</p>
            {confirming && (
              <ConfirmDialog
                title="Replace your account plan?"
                confirmLabel="Replace account plan"
                destructive
                onCancel={() => setConfirming(false)}
                onConfirm={() => { setConfirming(false); props.replaceAccountPlan(); }}
              >
                <p>Your account plan ({describePlan(account.summary)}) will be replaced by this browser's plan ({describePlan(guest)}) on every device. Nothing is merged, and this can't be undone.</p>
              </ConfirmDialog>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <div className="public-page">
      <header className="app-header public-header">
        <h1>DebtNav</h1>
      </header>
      <main id="main">
        <section className="panel device-plan guest-plan-choice" aria-labelledby="guest-choice-heading" data-guest-choice={props.status}>
          {body}
        </section>
      </main>
    </div>
  );
}
