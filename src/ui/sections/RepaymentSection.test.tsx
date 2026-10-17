// @vitest-environment jsdom
/** Repayment Plan dashboard: US-501 earnings & budget, US-506 payoff target, US-507 payment start and timing. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlannerPlan } from '../../engine/planner-contracts';
import { navigateTo, renderPlanner, samplePlan } from '../testing/renderPlanner';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

const byId = (id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`No element with id ${id}`);
  return element as HTMLInputElement;
};

/** $12,000 at 0% (a private loan whose lender requires payments 6 months after graduation). */
function zeroRatePlan(edit: (p: PlannerPlan) => void = () => {}): PlannerPlan {
  const base = samplePlan();
  const plan: PlannerPlan = {
    ...base,
    loans: [{ id: 'zero', name: 'Zero loan', type: 'private', principal: '12000.00', annualRate: '0', disbursementDate: base.schoolYears[0].startDate, termMonths: 120, capitalizeInterest: true, requiredPayment: { graceMonths: 6 } }],
    repayment: { ...base.repayment, customOrder: ['zero'] },
    postGradIncome: { ...base.postGradIncome, monthlyDebtBudget: '600.00' },
  };
  edit(plan);
  return plan;
}

describe('earnings and budget (US-501)', () => {
  it('is the only editor of post-graduation earnings, with gross salary, take-home, expenses and the chosen budget kept distinct', () => {
    renderPlanner({ plan: samplePlan() });
    navigateTo('repayment');
    expect(screen.getByRole('heading', { level: 2, name: 'Repayment Plan' })).toBeTruthy();
    for (const label of ['Gross annual salary (before taxes)', 'Monthly take-home pay (optional)', 'Monthly living expenses (optional)', 'Monthly debt budget (your chosen payment)']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByText(/does not estimate taxes and never assumes your whole salary is available/)).toBeTruthy();
    expect(screen.queryByLabelText(/projection horizon/i)).toBeNull();
    // Income & Earnings has no post-graduation inputs any more (one source of truth).
    navigateTo('income');
    expect(screen.queryByLabelText(/salary|debt budget|take-home/i)).toBeNull();
  });

  it('shows affordability context only once take-home pay is entered; blank stays "not set" and 0 is a value', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    navigateTo('repayment');
    expect(screen.queryByRole('heading', { name: 'Affordability check' })).toBeNull();
    expect(view.plan().postGradIncome.monthlyTakeHome).toBeUndefined();

    await user.type(byId('postGradIncome.monthlyTakeHome'), '3000');
    expect(view.plan().postGradIncome.monthlyTakeHome).toBe('3000.00');
    const check = () => screen.getByRole('heading', { name: 'Affordability check' }).parentElement as HTMLElement;
    expect(check().textContent).toContain('Left before living expenses$2,400.00');
    expect(check().textContent).toContain('20.0% of your take-home pay');

    await user.type(byId('postGradIncome.monthlyExpenses'), '2000');
    expect(check().textContent).toContain('Left each month$400.00');

    await user.clear(byId('postGradIncome.monthlyExpenses'));
    await user.type(byId('postGradIncome.monthlyExpenses'), '2700');
    expect(check().textContent).toContain('Left each month−$300.00');
    expect(within(check()).getByText(/more than what is left after your expenses/)).toBeTruthy();

    // A valid zero is stored as a value; clearing the field removes it again.
    await user.clear(byId('postGradIncome.monthlyExpenses'));
    expect(view.plan().postGradIncome.monthlyExpenses).toBeUndefined();
    await user.type(byId('postGradIncome.monthlyExpenses'), '0');
    expect(view.plan().postGradIncome.monthlyExpenses).toBe('0.00');
    // Affordability never changes the chosen budget.
    expect(view.plan().postGradIncome.monthlyDebtBudget).toBe('600.00');
  });
});

