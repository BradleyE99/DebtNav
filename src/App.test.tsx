// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createFakeApi } from './state/fakeApi';
import { STORAGE_KEY, exportDocument } from './data/storage';
import { createDefaultPlan } from './engine/planner';

beforeEach(() => { localStorage.clear(); window.history.replaceState(null, '', '/'); window.scrollTo = () => {}; });
afterEach(() => cleanup());

it('signed out: shows the public Overview with Google sign-in and no planner', async () => {
  const { api } = createFakeApi({ user: null });
  render(<App client={api} />);
  expect(await screen.findByRole('button', { name: /sign in with google/i })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Loans' })).toBeNull();
});

it('missing OIDC credentials show the setup state instead of a fake sign-in', async () => {
  const { api } = createFakeApi({ configured: false });
  render(<App client={api} />);
  await waitFor(() => expect(document.body.textContent).toMatch(/BACKEND\.md|not (yet )?configured|set up/i));
  expect(screen.queryByRole('button', { name: /sign in with google/i })).toBeNull();
});

it('a cancelled sign-in returns to the Overview with a notice and a clean address bar', async () => {
  window.history.replaceState(null, '', '/?authError=cancelled');
  const { api } = createFakeApi({ user: null });
  render(<App client={api} />);
  expect(await screen.findByText(/cancelled/i)).toBeTruthy();
  expect(window.location.search).toBe('');
});

it('signed in: creates the plan on the server, saves edits there, and restores them on the next visit', async () => {
  const user = userEvent.setup();
  const { api, server } = createFakeApi();
  const view = render(<App client={api} />);
  expect(await screen.findByRole('heading', { level: 1, name: 'DebtNav' })).toBeTruthy();
  await waitFor(() => expect(server.revision).toBe(1));
  await user.click(screen.getAllByRole('link', { name: 'Repayment Plan' })[0]);
  const budget = await screen.findByLabelText(/^Monthly debt budget/) as HTMLInputElement;
  await user.clear(budget);
  await user.type(budget, '450');
  await waitFor(() => expect(server.document?.plan.postGradIncome.monthlyDebtBudget).toBe('450.00'), { timeout: 4000 });
  // Nothing financial is written to the old device key.
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  view.unmount();
  render(<App client={api} />);
  await screen.findByRole('heading', { level: 1, name: 'DebtNav' });
  await user.click(screen.getAllByRole('link', { name: 'Repayment Plan' })[0]);
  expect(((await screen.findByLabelText(/^Monthly debt budget/)) as HTMLInputElement).value).toBe('450.00');
});

it('a plan stored on this device before accounts is offered, never attached automatically', async () => {
  const device = createDefaultPlan();
  device.postGradIncome = { ...device.postGradIncome, annualSalary: '12345.00' };
  localStorage.setItem(STORAGE_KEY, exportDocument({ plan: device, disclaimerDismissed: true }));
  const { api, server } = createFakeApi();
  render(<App client={api} />);
  await screen.findByRole('heading', { level: 1, name: 'DebtNav' });
  await waitFor(() => expect(server.revision).toBe(1));
  expect(server.document?.plan.postGradIncome.annualSalary).not.toBe('12345.00');
  const use = await screen.findByRole('button', { name: /use (my|this) device plan|use device plan|use it/i });
  await userEvent.setup().click(use);
  await waitFor(() => expect(server.document?.plan.postGradIncome.annualSalary).toBe('12345.00'), { timeout: 4000 });
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
});
