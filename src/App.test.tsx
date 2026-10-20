// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import App from './App';
import { createFakeApi } from './state/fakeApi';
import { exportDocument, importDocument } from './data/storage';
import { createDefaultPlan } from './engine/planner';
import type { PlannerDocument } from './engine/planner-contracts';
import { GUEST_PLAN_KEY, accountCacheKey, guestChoiceKey } from './state/persistence';

beforeEach(() => { localStorage.clear(); window.history.replaceState(null, '', '/'); window.scrollTo = () => {}; });
afterEach(() => cleanup());

const PLAN_CALLS = /^(loadPlan|savePlan|importCommit|deleteAccountData)/;

function withSalary(salary: string): PlannerDocument {
  const plan = createDefaultPlan();
  plan.postGradIncome = { ...plan.postGradIncome, annualSalary: salary };
  return { plan, disclaimerDismissed: true };
}
const storedGuestSalary = (): string | null => {
  const raw = localStorage.getItem(GUEST_PLAN_KEY);
  const parsed = raw ? importDocument(raw) : null;
  return parsed?.ok ? parsed.value.plan.postGradIncome.annualSalary : null;
};

describe('guest mode (no sign-in required)', () => {
  it('signed out: the full planner is available, with "Start planning" and an optional Google sign-in', async () => {
    const { api, server } = createFakeApi({ user: null });
    render(<App client={api} />);
    expect(await screen.findByRole('link', { name: /start planning/i })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /sign in with google/i }).length).toBeGreaterThan(0);
    for (const page of ['College Costs', 'Loan', 'Results']) expect(screen.getAllByRole('link', { name: new RegExp(page, 'i') }).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/sign in to create your plan/i);
    expect(server.calls.filter(call => PLAN_CALLS.test(call))).toEqual([]);
  });

  it('guest edits are saved on this browser and never sent to the server', async () => {
    const user = userEvent.setup();
    const { api, server } = createFakeApi({ user: null });
    render(<App client={api} />);
    await screen.findByRole('link', { name: /start planning/i });
    await user.click(screen.getAllByRole('link', { name: /results/i })[0]);
    const budget = await screen.findByLabelText('Monthly payment') as HTMLInputElement;
    await user.clear(budget);
    await user.type(budget, '450');
    await waitFor(() => expect(localStorage.getItem(GUEST_PLAN_KEY)).toContain('450.00'), { timeout: 4000 });
    expect(await screen.findByText(/Saved on this browser\. Sign in to access your plan on other devices\./)).toBeTruthy();
    expect(server.calls.filter(call => PLAN_CALLS.test(call))).toEqual([]);
  });

  it('sign-in not configured: the planner still works and no fake sign-in is offered', async () => {
    const { api, server } = createFakeApi({ configured: false, user: null });
    render(<App client={api} />);
    await waitFor(() => expect(document.body.textContent).toMatch(/isn't set up|not (yet )?configured|set up/i));
    expect(screen.getAllByRole('link', { name: /loan/i }).length).toBeGreaterThan(0);
    for (const button of screen.queryAllByRole('button', { name: /sign in with google/i })) expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(server.calls.filter(call => PLAN_CALLS.test(call))).toEqual([]);
  });

  it('server unreachable: the planner still works on this browser', async () => {
    const { api, server } = createFakeApi({ user: null });
    server.offline = true;
    render(<App client={api} />);
    await waitFor(() => expect(document.body.textContent).toMatch(/could not reach/i));
    expect(screen.getAllByRole('link', { name: /results/i }).length).toBeGreaterThan(0);
  });

  it('a cancelled sign-in returns to the guest plan unchanged, with a notice and a clean address bar', async () => {
    localStorage.setItem(GUEST_PLAN_KEY, exportDocument(withSalary('12345.00')));
    window.history.replaceState(null, '', '/?authError=cancelled');
    const { api } = createFakeApi({ user: null });
    render(<App client={api} />);
    expect(await screen.findByText(/cancelled/i)).toBeTruthy();
    expect(window.location.search).toBe('');
    expect(storedGuestSalary()).toBe('12345.00');
  });

  it('a failed sign-in keeps the guest plan', async () => {
    localStorage.setItem(GUEST_PLAN_KEY, exportDocument(withSalary('12345.00')));
    window.history.replaceState(null, '', '/?authError=failed');
    const { api } = createFakeApi({ user: null });
    render(<App client={api} />);
    expect(await screen.findByText(/not changed/i)).toBeTruthy();
    expect(storedGuestSalary()).toBe('12345.00');
  });

  it('when the guest plan cannot be saved here, sign-in first warns and offers export; Cancel stays put', async () => {
    const user = userEvent.setup();
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem() { throw new DOMException('full', 'QuotaExceededError'); };
    try {
      const { api } = createFakeApi({ user: null });
      render(<App client={api} />);
      await screen.findByRole('link', { name: /start planning/i });
      await user.click(screen.getAllByRole('button', { name: /sign in with google/i })[0]);
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog.textContent).toMatch(/it will be lost when you leave for Google sign-in/);
      expect(within(dialog).getByRole('button', { name: 'Export plan' })).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: 'Sign in anyway' })).toBeTruthy();
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      // The planner stays fully usable after cancelling.
      await user.click(screen.getAllByRole('link', { name: /results/i })[0]);
      expect(await screen.findByLabelText('Monthly payment')).toBeTruthy();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe('signed in', () => {
  it('without a guest plan: creates the account plan, saves edits there, and restores them on the next visit', async () => {
    const user = userEvent.setup();
    const { api, server } = createFakeApi();
    const view = render(<App client={api} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'DebtNav' })).toBeTruthy();
    await waitFor(() => expect(server.revision).toBe(1));
    await user.click(screen.getAllByRole('link', { name: /results/i })[0]);
    const budget = await screen.findByLabelText('Monthly payment') as HTMLInputElement;
    await user.clear(budget);
    await user.type(budget, '450');
    await waitFor(() => expect(server.document?.plan.postGradIncome.monthlyDebtBudget).toBe('450.00'), { timeout: 4000 });
    // Account data is never written to the guest key.
    expect(localStorage.getItem(GUEST_PLAN_KEY)).toBeNull();
    view.unmount();
    render(<App client={api} />);
    await screen.findByRole('heading', { level: 1, name: 'DebtNav' });
    await user.click(screen.getAllByRole('link', { name: /results/i })[0]);
    expect(((await screen.findByLabelText('Monthly payment')) as HTMLInputElement).value).toBe('450.00');
  });

  it('account without a plan: asks before copying; nothing is uploaded until "Save this plan to my account"', async () => {
    const user = userEvent.setup();
    localStorage.setItem(GUEST_PLAN_KEY, exportDocument(withSalary('12345.00')));
    const { api, server } = createFakeApi();
    render(<App client={api} />);
    const save = await screen.findByRole('button', { name: 'Save this plan to my account' });
    expect(screen.getByRole('button', { name: /Not now — keep it on this browser/ })).toBeTruthy();
    expect(server.calls.filter(call => call.startsWith('savePlan'))).toEqual([]);
    expect(server.document).toBeNull();
    await user.click(save);
    await screen.findByRole('heading', { level: 1, name: 'DebtNav' });
    await waitFor(() => expect(server.document?.plan.postGradIncome.annualSalary).toBe('12345.00'));
    expect(server.calls.filter(call => call.startsWith('savePlan'))).toEqual(['savePlan:null']);
    await waitFor(() => expect(localStorage.getItem(GUEST_PLAN_KEY)).toBeNull());
  });

  it('"Not now" opens a new account plan and keeps the guest plan on this browser', async () => {
    const user = userEvent.setup();
    localStorage.setItem(GUEST_PLAN_KEY, exportDocument(withSalary('12345.00')));
    const { api, server } = createFakeApi();
    render(<App client={api} />);
    await user.click(await screen.findByRole('button', { name: /Not now — keep it on this browser/ }));
    await screen.findByRole('heading', { level: 1, name: 'DebtNav' });
    await waitFor(() => expect(server.revision).toBe(1));
    expect(server.document?.plan.postGradIncome.annualSalary).not.toBe('12345.00');
    expect(storedGuestSalary()).toBe('12345.00');
    expect(localStorage.getItem(guestChoiceKey('user-1'))).not.toBeNull();
  });

  it('account with a plan: "Open my account plan" leaves both plans unchanged', async () => {
    const user = userEvent.setup();
    localStorage.setItem(GUEST_PLAN_KEY, exportDocument(withSalary('12345.00')));
    const { api, server } = createFakeApi({ document: withSalary('99999.00') });
    render(<App client={api} />);
    expect(await screen.findByText(/Your account already has a plan/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open my account plan' }));
    await screen.findByRole('heading', { level: 1, name: 'DebtNav' });
    expect(server.calls.filter(call => call.startsWith('savePlan'))).toEqual([]);
    expect(server.document?.plan.postGradIncome.annualSalary).toBe('99999.00');
    expect(storedGuestSalary()).toBe('12345.00');
  });

  it('account with a plan: replacing requires explicit confirmation, then saves against the shown revision', async () => {
    const user = userEvent.setup();
    localStorage.setItem(GUEST_PLAN_KEY, exportDocument(withSalary('12345.00')));
    const { api, server } = createFakeApi({ document: withSalary('99999.00') });
    render(<App client={api} />);
    await user.click(await screen.findByRole('button', { name: "Replace my account plan with this browser's plan…" }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Replace your account plan?' });
    expect(dialog.textContent).toMatch(/nothing is merged/i);
    // Cancelling changes nothing.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(server.calls.filter(call => call.startsWith('savePlan'))).toEqual([]);
    await user.click(screen.getByRole('button', { name: "Replace my account plan with this browser's plan…" }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Replace account plan' }));
    await screen.findByRole('heading', { level: 1, name: 'DebtNav' });
    expect(server.calls.filter(call => call.startsWith('savePlan'))).toEqual(['savePlan:1']);
    expect(server.document?.plan.postGradIncome.annualSalary).toBe('12345.00');
    await waitFor(() => expect(localStorage.getItem(GUEST_PLAN_KEY)).toBeNull());
  });

  it('unsynced account edits restored from this browser take priority over the guest offer', async () => {
    localStorage.setItem(GUEST_PLAN_KEY, exportDocument(withSalary('12345.00')));
    localStorage.setItem(accountCacheKey('user-1'), JSON.stringify({ document: withSalary('55555.00'), baseRevision: 1, at: '2026-10-16T12:00:00.000Z' }));
    const { api } = createFakeApi({ document: withSalary('99999.00') });
    render(<App client={api} />);
    await screen.findByRole('heading', { level: 1, name: 'DebtNav' });
    expect(screen.queryByRole('button', { name: 'Open my account plan' })).toBeNull();
    expect(storedGuestSalary()).toBe('12345.00');
  });

  it('a default (untouched) guest plan is not offered', async () => {
    localStorage.setItem(GUEST_PLAN_KEY, exportDocument({ plan: createDefaultPlan(), disclaimerDismissed: true }));
    const { api, server } = createFakeApi();
    render(<App client={api} />);
    await screen.findByRole('heading', { level: 1, name: 'DebtNav' });
    await waitFor(() => expect(server.revision).toBe(1));
    expect(screen.queryByRole('button', { name: 'Save this plan to my account' })).toBeNull();
  });

  it('sign-out returns to the untouched guest plan; the account plan is not copied into guest storage', async () => {
    const user = userEvent.setup();
    const guest = withSalary('12345.00');
    guest.plan.postGradIncome = { ...guest.plan.postGradIncome, monthlyDebtBudget: '111.00' };
    const account = withSalary('99999.00');
    account.plan.postGradIncome = { ...account.plan.postGradIncome, monthlyDebtBudget: '999.00' };
    localStorage.setItem(GUEST_PLAN_KEY, exportDocument(guest));
    const { api, server } = createFakeApi({ document: account });
    render(<App client={api} />);
    await user.click(await screen.findByRole('button', { name: 'Open my account plan' }));
    await user.click(screen.getAllByRole('link', { name: /results/i })[0]);
    expect(((await screen.findByLabelText('Monthly payment')) as HTMLInputElement).value).toBe('999.00');
    await user.click(document.querySelector<HTMLButtonElement>('.account-menu__button')!);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(server.calls).toContain('logout'));
    await user.click((await screen.findAllByRole('link', { name: /results/i }))[0]);
    await waitFor(async () => expect(((await screen.findByLabelText('Monthly payment')) as HTMLInputElement).value).toBe('111.00'));
    expect(document.body.textContent).not.toContain('999.00');
    expect(storedGuestSalary()).toBe('12345.00');
    expect(localStorage.getItem(accountCacheKey('user-1'))).toBeNull();
  });

  it('a different account never sees the previous account choice or plan', async () => {
    localStorage.setItem(GUEST_PLAN_KEY, exportDocument(withSalary('12345.00')));
    localStorage.setItem(guestChoiceKey('user-1'), 'handled-by-someone-else');
    const { api, server } = createFakeApi({ user: { id: 'user-2', email: 'bob@example.test' } });
    render(<App client={api} />);
    expect(await screen.findByRole('button', { name: 'Save this plan to my account' })).toBeTruthy();
    expect(server.calls.filter(call => call.startsWith('savePlan'))).toEqual([]);
  });

  it('works under React StrictMode (as in main.tsx): the simulated remount does not leave a dead account guard', async () => {
    const user = userEvent.setup();
    localStorage.setItem(GUEST_PLAN_KEY, exportDocument(withSalary('12345.00')));
    const { api, server } = createFakeApi();
    render(<StrictMode><App client={api} /></StrictMode>);
    await user.click(await screen.findByRole('button', { name: 'Save this plan to my account' }));
    await screen.findByRole('heading', { level: 1, name: 'DebtNav' });
    await waitFor(() => expect(server.document?.plan.postGradIncome.annualSalary).toBe('12345.00'));
    expect(server.calls.filter(call => call.startsWith('savePlan'))).toEqual(['savePlan:null']);
  });
});
