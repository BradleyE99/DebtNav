// @vitest-environment jsdom
/** US-903 Overview as introduction + navigation hub; also the public signed-out page (US-1201). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { renderPlanner, samplePlan } from '../testing/renderPlanner';
import {
  AccountHeader, AuthError, AuthNotConfigured, DevicePlanPrompt, PublicOverview, SignInButton, SignInNotice,
} from '../auth';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

const CARDS: [string, string, string][] = [
  ['Open Costs', 'school', 'School costs & resources'],
  ['Open How much I make', 'income', 'Income & Earnings'],
  ['Open Loans', 'loans', 'Your loans'],
  ['Open Repayment Plan', 'repayment', 'Repayment Plan'],
  ['Open Results', 'results', 'Your live results'],
];

describe('signed-in Overview', () => {
  it('introduces the two tasks and links to Loans, How much I make, Repayment Plan, Results and Costs', async () => {
    const user = userEvent.setup();
    renderPlanner({ plan: samplePlan() });
    const overview = screen.getByRole('region', { name: 'Overview' });
    expect(within(overview).getByRole('heading', { name: '1. Plan each year\'s borrowing' })).toBeTruthy();
    expect(within(overview).getByRole('heading', { name: '2. Plan repayment' })).toBeTruthy();
    for (const [name, id, heading] of CARDS) {
      await user.click(within(screen.getByRole('region', { name: 'Overview' })).getByRole('link', { name }));
      expect(window.location.hash).toBe(`#${id}`);
      expect(screen.getByRole('heading', { level: 2, name: heading })).toBeTruthy();
      await user.click(screen.getByRole('link', { name: 'Overview' }));
    }
  });

  it('does not duplicate Results charts or tables', () => {
    renderPlanner({ plan: samplePlan() });
    const overview = screen.getByRole('region', { name: 'Overview' });
    expect(overview.querySelector('table, svg.balance-chart, .chart')).toBeNull();
  });

  it('cards summarize what each dashboard holds', () => {
    renderPlanner({ plan: samplePlan() });
    const overview = screen.getByRole('region', { name: 'Overview' });
    expect(overview.textContent).toContain('2 loans · $25,000.00');
    expect(overview.textContent).toContain('Budget $600.00/mo');
  });
});

describe('public signed-out page and auth pieces (presentational)', () => {
  it('renders the same introduction without a PlannerStore, with the sign-in slot and no dashboard links', async () => {
    const onSignIn = vi.fn();
    render(<PublicOverview signIn={<SignInButton onSignIn={onSignIn} />} notice={<SignInNotice kind="cancelled" />} />);
    expect(screen.getByRole('heading', { level: 1, name: 'DebtNav' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Plan your student loans' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'What you can do after signing in' })).toBeTruthy();
    for (const title of ['Costs', 'How much I make', 'Loans', 'Repayment Plan', 'Results']) expect(screen.getByRole('heading', { level: 4, name: title })).toBeTruthy();
    expect(screen.queryAllByRole('link').filter(link => link.getAttribute('href')?.startsWith('#') && link.getAttribute('href') !== '#main')).toEqual([]);
    expect(screen.getByRole('status').textContent).toMatch(/Sign-in was cancelled/);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    const result = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map(violation => violation.id)).toEqual([]);
  });

  it('a busy sign-in button is disabled and says so', () => {
    render(<SignInButton onSignIn={() => {}} busy />);
    const button = screen.getByRole('button', { name: 'Opening Google sign-in…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it.each([
    ['failed', /Sign-in didn't work/, 'alert'],
    ['expired', /Your session ended/, 'status'],
    ['deleted', /Your DebtNav data was deleted/, 'status'],
    ['signedOut', /Signing out keeps your saved plan/, 'status'],
  ] as const)('sign-in notice "%s"', async (kind, text, role) => {
    const onDismiss = vi.fn();
    render(<SignInNotice kind={kind} onDismiss={onDismiss} />);
    expect(screen.getByRole(role).textContent).toMatch(text);
    expect(document.querySelector(`[data-notice="${kind}"]`)).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('missing credentials show a setup screen, never a fake sign-in', () => {
    render(<PublicOverview signIn={<AuthNotConfigured />} />);
    expect(screen.getByRole('heading', { name: "Sign-in isn't set up yet" })).toBeTruthy();
    expect(screen.getByText(/docs\/BACKEND.md/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
  });

  it('server errors offer a retry', async () => {
    const onRetry = vi.fn();
    render(<AuthError message="Timed out." onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toMatch(/can't reach its server right now.*Timed out/);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('the signed-in header shows the email and signs out', async () => {
    const onSignOut = vi.fn();
    render(<AccountHeader email="student@example.com" onSignOut={onSignOut} />);
    expect(screen.getByText('student@example.com')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('PlannerApp shows the account header when an account is passed', async () => {
    const onSignOut = vi.fn();
    const { default: PlannerApp } = await import('../PlannerApp');
    const { usePlannerDocument } = await import('../../state/usePlannerDocument');
    const { memoryStorage } = await import('../testing/renderPlanner');
    const storage = memoryStorage();
    function Harness() { return <PlannerApp store={usePlannerDocument({ storage, debounceMs: 0 })} account={{ email: 'a@b.example', onSignOut }} devicePlanPrompt={<p>device prompt slot</p>} />; }
    window.scrollTo = () => {};
    render(<Harness />);
    expect(within(screen.getByRole('banner')).getByText('a@b.example')).toBeTruthy();
    expect(screen.getByText('device prompt slot')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('device plan prompt: explicit use or keep, focus on its heading, busy and error states', async () => {
    const onUse = vi.fn();
    const onDismiss = vi.fn();
    const { rerender } = render(<DevicePlanPrompt summary={{ loans: 2, schoolYears: 4, savedAt: '2026-05-01T12:00:00.000Z' }} onUse={onUse} onDismiss={onDismiss} />);
    expect(document.activeElement?.textContent).toBe('A plan was found in this browser');
    expect(screen.getByText(/4 school years and 2 loans/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Use my device plan' }));
    expect(onUse).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Keep my account plan' }));
    expect(onDismiss).toHaveBeenCalled();
    rerender(<DevicePlanPrompt summary={{ loans: 1, schoolYears: 1, savedAt: null }} onUse={onUse} onDismiss={onDismiss} busy error="Could not copy." />);
    expect((screen.getByRole('button', { name: 'Using device plan…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe('Could not copy.');
  });
});
