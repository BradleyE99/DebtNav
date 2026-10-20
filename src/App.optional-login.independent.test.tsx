// @vitest-environment jsdom
/**
 * Independent tester — optional Google sign-in at the App level with the in-memory fake API (no network).
 * Covers guest planning without login, consent before copying a guest plan, never overwriting an account plan
 * silently, sign-out isolation, and late/mismatched account requests.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createFakeApi } from './state/fakeApi';
import { STORAGE_KEY, exportDocument } from './data/storage';
import { createDefaultPlan } from './engine/planner';
import type { PlannerDocument } from './engine/planner-contracts';

const GUEST_SAVED = 'Saved on this browser. Sign in to access your plan on other devices.';

beforeEach(() => { localStorage.clear(); window.history.replaceState(null, '', '/'); window.scrollTo = () => {}; });
afterEach(() => cleanup());

function doc(budget: string, extra: (plan: PlannerDocument['plan']) => void = () => {}): PlannerDocument {
  const plan = createDefaultPlan();
  plan.postGradIncome = { ...plan.postGradIncome, monthlyDebtBudget: budget };
  extra(plan);
  return { plan, disclaimerDismissed: true };
}
const storageText = () => Object.keys(localStorage).map(key => `${key}=${localStorage.getItem(key)}`).join('\n');
const budgetOf = (document: PlannerDocument | null) => document?.plan.postGradIncome.monthlyDebtBudget;

async function dismissDisclaimer(user: ReturnType<typeof userEvent.setup>) {
  const understand = screen.queryByRole('button', { name: 'I understand' });
  if (understand) await user.click(understand);
}
async function openResults(user: ReturnType<typeof userEvent.setup>) {
  await dismissDisclaimer(user);
  await user.click(await screen.findByRole('link', { name: 'Results' }));
  return await screen.findByLabelText('Monthly payment') as HTMLInputElement;
}
async function typeBudget(user: ReturnType<typeof userEvent.setup>, value: string) {
  const field = await openResults(user);
  await user.clear(field);
  await user.type(field, value);
  await user.tab();
  return field;
}

describe('guest mode', () => {
  it('signed out: the full planner works, saves on this browser, and makes no plan requests', async () => {
    const user = userEvent.setup();
    const { api, server } = createFakeApi({ user: null });
    render(<App client={api} />);
    expect(await screen.findByRole('link', { name: 'College Costs' }).catch(() => screen.findByRole('link', { name: /Costs/ }))).toBeTruthy();
    expect(screen.queryByText(/Sign in to create your plan/)).toBeNull();
    await typeBudget(user, '487.31');
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY) ?? '').toContain('487.31'));
    expect(await screen.findByText(GUEST_SAVED, { exact: false })).toBeTruthy();
    expect(server.calls.filter(call => !['authConfig', 'me'].includes(call))).toEqual([]);
  });

  it('sign-in not configured: the planner is still usable and never offers a fake sign-in', async () => {
    const user = userEvent.setup();
    const { api, server } = createFakeApi({ user: null, configured: false });
    render(<App client={api} />);
    const field = await typeBudget(user, '222');
    expect(field.value).toBe('222.00');
    expect(screen.queryByRole('button', { name: /Sign in with Google to save across devices/ })?.hasAttribute('disabled') ?? true).toBe(true);
    expect(server.calls.filter(call => !['authConfig', 'me'].includes(call))).toEqual([]);
  });

  it('server unreachable: the planner is usable as a guest', async () => {
    const user = userEvent.setup();
    const { api, server } = createFakeApi({ user: null });
    server.offline = true;
    render(<App client={api} />);
    const field = await typeBudget(user, '333');
    expect(field.value).toBe('333.00');
    expect(server.calls.filter(call => call.startsWith('savePlan') || call === 'loadPlan')).toEqual([]);
  });
});

describe('guest-to-account transition', () => {
  it('new account: nothing is saved before the choice; Not now keeps the guest draft and uploads nothing', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, exportDocument(doc('487.31')));
    const guestBefore = localStorage.getItem(STORAGE_KEY);
    const { api, server } = createFakeApi();
    render(<App client={api} />);
    const notNow = await screen.findByRole('button', { name: /^Not now/ });
    expect(screen.getByRole('button', { name: 'Save this plan to my account' })).toBeTruthy();
    expect(server.calls.filter(call => call.startsWith('savePlan'))).toEqual([]);
    await user.click(notNow);
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Not now/ })).toBeNull());
    await new Promise(resolve => setTimeout(resolve, 1200));
    expect(budgetOf(server.document)).not.toBe('487.31');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(guestBefore);
  });

  it('new account: Save this plan copies it once and removes the guest draft only after the server confirms', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, exportDocument(doc('487.31')));
    const { api, server } = createFakeApi();
    let release!: () => void;
    server.gate = new Promise(resolve => { release = resolve; });
    render(<App client={api} />);
    await user.click(await screen.findByRole('button', { name: 'Save this plan to my account' }));
    await waitFor(() => expect(server.calls.some(call => call.startsWith('savePlan'))).toBe(true));
    // Server has not answered yet: the guest draft must still be there.
    expect(localStorage.getItem(STORAGE_KEY) ?? '').toContain('487.31');
    server.gate = null;
    await act(async () => { release(); });
    await waitFor(() => expect(budgetOf(server.document)).toBe('487.31'));
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY) ?? '').not.toContain('487.31'));
    expect((await openResults(user)).value).toBe('487.31');
  });

  it('existing account plan: Open my account plan shows it and changes neither plan', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, exportDocument(doc('487.31')));
    const guestBefore = localStorage.getItem(STORAGE_KEY);
    const { api, server } = createFakeApi({ document: doc('555.55') });
    render(<App client={api} />);
    await user.click(await screen.findByRole('button', { name: 'Open my account plan' }));
    expect((await openResults(user)).value).toBe('555.55');
    await new Promise(resolve => setTimeout(resolve, 1200));
    expect(budgetOf(server.document)).toBe('555.55');
    expect(server.calls.filter(call => call.startsWith('savePlan'))).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(guestBefore);
  });

  it('existing account plan: Replace needs explicit confirmation, Cancel changes nothing, confirm replaces without merging', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, exportDocument(doc('487.31')));
    const accountDoc = doc('555.55', plan => {
      plan.loans = [{ id: 'acct1', name: 'Account-only loan', type: 'unsubsidized', principal: '7654.32', annualRate: '0.0653', disbursementDate: plan.settings.startDate, termMonths: 120 }] as typeof plan.loans;
    });
    const { api, server } = createFakeApi({ document: accountDoc });
    render(<App client={api} />);
    await user.click(await screen.findByRole('button', { name: /^Replace my account plan with this browser/ }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm.textContent).toContain('Replace your account plan?');
    expect(confirm.textContent).toMatch(/nothing is merged/i);
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(server.revision).toBe(1);
    expect(budgetOf(server.document)).toBe('555.55');
    await user.click(screen.getByRole('button', { name: /^Replace my account plan with this browser/ }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Replace account plan' }));
    await waitFor(() => expect(budgetOf(server.document)).toBe('487.31'));
    expect(server.revision).toBe(2);
    expect(server.calls).toContain('savePlan:1');
    expect(JSON.stringify(server.document)).not.toContain('Account-only loan');
  });

  it('replace against a plan changed elsewhere meanwhile is a conflict, never an overwrite', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, exportDocument(doc('487.31')));
    const { api, server } = createFakeApi({ document: doc('555.55') });
    render(<App client={api} />);
    await screen.findByRole('button', { name: /^Replace my account plan with this browser/ });
    server.external(doc('666.66'));
    await user.click(screen.getByRole('button', { name: /^Replace my account plan with this browser/ }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Replace account plan' }));
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(budgetOf(server.document)).toBe('666.66');
    expect(localStorage.getItem(STORAGE_KEY) ?? '').toContain('487.31');
  });

  it('an authentication result alone never uploads a guest plan (no draft-related save while the choice is open)', async () => {
    localStorage.setItem(STORAGE_KEY, exportDocument(doc('487.31')));
    const { api, server } = createFakeApi();
    render(<App client={api} />);
    await screen.findByRole('button', { name: 'Save this plan to my account' });
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(server.document).toBeNull();
    expect(server.calls.filter(call => call.startsWith('savePlan'))).toEqual([]);
  });
});

describe('sign-out and account isolation', () => {
  async function signOut(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /^Account/ }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
  }

  it('sign-out returns to the separate guest draft; account data is not shown or stored', async () => {
    const user = userEvent.setup();
    const guestDoc = exportDocument(doc('487.31'));
    localStorage.setItem(STORAGE_KEY, guestDoc);
    localStorage.setItem('debtnav.guestChoice.user-1', '1');
    const { api, server } = createFakeApi({ document: doc('555.55') });
    render(<App client={api} />);
    // If the choice is asked again, take the safe option.
    const open = await screen.findByRole('button', { name: 'Open my account plan' }).catch(() => null);
    if (open) await user.click(open);
    expect((await openResults(user)).value).toBe('555.55');
    await signOut(user);
    await waitFor(() => expect(document.querySelector('[data-notice="signedOut"]')).not.toBeNull());
    expect(server.calls).toContain('logout');
    expect((await openResults(user)).value).toBe('487.31');
    expect(document.body.textContent).not.toContain('555.55');
    expect(storageText()).not.toContain('555.55');
    expect(Object.keys(localStorage).filter(key => key.startsWith('debtnav.cache.'))).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(guestDoc);
  });

  it('a save still in flight when signing out cannot restore account data or caches', async () => {
    const user = userEvent.setup();
    const { api, server } = createFakeApi({ document: doc('555.55') });
    render(<App client={api} />);
    await typeBudget(user, '777.77');
    let release!: () => void;
    server.gate = new Promise(resolve => { release = resolve; });
    await waitFor(() => expect(server.calls.some(call => call.startsWith('savePlan'))).toBe(true), { timeout: 4000 }).catch(() => {});
    await signOut(user);
    // Unsaved (in-flight) changes: the user is asked first, possibly after the flush timeout.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign out anyway' }) ?? document.querySelector('[data-notice="signedOut"]')).not.toBeNull(), { timeout: 8000 });
    const anyway = screen.queryByRole('button', { name: 'Sign out anyway' });
    if (anyway) await user.click(anyway);
    await waitFor(() => expect(document.querySelector('[data-notice="signedOut"]')).not.toBeNull(), { timeout: 3000 });
    server.gate = null;
    await act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 1500)); });
    window.dispatchEvent(new Event('pagehide'));
    expect(document.querySelector('[data-notice="signedOut"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('777.77');
    expect(document.body.textContent).not.toContain('555.55');
    expect(storageText()).not.toContain('777.77');
    expect(storageText()).not.toContain('555.55');
  }, 20_000);

  it('another tab switched accounts: edits pinned to the old account are not saved to the new one', async () => {
    const user = userEvent.setup();
    const { api, server } = createFakeApi({ document: doc('555.55') });
    render(<App client={api} />);
    await openResults(user);
    await waitFor(() => expect(server.revision).toBe(1));
    server.user = { id: 'user-2', email: 'bob@example.test' };
    const before = server.revision;
    await typeBudget(user, '123.45').catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(server.revision).toBe(before);
    expect(budgetOf(server.document)).toBe('555.55');
    expect(document.body.textContent).not.toMatch(/Saved to your account\./);
  });
});
