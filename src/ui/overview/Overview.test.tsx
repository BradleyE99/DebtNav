/// @vitest-environment jsdom
/** Introduction (signed-in tab) and the public signed-out page (US-1201), plus the header account menu. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { renderPlanner, samplePlan } from '../testing/renderPlanner';
import { createDefaultPlan } from '../../engine/planner';
import {
  AuthError, AuthNotConfigured, DevicePlanPrompt, PublicOverview, SignInButton, SignInNotice,
} from '../auth';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

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

describe('public signed-out page and auth pieces (presentational)', () => {
  it('renders the same introduction without a PlannerStore, with the sign-in slot and no destination links', async () => {
    const onSignIn = vi.fn();
    render(<PublicOverview signIn={<SignInButton onSignIn={onSignIn} />} notice={<SignInNotice kind="cancelled" />} />);
    expect(screen.getByRole('heading', { level: 1, name: 'DebtNav' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Plan your student loans' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'How much do I need to borrow?' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'When will I be debt-free?' })).toBeTruthy();
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

  it('PlannerApp shows the account menu (email, data, undo history, disclaimer, sign out) when an account is passed', async () => {
    const onSignOut = vi.fn();
    const { default: PlannerApp } = await import('../PlannerApp');
    const { usePlannerDocument } = await import('../../state/usePlannerDocument');
    const { memoryStorage } = await import('../testing/renderPlanner');
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
