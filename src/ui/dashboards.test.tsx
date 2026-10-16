// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { navigateTo, renderPlanner, samplePlan } from './testing/renderPlanner';
import { NAV_ITEMS } from './nav/navItems';
import { revealField } from './reveal';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

it('mounts only the chosen dashboard and opens income from the overview', async () => {
  renderPlanner({ plan: samplePlan() });
  for (const item of NAV_ITEMS) {
    navigateTo(item.id);
    expect(document.querySelector('.dashboard')?.getAttribute('data-dashboard')).toBe(item.id);
    for (const other of NAV_ITEMS.filter(other => other.id !== item.id)) expect(document.getElementById(other.id)).toBeNull();
    expect(screen.getByRole('link', { name: item.label }).getAttribute('aria-current')).toBe('page');
  }
  navigateTo('overview');
  await userEvent.click(screen.getByRole('button', { name: 'Edit income' }));
  expect(screen.getByRole('heading', { name: 'Income & Earnings' })).toBeTruthy();
});

it('reuses saved jobs, applies the available share, and keeps salary separate from the loan budget', async () => {
  const plan = samplePlan();
  const year = plan.schoolYears[1];
  year.resources = [{ id: 'job-existing', type: 'job', label: 'Weekend work', amount: '1000.00', incomeMode: 'hourly', hourlyWage: '20.00', hoursPerWeek: '10', weeksWorked: '40', unavailablePercent: '50' }];
  const view = renderPlanner({ plan });
  act(() => { revealField('schoolYears.' + year.id + '.resources.job-existing.hourlyWage'); });
  await waitFor(() => expect(document.activeElement?.id).toBe('schoolYears.' + year.id + '.resources.job-existing.hourlyWage'));
  expect((screen.getByLabelText('School year') as HTMLSelectElement).value).toBe(year.id);
  expect(screen.getByLabelText('Percentage available to pay school costs')).toHaveProperty('value', '50');
  expect(document.querySelector('.income-totals')?.textContent).toContain('Available for school$4,000.00');
  const user = userEvent.setup();
  const available = screen.getByLabelText('Percentage available to pay school costs');
  await user.clear(available);
  await user.type(available, '75');
  expect(view.plan().schoolYears[1].resources[0].unavailablePercent).toBe('25');
  expect(document.querySelector('.income-totals')?.textContent).toContain('Available for school$6,000.00');
  const budget = view.plan().postGradIncome.monthlyDebtBudget;
  const salary = screen.getByLabelText('Expected annual salary');
  await user.clear(salary);
  await user.type(salary, '80000');
  expect(view.plan().postGradIncome.monthlyDebtBudget).toBe(budget);
  navigateTo('school');
  expect(document.querySelector('option[value="job"]')).toBeNull();
  navigateTo('income');
  expect(view.plan().schoolYears[1].resources[0].hourlyWage).toBe('20.00');
  expect(screen.getByLabelText('Expected annual salary')).toHaveProperty('value', '80,000.00');
});

it('reveals a loan in another dashboard and expands its card before focus', async () => {
  renderPlanner({ plan: samplePlan() });
  act(() => { revealField('loans.loan-b.principal'); });
  await waitFor(() => expect(document.activeElement?.id).toBe('loans.loan-b.principal'));
  const heading = document.getElementById('loans.loan-b-heading')!;
  expect(within(heading).getByRole('button').getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById('overview')).toBeNull();
  expect(window.location.hash).toBe('#loans');
});
