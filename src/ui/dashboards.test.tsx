// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { navigateTo, renderPlanner, samplePlan } from './testing/renderPlanner';
import { NAV_ITEMS } from './nav/navItems';
import { revealField } from './reveal';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

it('mounts only the chosen destination; the Introduction continues to the next destination', async () => {
  renderPlanner({ plan: samplePlan() });
  for (const item of NAV_ITEMS) {
    navigateTo(item.id);
    expect(document.querySelector('.dashboard')?.getAttribute('data-dashboard')).toBe(item.id);
    for (const other of NAV_ITEMS.filter(other => other.id !== item.id)) expect(document.getElementById(other.id)).toBeNull();
    expect(screen.getByRole('link', { name: item.label }).getAttribute('aria-current')).toBe('page');
  }
  navigateTo('overview');
  await userEvent.click(screen.getByRole('link', { name: /^Continue to / }));
  expect(document.querySelector('.dashboard')?.getAttribute('data-dashboard')).not.toBe('overview');
});

it('work while in school: reuses saved jobs, applies the share for school, and keeps salary separate from the monthly payment', async () => {
  const plan = samplePlan();
  const year = plan.schoolYears[1];
  year.resources = [{ id: 'job-existing', type: 'job', label: 'Weekend work', amount: '1000.00', incomeMode: 'hourly', hourlyWage: '20.00', hoursPerWeek: '10', weeksWorked: '40', unavailablePercent: '50' }];
  const view = renderPlanner({ plan });
  act(() => { revealField('schoolYears.' + year.id + '.resources.job-existing.hourlyWage'); });
  await waitFor(() => expect(document.activeElement?.id).toBe('schoolYears.' + year.id + '.resources.job-existing.hourlyWage'));
  expect(document.querySelector('.dashboard')?.getAttribute('data-dashboard')).toBe('school');
  expect((screen.getByLabelText('School year') as HTMLSelectElement).value).toBe(year.id);
  expect(screen.getByLabelText('% for school')).toHaveProperty('value', '50');
  const work = () => document.querySelector('.income-job-summary')?.textContent;
  expect(work()).toBe('$8,000.00 / year · $4,000.00 for school');
  const user = userEvent.setup();
  const available = screen.getByLabelText('% for school');
  await user.clear(available);
  await user.type(available, '75');
  expect(view.plan().schoolYears[1].resources[0].unavailablePercent).toBe('25');
  expect(work()).toBe('$8,000.00 / year · $6,000.00 for school');
  // US-501: the salary is edited in Results only; it stays separate from the monthly payment.
  expect(screen.queryByLabelText(/salary/i)).toBeNull();
  const budget = view.plan().postGradIncome.monthlyDebtBudget;
  navigateTo('repayment');
  const salary = screen.getByLabelText('Salary (before tax)');
  await user.clear(salary);
  await user.type(salary, '80000');
  expect(view.plan().postGradIncome.annualSalary).toBe('80000.00');
  expect(view.plan().postGradIncome.monthlyDebtBudget).toBe(budget);
  navigateTo('school', true);
  // Jobs are not offered as a grant/savings type: work has its own section.
  expect(document.querySelector('option[value="job"]')).toBeNull();
  expect(view.plan().schoolYears[1].resources[0].hourlyWage).toBe('20.00');
});

it('#income bookmarks land on College Costs with the work section reachable', async () => {
  window.history.replaceState(null, '', '/#income');
  renderPlanner({ plan: samplePlan() });
  await waitFor(() => expect(document.activeElement?.id).toBe('income-add-earnings'));
  expect(window.location.hash).toBe('#school');
  expect((document.activeElement as HTMLElement).closest('details')?.open).toBe(true);
});

it('reveals a loan in another destination and expands its card before focus', async () => {
  renderPlanner({ plan: samplePlan() });
  act(() => { revealField('loans.loan-b.principal'); });
  await waitFor(() => expect(document.activeElement?.id).toBe('loans.loan-b.principal'));
  const heading = document.getElementById('loans.loan-b-heading')!;
  expect(within(heading).getByRole('button').getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById('overview')).toBeNull();
  expect(window.location.hash).toBe('#loans');
});

it('reveals a repayment field inside its collapsed Results section', async () => {
  renderPlanner({ plan: samplePlan() });
  act(() => { revealField('repayment.voluntaryStart.months'); });
  await waitFor(() => expect(document.activeElement?.id).toBe('repayment.voluntaryStart.months'));
  expect(window.location.hash).toBe('#results');
  expect((document.getElementById('results-start') as HTMLDetailsElement).open).toBe(true);
});
