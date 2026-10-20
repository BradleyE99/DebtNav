/// @vitest-environment jsdom
/** Introduction (account and guest modes), the sign-in notices, guest mode (GuestApp) and the header account menu. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { memoryStorage, renderPlanner, samplePlan, storedDocument } from '../testing/renderPlanner';
import { createDefaultPlan } from '../../engine/planner';
import type { StorageLike } from '../../engine/planner-contracts';
import { STORAGE_KEY, UNAVAILABLE_NOTICE } from '../../data/storage';
import { AuthError, AuthNotConfigured, GuestModeNotice, SignInButton, SignInNotice } from '../auth';
import GuestApp, { type GuestSignInHandle } from '../../GuestApp';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

const BROWSER_SAVED = 'Saved on this browser. Sign in to access your plan on other devices.';

function renderGuest(props: Partial<Parameters<typeof GuestApp>[0]> & { storage?: StorageLike } = {}) {
  window.scrollTo = () => {};
  const onSignIn = vi.fn<(handle: GuestSignInHandle) => void>();
  const storage = props.storage ?? memoryStorage();
  const view = render(<GuestApp reason="signedOut" signInAvailable onSignIn={onSignIn} {...props} storage={storage} />);
  return { ...view, onSignIn, storage };
}

/** The announced save status in the header. */
const headerStatus = () => within(screen.getByRole('banner')).getAllByRole('status').find(node => node.classList.contains('save-status'))!;

