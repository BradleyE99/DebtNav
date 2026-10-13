// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import * as engine from './engine/projection';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import M1Preview from './M1Preview';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('renders the complete standard combined and per-loan schedule', () => {
  render(<M1Preview />);
  expect(screen.getByText('Scheduled months:', { exact: false }).textContent).toContain('120');
  const table = screen.getByRole('table', { name: 'All projected months, combined and per loan' });
  expect(within(table).getAllByRole('row')).toHaveLength(241);
  expect(within(table).getAllByText('Combined')).toHaveLength(120);
  expect(within(table).getAllByRole('row').at(-1)?.textContent).toContain('$0.00');
  expect(screen.getByText(/Results are estimates, not financial advice/)).toBeTruthy();
});
it('switches accrual and paid-interest examples without a calculate button', async () => {
  const user = userEvent.setup(); render(<M1Preview />);
  await user.selectOptions(screen.getByLabelText('Review sample'), '1');
  expect(screen.getAllByText('$5,300.00').length).toBeGreaterThan(0);
  expect(screen.getByRole('table', { name: /Accrual, capitalization/ }).textContent).toContain('$300.00');
  await user.selectOptions(screen.getByLabelText('Review sample'), '2');
  const payments = screen.getByRole('table', { name: 'Monthly cash cost before repayment' });
  expect(within(payments).getAllByRole('row')).toHaveLength(13);
  expect(screen.getAllByText('$5,000.00').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: /calculate/i })).toBeNull();
});
it('shows warnings and withholds payoff totals for an underpayment', async () => {
  const user = userEvent.setup(); render(<M1Preview />);
  await user.selectOptions(screen.getByLabelText('Review sample'), '3');
  expect(screen.getByRole('alert').textContent).toContain('cannot be shown');
  expect(screen.getByText('Not projected')).toBeTruthy();
  expect(screen.getByText('Not available — projection incomplete')).toBeTruthy();
});
it('has no detectable accessibility violations for standard and warning samples', async () => {
  const user = userEvent.setup(); render(<main><h1>DebtNav</h1><M1Preview /></main>);
  const check = async () => expect((await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
  await check();
  await user.selectOptions(screen.getByLabelText('Review sample'), '3');
  await check();
});

it('shows field paths for rejected samples and omits stale projection output', async () => {
  vi.spyOn(engine, 'calculateProjection').mockReturnValueOnce({
    ok: false,
    errors: [{ path: 'loans[0].principal', code: 'INVALID_MONEY', message: 'Enter a valid non-negative amount.' }],
  });
  render(<main><h1>DebtNav</h1><M1Preview /></main>);
  expect(screen.getByRole('alert').textContent).toContain('loans[0].principal: Enter a valid non-negative amount.');
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText('Debt-free date')).toBeNull();
  expect((await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
});
it('shows the standard minimum and anchored repayment dates', () => {
  render(<M1Preview />);
  const loans = screen.getByRole('table', { name: /Accrual, capitalization/ });
  const cells = within(loans).getAllByRole('cell');
  expect(cells.at(-2)?.textContent).toBe('$340.64');
  expect(screen.getByText('2027-01-01').getAttribute('datetime')).toBe('2027-01-01');
  expect(screen.getAllByText('2027-02-01').some(element => element.getAttribute('datetime') === '2027-02-01')).toBe(true);
});
