// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { STORAGE_KEY, importDocument } from './data/storage';

beforeEach(() => { localStorage.clear(); window.history.replaceState(null, '', '/'); window.scrollTo = () => {}; });
afterEach(() => cleanup());

it('renders an editable planner (no read-only preview) and saves edits to browser storage', async () => {
  const user = userEvent.setup();
  const view = render(<App />);
  expect(screen.getByRole('heading', { level: 1, name: 'DebtNav' })).toBeTruthy();
  await user.click(screen.getByRole('link', { name: 'Income & Earnings' }));
  const budget = screen.getByLabelText('Monthly amount available for loan payments') as HTMLInputElement;
  await user.clear(budget);
  await user.type(budget, '450');
  await new Promise(resolve => setTimeout(resolve, 400));
  const saved = importDocument(localStorage.getItem(STORAGE_KEY)!);
  expect(saved.ok && saved.value.plan.postGradIncome.monthlyDebtBudget).toBe('450.00');
  view.unmount();
  render(<App />);
  expect((screen.getByLabelText('Monthly amount available for loan payments') as HTMLInputElement).value).toBe('450.00');
});
