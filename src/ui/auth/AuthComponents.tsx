/**
 * US-1201 presentational pieces. App.tsx (backend) wires them to the session hook; none of them talks
 * to the network or reads storage. They render without a PlannerStore.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { OverviewContent } from '../overview/OverviewContent';
import '../planner.css';
import './auth.css';

/** Public signed-out page: product introduction (same content as the Overview dashboard) + sign-in. */
export function PublicOverview({ signIn, notice }: { signIn: ReactNode; notice?: ReactNode }) {
  return (
    <div className="public-page">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="app-header public-header">
        <h1>DebtNav</h1>
        <p className="tagline">Student loan planning: borrow for each school year, then plan repayment.</p>
      </header>
      <main id="main" tabIndex={-1}>
        {notice}
        <section className="panel overview public-overview" aria-labelledby="public-overview-heading">
          <OverviewContent headingId="public-overview-heading" heading="Plan your student loans">
            <div className="public-signin">
              {signIn}
              <p className="field-hint">Sign in to create your plan. It is saved to your account, on any device.</p>
            </div>
          </OverviewContent>
        </section>
      </main>
      <footer className="app-footer">
        <p>DebtNav · Estimates for your own planning, not financial advice.</p>
      </footer>
    </div>
  );
}

export function SignInButton({ onSignIn, busy = false }: { onSignIn(): void; busy?: boolean }) {
  return (
    <button type="button" className="button-primary signin-button" onClick={onSignIn} disabled={busy} aria-busy={busy || undefined}>
      <svg className="signin-button__logo" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      {busy ? 'Opening Google sign-in…' : 'Sign in with Google'}
    </button>
  );
}

export type SignInNoticeKind = 'cancelled' | 'failed' | 'expired' | 'deleted' | 'signedOut';

const NOTICE_TEXT: Record<SignInNoticeKind, { title: string; body: string; tone: 'info' | 'warning' }> = {
  cancelled: { tone: 'info', title: 'Sign-in was cancelled.', body: 'Nothing was changed. Choose Sign in with Google when you are ready.' },
  failed: { tone: 'warning', title: 'Sign-in didn\'t work.', body: 'Google sign-in could not be completed. Please try again. If it keeps failing, try again later.' },
  expired: { tone: 'info', title: 'Your session ended.', body: 'Please sign in again. Your saved plan is still on your account.' },
  deleted: { tone: 'info', title: 'Your DebtNav data was deleted.', body: 'Your plan and account record were removed. You can sign in again to start a new plan.' },
  signedOut: { tone: 'info', title: 'You are signed out.', body: 'Signing out keeps your saved plan on your account; sign in again on any device to continue.' },
};

/** Result of an attempted sign-in (cancelled / failed), an expired session, sign-out or account deletion. */
export function SignInNotice({ kind, detail, onDismiss }: { kind: SignInNoticeKind; detail?: string | null; onDismiss?(): void }) {
  const text = NOTICE_TEXT[kind];
  return (
    <div className={`notice notice--${text.tone} auth-notice`} role={text.tone === 'warning' ? 'alert' : 'status'} data-notice={kind}>
      {text.tone === 'warning' && <span className="notice-icon" aria-hidden="true">!</span>}
      <p><strong>{text.title}</strong> {text.body}{detail ? ` (${detail})` : ''}</p>
      {onDismiss && <button type="button" className="link-button" onClick={onDismiss}>Dismiss<span className="visually-hidden"> message</span></button>}
    </div>
  );
}

/** Shown instead of a sign-in button when the server has no OpenID Connect credentials (no fake login). */
export function AuthNotConfigured() {
  return (
    <section className="auth-setup" aria-labelledby="auth-setup-heading">
      <h3 id="auth-setup-heading">Sign-in isn't set up yet</h3>
      <p>This DebtNav server has no Google sign-in credentials, so nobody can sign in and plans can't be saved. Nothing is wrong with your data.</p>
      <p>If you run this server: create an OAuth client in Google Cloud, set <code>OIDC_CLIENT_ID</code> and <code>OIDC_CLIENT_SECRET</code> (see <code>.env.example</code>), add the redirect URL <code>&lt;your site&gt;/api/auth/callback</code>, and restart. Step-by-step instructions are in <code>docs/BACKEND.md</code>.</p>
    </section>
  );
}

/** The session check itself failed (server unreachable, unexpected response). */
export function AuthError({ message, onRetry }: { message?: string | null; onRetry?(): void }) {
  return (
    <div className="notice notice--warning auth-notice" role="alert">
      <span className="notice-icon" aria-hidden="true">!</span>
      <p><strong>DebtNav can't reach its server right now.</strong> {message ?? 'Check your connection and try again.'}</p>
      {onRetry && <button type="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export interface DevicePlanSummary { loans: number; schoolYears: number; savedAt: string | null }

/**
 * US-1201: a plan saved in this browser before accounts existed was found. Offered for explicit use;
 * never attached automatically.
 */
export function DevicePlanPrompt({ summary, busy = false, error, onUse, onDismiss }: {
  summary: DevicePlanSummary; busy?: boolean; error?: string | null; onUse(): void; onDismiss(): void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, []);
  const saved = summary.savedAt ? new Date(summary.savedAt) : null;
  const savedText = saved && !Number.isNaN(saved.getTime()) ? ` last saved ${saved.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}` : '';
  return (
    <section className="device-plan" aria-labelledby="device-plan-heading">
      <h2 id="device-plan-heading" ref={headingRef} tabIndex={-1}>A plan was found in this browser</h2>
      <p>
        This browser has a DebtNav plan from before accounts{savedText}: {summary.schoolYears} school year{summary.schoolYears === 1 ? '' : 's'} and {summary.loans} loan{summary.loans === 1 ? '' : 's'}.
        Use it as your account's plan? It replaces the plan currently in your account, and you can undo this during this session.
      </p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="button-row">
        <button type="button" className="button-primary" onClick={onUse} disabled={busy} aria-busy={busy || undefined}>
          {busy ? 'Using device plan…' : 'Use my device plan'}
        </button>
        <button type="button" onClick={onDismiss} disabled={busy}>Keep my account plan</button>
      </div>
    </section>
  );
}
