// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { STORAGE_KEY, importDocument } from './data/storage';

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

it('renders an editable planner (no read-only preview) and saves edits to browser storage', async () => {
  const user = userEvent.setup();
  const view = render(<App />);
  expect(screen.getByRole('heading', { level: 1, name: 'DebtNav' })).toBeTruthy();
  const budget = screen.getByLabelText('Monthly amount for all loans') as HTMLInputElement;
  await user.clear(budget);
  await user.type(budget, '450');
  await new Promise(resolve => setTimeout(resolve, 400));
  const saved = importDocument(localStorage.getItem(STORAGE_KEY)!);
  expect(saved.ok && saved.value.plan.postGradIncome.monthlyDebtBudget).toBe('450.00');
  view.unmount();
  render(<App />);
  expect((screen.getByLabelText('Monthly amount for all loans') as HTMLInputElement).value).toBe('450.00');
});