describe('payoff mode (US-506)', () => {
  it('switches between budget and target modes; years + months edit the duration; 0 in total is rejected', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    navigateTo('repayment');
    expect(view.plan().repayment.payoffTarget).toEqual({ mode: 'budget' });
    expect(screen.getByRole('group', { name: 'Planning mode' })).toBeTruthy();
    await user.click(screen.getByLabelText('Choose a payoff target → see the required monthly payment'));
    expect(view.plan().repayment.payoffTarget).toEqual({ mode: 'target', kind: 'duration', months: 120 });
    const years = byId('repayment.payoffTarget.months');
    const months = byId('repayment.payoffTarget.months-part');
    expect(years.value).toBe('10');
    expect(months.value).toBe('0');

    await user.clear(years);
    await user.type(years, '5');
    await user.clear(months);
    await user.type(months, '6');
    expect(view.plan().repayment.payoffTarget).toEqual({ mode: 'target', kind: 'duration', months: 66 });

    await user.clear(years);
    await user.type(years, '0');
    await user.clear(months);
    await user.type(months, '0');
    expect(months.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('repayment.payoffTarget.months-part-error')?.textContent).toMatch(/1 month to 100 years/);
    expect(view.plan().repayment.payoffTarget).toEqual({ mode: 'target', kind: 'duration', months: 6 });

    // 1y 0m → 0y 11m passes through a rejected 0-month total; Months then combines with the Years shown (0), not 1.
    await user.clear(years);
    await user.type(years, '1');
    await user.tab();
    expect(view.plan().repayment.payoffTarget).toEqual({ mode: 'target', kind: 'duration', months: 12 });
    await user.clear(years);
    await user.type(years, '0');
    await user.tab();
    expect(view.plan().repayment.payoffTarget).toEqual({ mode: 'target', kind: 'duration', months: 12 });
    await user.clear(months);
    await user.type(months, '11');
    await user.tab();
    expect(view.plan().repayment.payoffTarget).toEqual({ mode: 'target', kind: 'duration', months: 11 });

    await user.click(screen.getByLabelText('Pay off by date'));
    const target = view.plan().repayment.payoffTarget;
    expect(target.mode === 'target' && target.kind).toBe('date');
    expect(byId('repayment.payoffTarget.date').value).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Back to budget mode, then target mode again restores the last target.
    await user.click(screen.getByLabelText('Choose a monthly budget → see payoff'));
    expect(view.plan().repayment.payoffTarget).toEqual({ mode: 'budget' });
    await user.click(screen.getByLabelText('Choose a payoff target → see the required monthly payment'));
    expect(view.plan().repayment.payoffTarget).toEqual(target);
  });

  it('shows the required payment, the chosen budget and the difference, and never changes the budget unless asked', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: zeroRatePlan(p => { p.repayment.payoffTarget = { mode: 'target', kind: 'duration', months: 12 }; }) });
    navigateTo('repayment');
    const result = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('.target-result[data-status="feasible"]');
      if (!element) throw new Error('no feasible target result yet');
      return element;
    });
    // US-506 acceptance: $12,000 at 0% over 12 payments → $1,000.00 per month.
    expect(result.textContent).toContain('Required monthly payment$1,000.00');
    expect(result.textContent).toContain('Your chosen budget$600.00');
    expect(result.textContent).toContain('$400.00 more than your budget');
    expect(view.plan().postGradIncome.monthlyDebtBudget).toBe('600.00');

    await user.click(within(result).getByRole('button', { name: 'Use $1,000.00 as my monthly budget' }));
    expect(view.plan().postGradIncome.monthlyDebtBudget).toBe('1000.00');
    await waitFor(() => expect(document.querySelector('.target-result')?.textContent).toContain('Same as your budget'));
    expect(screen.queryByRole('button', { name: /as my monthly budget/ })).toBeNull();
  });

  it('explains a target that is in the past without touching the budget', async () => {
    const view = renderPlanner({ plan: zeroRatePlan(p => { p.repayment.payoffTarget = { mode: 'target', kind: 'date', date: '2001-01-01' }; }) });
    navigateTo('repayment');
    const notice = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('.target-result[data-status="invalid"]');
      if (!element) throw new Error('no invalid result yet');
      return element;
    });
    expect(notice.textContent).toMatch(/can't be calculated/);
    expect(view.plan().postGradIncome.monthlyDebtBudget).toBe('600.00');
  });
});

describe('payment timing (US-507)', () => {
  it('sets when voluntary payments start, as months after graduation or a date', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    navigateTo('repayment');
    expect(byId('repayment.voluntaryStart.months').value).toBe('6');
    await user.clear(byId('repayment.voluntaryStart.months'));
    await user.type(byId('repayment.voluntaryStart.months'), '3');
    expect(view.plan().repayment.voluntaryStart).toEqual({ kind: 'afterGraduation', months: 3 });
    expect(screen.getByTestId('first-voluntary-payment').textContent).toBe('Sep 20, 2030');
    await user.click(screen.getByLabelText('From a specific date'));
    expect(view.plan().repayment.voluntaryStart).toEqual({ kind: 'date', date: '2030-08-20' });
    expect(byId('repayment.voluntaryStart.date').value).toBe('2030-08-20');
  });

  it('lists each loan\'s first required payment with its basis, separately from the first voluntary payment', () => {
    renderPlanner({ plan: samplePlan() });
    navigateTo('repayment');
    const table = screen.getByRole('region', { name: 'Required payment dates table' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0].textContent).toMatch(/Alpha loanDec 20, 2030Estimated: federal Direct loans.*6 months after graduation/);
    expect(rows[1].getAttribute('data-basis')).toBe('notConfigured');
    expect(rows[1].textContent).toMatch(/Beta loan/);
  });

  it('warns about required payments missed by a late voluntary start', () => {
    renderPlanner({ plan: zeroRatePlan(p => {
      p.loans[0].requiredPayment = { graceMonths: 0 };
      p.repayment.voluntaryStart = { kind: 'afterGraduation', months: 12 };
    }) });
    navigateTo('repayment');
    const alert = screen.getAllByRole('alert').find(element => /Required payments come before your first payment/.test(element.textContent ?? ''));
    expect(alert).toBeTruthy();
    expect(within(alert!).getByRole('button', { name: /Check due date/ })).toBeTruthy();
  });
});
