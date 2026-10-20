/**
 * Sign-in presentational pieces (optional Google sign-in). App.tsx and GuestApp wire them to the
 * session hook; none of them talks to the network or reads storage. They render without a PlannerStore.
 * Signing in is optional: guests use the whole planner and their plan is saved on this browser.
 */
import type { ReactNode } from 'react';
import '../planner.css';
import './auth.css';

export const SIGN_IN_LABEL = 'Sign in with Google';
export const GUEST_SIGN_IN_LABEL = 'Sign in with Google to save across devices';

export function SignInButton({ onSignIn, busy = false, label = SIGN_IN_LABEL, primary = true, disabled = false, describedBy }: {
  onSignIn(): void; busy?: boolean; label?: string; primary?: boolean; disabled?: boolean; describedBy?: string;
}) {
  return (
    <button type="button" className={primary ? 'button-primary signin-button' : 'signin-button'} onClick={onSignIn}
      disabled={busy || disabled} aria-busy={busy || undefined} aria-describedby={describedBy}>
      <svg className="signin-button__logo" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
      {busy ? 'Opening Google sign-in…' : label}
    </button>
  );
}

export type SignInNoticeKind = 'cancelled' | 'failed' | 'expired' | 'deleted' | 'signedOut';

export const NOTICE_TEXT: Record<SignInNoticeKind, { title: string; body: string; tone: 'info' | 'warning' }> = {
  cancelled: { tone: 'info', title: 'Sign-in was cancelled.', body: 'Nothing was changed. Choose Sign in with Google when you are ready. Your plan on this browser was not changed.' },
  failed: { tone: 'warning', title: 'Sign-in didn\'t work.', body: 'Google sign-in could not be completed. Please try again. If it keeps failing, try again later. Your plan on this browser was not changed.' },
  expired: { tone: 'info', title: 'Your session ended.', body: 'Please sign in again. Your saved plan is still on your account; this browser now shows your guest plan.' },
  deleted: { tone: 'info', title: 'Your DebtNav data was deleted.', body: 'Your plan and account record were removed. You can keep planning without an account, or sign in again to start a new account plan.' },
  signedOut: { tone: 'info', title: 'You are signed out.', body: 'Your account plan stays in your account; this browser now shows your guest plan.' },
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

/** Where the guest plan is (or isn't) being saved, for the non-blocking guest notices. */
export function guestSavingSentence(storageWorks: boolean): string {
  return storageWorks
    ? 'Your plan is saved on this browser only.'
    : 'This browser can\'t save your plan, so your changes are not saved. Export a copy to keep them.';
}

export const SIGN_IN_NOT_CONFIGURED_TEXT = 'Sign-in isn\'t set up on this server.';
export const SIGN_IN_UNREACHABLE_TEXT = 'Sign-in is unavailable because DebtNav can\'t reach its server right now.';

/**
 * Non-blocking notice: the server has no OpenID Connect credentials, so sign-in is unavailable (no
 * fake login). The planner keeps working; `storageWorks` keeps the saving sentence truthful.
 */
export function AuthNotConfigured({ storageWorks = true }: { storageWorks?: boolean }) {
  return (
    <div className="notice notice--info auth-notice guest-notice" role="status" data-notice="notConfigured">
      <p><strong>{SIGN_IN_NOT_CONFIGURED_TEXT}</strong> {guestSavingSentence(storageWorks)}</p>
      <details>
        <summary>Setting up sign-in (for the person who runs this server)</summary>
        <p>Create an OAuth client in Google Cloud, set <code>OIDC_CLIENT_ID</code> and <code>OIDC_CLIENT_SECRET</code> (see <code>.env.example</code>), add the redirect URL <code>&lt;your site&gt;/api/auth/callback</code>, and restart. Step-by-step instructions are in <code>docs/BACKEND.md</code>.</p>
      </details>
    </div>
  );
}

/** The session check or an account request failed (server unreachable, unexpected response). `extra` adds a sentence. */
export function AuthError({ message, onRetry, extra }: { message?: string | null; onRetry?(): void; extra?: ReactNode }) {
  return (
    <div className="notice notice--warning auth-notice" role="alert">
      <span className="notice-icon" aria-hidden="true">!</span>
      <p><strong>DebtNav can't reach its server right now.</strong> {message ?? 'Check your connection and try again.'}{extra ? <> {extra}</> : null}</p>
      {onRetry && <button type="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export type GuestNoticeReason = 'signedOut' | 'notConfigured' | 'authUnavailable' | 'accountUnavailable';

/**
 * Why this browser is in guest mode, when it is not simply "signed out". Never blocks the planner.
 * authUnavailable: the session check failed. accountUnavailable: signed in, but the account plan could
 * not be loaded, so this browser's plan is shown instead (no account data loaded or changed).
 */
export function GuestModeNotice({ reason, storageWorks, message, onRetry }: {
  reason: GuestNoticeReason; storageWorks: boolean; message?: string | null; onRetry?(): void;
}) {
  if (reason === 'signedOut') return null;
  if (reason === 'notConfigured') return <AuthNotConfigured storageWorks={storageWorks} />;
  if (reason === 'authUnavailable') {
    return (
      <div className="notice notice--warning auth-notice guest-notice" role="status" data-notice="authUnavailable">
        <span className="notice-icon" aria-hidden="true">!</span>
        <p><strong>{SIGN_IN_UNREACHABLE_TEXT}</strong> {message ? `${message} ` : ''}You can keep planning. {guestSavingSentence(storageWorks)}</p>
        {onRetry && <button type="button" onClick={onRetry}>Try again</button>}
      </div>
    );
  }
  return (
    <div className="notice notice--warning auth-notice guest-notice" role="status" data-notice="accountUnavailable">
      <span className="notice-icon" aria-hidden="true">!</span>
      <p><strong>Your account plan couldn't be loaded.</strong> {message ? `${message} ` : ''}This is your plan on this browser; your account plan was not changed. {guestSavingSentence(storageWorks)}</p>
      {onRetry && <button type="button" onClick={onRetry}>Try loading my account plan again</button>}
    </div>
  );
}