/** Storage that reads but rejects every write (private mode / quota exceeded). */
function readOnlyStorage(initial: Record<string, string> = {}): StorageLike {
  const base = memoryStorage(initial);
  return { getItem: base.getItem, removeItem: base.removeItem, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
}

describe('signed-in Introduction', () => {
  it('states the two questions and continues to the next destination that needs input', async () => {
    const user = userEvent.setup();
    renderPlanner({ plan: createDefaultPlan() });
    const intro = screen.getByRole('region', { name: 'Plan your student loans' });
    expect(within(intro).getByRole('heading', { name: 'How much do I need to borrow?' })).toBeTruthy();
    expect(within(intro).getByRole('heading', { name: 'When will I be debt-free?' })).toBeTruthy();
    expect(intro.textContent).toMatch(/items? needed/);
    // An empty plan first needs school costs (or a loan): Continue opens that destination.
    const next = within(intro).getByRole('link', { name: /^Continue to / });
    await user.click(next);
    expect(['school', 'loans']).toContain(document.querySelector('.dashboard')?.getAttribute('data-dashboard'));
  });

  it('continues to Results when nothing is needed, and shows no Results figures, charts or tables', () => {
    const plan = samplePlan();
    for (const year of plan.schoolYears) if (!year.costItems.length) year.costItems = [{ id: `c-${year.id}`, category: 'tuition', label: 'Tuition', amount: '1000.00', semester: 'annual' }];
    renderPlanner({ plan });
    const intro = screen.getByRole('region', { name: 'Plan your student loans' });
    expect(within(intro).getByRole('link', { name: /^Continue to / }).getAttribute('href')).toMatch(/^#(results|school|loans)$/);
    expect(intro.querySelector('table, svg, dl')).toBeNull();
    expect(intro.textContent).not.toMatch(/\$/);
  });
});

describe('guest mode (no sign-in required)', () => {
  it('opens the full planner with "Start planning" primary and the optional Google sign-in secondary', async () => {
    const user = userEvent.setup();
    const { onSignIn } = renderGuest();
    const intro = screen.getByRole('region', { name: 'Plan your student loans' });
    expect(intro.textContent).toMatch(/No account needed/);
    expect(intro.textContent).not.toMatch(/Sign in to create/);
    const disclaimer = document.querySelector('.disclaimer')!;
    expect(disclaimer.textContent).toMatch(/saved only on this browser and is not sent to DebtNav's server/);
    expect(disclaimer.textContent).not.toMatch(/saves it to your account/);
    const start = within(intro).getByRole('link', { name: 'Start planning' });
    expect(start.className).toMatch(/button-primary/);
    const signIn = within(intro).getByRole('button', { name: 'Sign in with Google to save across devices' }) as HTMLButtonElement;
    expect(signIn.className).not.toMatch(/button-primary/);
    expect(signIn.disabled).toBe(false);
    expect(within(intro).queryByRole('link', { name: /^Continue to / })).toBeNull();
    // All four destinations are available without signing in.
    for (const name of ['College Costs', 'Loan Amounts', 'Results']) expect(screen.getAllByRole('link', { name: new RegExp(name) }).length).toBeGreaterThan(0);
    await user.click(signIn);
    expect(onSignIn).toHaveBeenCalledTimes(1);
    await user.click(start);
    expect(['school', 'loans']).toContain(document.querySelector('.dashboard')?.getAttribute('data-dashboard'));
    const result = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map(violation => violation.id)).toEqual([]);
  });

  it('shows the browser save status, saves edits locally and restores them on the next visit', async () => {
    const storage = memoryStorage();
    renderGuest({ storage });
    const status = headerStatus();
    expect(status.textContent).toBe(BROWSER_SAVED);
    expect(document.querySelector('[data-save-state]')?.getAttribute('data-save-state')).toBe('saved');
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
    // Edit via the dismiss-disclaimer action (a document change), then reload.
    await userEvent.click(screen.getAllByRole('button', { name: 'I understand' })[0]);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
    expect(status.textContent).toBe(BROWSER_SAVED);
    cleanup();
    renderGuest({ storage });
    expect(JSON.parse(storage.data.get(STORAGE_KEY)!)).toBeTruthy();
  });

  it('passes a handle whose flushNow writes immediately and reports durable saving', async () => {
    const storage = memoryStorage(storedDocument(samplePlan()));
    const { onSignIn } = renderGuest({ storage });
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google to save across devices' }));
    const handle = onSignIn.mock.calls[0][0];
    expect(handle.document.plan.loans.map(loan => loan.id)).toEqual(['loan-a', 'loan-b']);
    expect(handle.exportJson().ok).toBe(true);
    let outcome: { saved: boolean } | undefined;
    act(() => { outcome = handle.flushNow(); });
    expect(outcome).toEqual({ saved: true });
  });

  it('when browser storage is unavailable it keeps working and says changes are not saved', async () => {
    const { onSignIn } = renderGuest({ storage: readOnlyStorage(), reason: 'notConfigured', signInAvailable: false });
    const status = headerStatus();
    expect(status.textContent).toBe(UNAVAILABLE_NOTICE);
    expect(status.textContent).not.toMatch(/Saved on this browser/);
    const notice = document.querySelector('[data-notice="notConfigured"]')!;
    expect(notice.textContent).toMatch(/Sign-in isn't set up on this server\./);
    expect(notice.textContent).toMatch(/your changes are not saved/);
    expect(notice.textContent).not.toMatch(/saved on this browser only/);
    const intro = screen.getByRole('region', { name: 'Plan your student loans' });
    expect(intro.textContent).toMatch(/isn't saving your changes/);
    const signIn = within(intro).getByRole('button', { name: 'Sign in with Google to save across devices' }) as HTMLButtonElement;
    expect(signIn.disabled).toBe(true);
    expect(signIn.getAttribute('aria-describedby')).toBe('guest-signin-unavailable');
    expect(document.getElementById('guest-signin-unavailable')?.textContent).toMatch(/isn't set up on this server/);
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it('a quota failure on save is reported (never "saved") and flushNow reports not saved', async () => {
    let fail = false;
    const base = memoryStorage();
    const storage: StorageLike = {
      getItem: base.getItem, removeItem: base.removeItem,
      setItem: (key, value) => { if (fail && key === STORAGE_KEY) throw new DOMException('full', 'QuotaExceededError'); base.setItem(key, value); },
    };
    const { onSignIn } = renderGuest({ storage });
    fail = true;
    await userEvent.click(screen.getAllByRole('button', { name: 'I understand' })[0]);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    const status = headerStatus();
    expect(status.textContent).toMatch(/could not be saved on this device/);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google to save across devices' }));
    let outcome: { saved: boolean } | undefined;
    act(() => { outcome = onSignIn.mock.calls[0][0].flushNow(); });
    expect(outcome).toEqual({ saved: false });
  });

  it('auth server unreachable: non-blocking notice with retry, sign-in disabled with an explanation', async () => {
    const onRetry = vi.fn();
    renderGuest({ reason: 'authUnavailable', signInAvailable: false, errorMessage: 'Timed out.', onRetry });
    const notice = document.querySelector('[data-notice="authUnavailable"]')!;
    expect(notice.textContent).toMatch(/can't reach its server right now\. Timed out\. You can keep planning\. Your plan is saved on this browser only\./);
    await userEvent.click(within(notice as HTMLElement).getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Plan your student loans' })).toBeTruthy();
  });

  it('account plan unavailable: says the account plan was not changed and offers a retry', async () => {
    const onRetry = vi.fn();
    renderGuest({ reason: 'accountUnavailable', signInAvailable: false, onRetry });
    const notice = document.querySelector('[data-notice="accountUnavailable"]')!;
    expect(notice.textContent).toMatch(/account plan was not changed/);
    await userEvent.click(within(notice as HTMLElement).getByRole('button', { name: 'Try loading my account plan again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('guest account menu: data, undo history, disclaimer and sign-in; no sign out', async () => {
    const user = userEvent.setup();
    const { onSignIn } = renderGuest({ notice: <SignInNotice kind="cancelled" /> });
    expect(document.querySelector('[data-notice="cancelled"]')?.textContent).toMatch(/Your plan on this browser was not changed\./);
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: /^Account/ }));
    for (const name of ['Your data', 'Undo history', 'About these estimates', 'Sign in with Google']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(screen.getByText('Not signed in (guest)')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('Your data for guests: browser-only wording, JSON export/import, Excel needs an account (no upload control)', async () => {
    const user = userEvent.setup();
    renderGuest();
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: /^Account/ }));
    await user.click(screen.getByRole('button', { name: 'Your data' }));
    const dialog = screen.getByRole('dialog', { name: 'Your data' });
    expect(dialog.textContent).toMatch(/saved on this browser as you edit\. It is not sent to DebtNav's servers/);
    expect(within(dialog).getByRole('button', { name: 'Export plan (JSON)' })).toBeTruthy();
    expect(within(dialog).getByLabelText('Import plan (JSON)')).toBeTruthy();
    expect(dialog.textContent).toMatch(/Excel needs an account/);
    expect(within(dialog).queryByLabelText('Import Excel file')).toBeNull();
    expect(dialog.querySelector('input[type="file"][accept*=".xlsx"]')).toBeNull();
  });

  it('guest mode makes no network requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderGuest();
    await userEvent.click(screen.getByRole('link', { name: 'Start planning' }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('auth pieces (presentational)', () => {
  it('a busy sign-in button is disabled and says so', () => {
    render(<SignInButton onSignIn={() => {}} busy />);
    const button = screen.getByRole('button', { name: 'Opening Google sign-in…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it.each([
    ['cancelled', /Sign-in was cancelled.*Your plan on this browser was not changed\./, 'status'],
    ['failed', /Sign-in didn't work.*Your plan on this browser was not changed\./, 'alert'],
    ['expired', /Your session ended/, 'status'],
    ['deleted', /Your DebtNav data was deleted/, 'status'],
    ['signedOut', /^You are signed out\. Your account plan stays in your account; this browser now shows your guest plan\.$/, 'status'],
  ] as const)('sign-in notice "%s"', async (kind, text, role) => {
    const onDismiss = vi.fn();
    render(<SignInNotice kind={kind} onDismiss={onDismiss} />);
    expect(screen.getByRole(role).querySelector('p')!.textContent).toMatch(text);
    expect(document.querySelector(`[data-notice="${kind}"]`)).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('missing credentials: non-blocking notice with setup steps, never a fake sign-in', () => {
    render(<AuthNotConfigured />);
    expect(screen.getByRole('status').textContent).toMatch(/^Sign-in isn't set up on this server\. Your plan is saved on this browser only\./);
    expect(screen.getByText(/docs\/BACKEND.md/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
  });

  it('signed-out reason adds no extra notice', () => {
    const { container } = render(<GuestModeNotice reason="signedOut" storageWorks />);
    expect(container.textContent).toBe('');
  });

  it('server errors offer a retry', async () => {
    const onRetry = vi.fn();
    render(<AuthError message="Timed out." onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toMatch(/can't reach its server right now.*Timed out/);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('PlannerApp shows the account menu (email, data, undo history, disclaimer, sign out) when an account is passed', async () => {
    const onSignOut = vi.fn();
    const { default: PlannerApp } = await import('../PlannerApp');
    const { usePlannerDocument } = await import('../../state/usePlannerDocument');
    const storage = memoryStorage();
    function Harness() { return <PlannerApp store={usePlannerDocument({ storage, debounceMs: 0 })} account={{ email: 'a@b.example', onSignOut }} devicePlanPrompt={<p>device prompt slot</p>} />; }
    window.scrollTo = () => {};
    render(<Harness />);
    expect(screen.getByText('device prompt slot')).toBeTruthy();
    const user = userEvent.setup();
    const menuButton = within(screen.getByRole('banner')).getByRole('button', { name: /^Account/ });
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    await user.click(menuButton);
    expect(menuButton.getAttribute('aria-expanded')).toBe('true');
    expect(within(screen.getByRole('banner')).getByText('a@b.example')).toBeTruthy();
    for (const name of ['Your data', 'Undo history', 'About these estimates', 'Sign out']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).toBeNull();
    // Escape closes the menu and returns focus to its button.
    await user.keyboard('{Escape}');
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menuButton);
    await user.click(menuButton);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('the account menu opens Your data in a dialog; without an account it has no Sign out', async () => {
    const user = userEvent.setup();
    renderPlanner({ plan: samplePlan() });
    await user.click(screen.getByRole('button', { name: /^Account/ }));
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Your data' }));
    const dialog = screen.getByRole('dialog', { name: 'Your data' });
    expect(within(dialog).getByRole('button', { name: 'Export plan (JSON)' })).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('Your data');
    await user.click(within(dialog).getByRole('button', { name: /^Close/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
