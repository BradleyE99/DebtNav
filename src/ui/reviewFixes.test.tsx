// @vitest-environment jsdom
/** Regression tests for the independent review findings (M1–M3, m1, m2, m4, m5, m7, m8, m15). */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlannerPlan } from '../engine/planner-contracts';
import { listStrategies } from '../engine/strategies/registry';
import { calculatePlannerProjection } from '../engine/planner';
import { comparisonError, projectable } from './results/comparison';
import { renderPlanner, samplePlan } from './testing/renderPlanner';
import type { PlannerStore } from '../engine/planner-contracts';
import PlannerApp from './PlannerApp';

afterEach(cleanup);

const byId = (id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`No element with id ${id}`);
  return element as HTMLInputElement;
};

describe('review fixes', () => {
  it('M2: the default share of raises seeds new and switched income-change events', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    const share = screen.getByLabelText('Default share of raises put toward debt');
    await user.clear(share);
    await user.type(share, '30');
    await user.click(screen.getByRole('button', { name: 'Add income change' }));
    const income = view.plan().lifeEvents[0];
    expect(income).toMatchObject({ type: 'income', allocationPercent: '30', amount: view.plan().postGradIncome.annualSalary });
    expect((byId(`lifeEvents.${income.id}.allocationPercent`)).value).toBe('30');

    await user.click(screen.getByRole('button', { name: 'Add life event' }));
    const windfall = view.plan().lifeEvents[1];
    expect(windfall.allocationPercent).toBe('100');
    await user.selectOptions(byId(`lifeEvents.${windfall.id}.type`), 'income');
    expect(view.plan().lifeEvents[1].allocationPercent).toBe('30');
  });

  it('M3: temporary negative amortization keeps the debt-free date and shows the engine warning instead', () => {
    const base = samplePlan();
    const plan: PlannerPlan = {
      ...base,
      loans: [{ id: 'big', name: 'Big loan', type: 'unsubsidized', principal: '30000.00', annualRate: '0.065', disbursementDate: base.settings.startDate, termMonths: 120, capitalizeInterest: true }],
      repayment: { ...base.repayment, customOrder: ['big'] },
      postGradIncome: { ...base.postGradIncome, monthlyDebtBudget: '50.00' },
      lifeEvents: [{ id: 'raise', name: 'Raise', type: 'income', date: '2032-01-01', amount: '85000.00', allocationPercent: '50' }],
    };
    renderPlanner({ plan });
    const debtFree = screen.getByTestId('key-debt-free').textContent ?? '';
    const summary = document.querySelector('.summary') as HTMLElement;
    if (/^[A-Z][a-z]{2} \d{4}$/.test(debtFree)) {
      expect(summary.textContent).not.toMatch(/there is no debt-free date/);
      expect(within(summary).getAllByText(/interest|grow/i).length).toBeGreaterThan(0);
    } else {
      expect(summary.textContent).toMatch(/there is no debt-free date/);
    }
  });

  it('M1: a disbursement date after repayment starts is rejected at the field and results stay visible', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    const field = byId('loans.loan-b.disbursementDate');
    const original = view.plan().loans[1].disbursementDate;
    await user.clear(field);
    await user.type(field, '2031-06-01');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('loans.loan-b.disbursementDate-error')?.textContent).toMatch(/repayment start/i);
    expect(view.plan().loans[1].disbursementDate).toBe(original);
    expect(screen.getByTestId('key-gap').textContent).toBe('$6,000.00');
  });

  it('m1: comparison entries carrying an error are treated as not comparable', () => {
    const projection = calculatePlannerProjection(samplePlan());
    if (!projection.ok) throw new Error('sample plan must project');
    const good = { id: 'a', name: 'A', projection: projection.value.repayment, firstPayoffMonth: 1, interestDifference: '0', monthsDifference: 0 };
    expect(projectable(good)).toBe(true);
    expect(comparisonError(good)).toBeNull();
    const failed = { ...good, error: { path: 'loans.x.disbursementDate', message: 'Disbursement must be on or before repayment start.' } };
    expect(projectable(failed)).toBe(false);
    expect(comparisonError(failed)).toBe('Disbursement must be on or before repayment start.');
    expect(comparisonError({ ...good, error: 'No payoff' } as typeof good)).toBe('No payoff');
    expect(projectable(undefined)).toBe(false);
  });

  it('m2: strategy options and names come from the engine registry', () => {
    renderPlanner({ plan: samplePlan() });
    const options = [...(byId('repayment.strategyId') as unknown as HTMLSelectElement).options].map(option => [option.value, option.text]);
    expect(options).toEqual(listStrategies().map(entry => [entry.id, entry.name]));
  });

  it('m3: new loans default to the current undergraduate Direct Loan rate', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    await user.click(screen.getByRole('button', { name: 'Add loan' }));
    expect(view.plan().loans[2].annualRate).toBe('0.0652');
  });

  it('m4: the year cost total includes school expense events, shown as a line', () => {
    const base = samplePlan();
    const yearId = base.schoolYears[0].id;
    renderPlanner({ plan: { ...base, lifeEvents: [{ id: 'laptop', name: 'Laptop', type: 'expense', date: base.schoolYears[0].startDate, amount: '1500.00', allocationPercent: '100', schoolYearId: yearId }] } });
    const totals = document.querySelector('[aria-label="Year 1 cost totals"]')?.textContent ?? '';
    expect(totals).toContain('Cost items$10,000.00');
    expect(totals).toContain('School expense events+$1,500.00');
    expect(totals).toContain('Year 1 cost total$11,500.00');
  });

  it('m5: the federal comparison labels the projection row as federal loans only', () => {
    const base = samplePlan();
    renderPlanner({ plan: { ...base, loans: base.loans.map(loan => ({ ...loan, disbursementDate: '2026-06-01' })) } });
    const table = screen.getByRole('region', { name: 'Federal repayment plan comparison' });
    expect(within(table).getByText('Your projection (federal Direct loans only)')).toBeTruthy();
    expect(within(table).queryByText(/all loans/)).toBeNull();
  });

  it('m7: the save status is announced by a single live region', () => {
    renderPlanner({ plan: samplePlan() });
    const live = [...document.querySelectorAll('.save-status')].filter(element => element.getAttribute('role') === 'status');
    expect(live).toHaveLength(1);
  });

  it('m8: the page behind the delete dialog is inert and hidden from assistive technology', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    await user.click(screen.getByRole('button', { name: 'Delete all my data' }));
    const dialog = screen.getByRole('alertdialog');
    expect(view.container.getAttribute('aria-hidden')).toBe('true');
    expect((view.container as HTMLElement & { inert?: boolean }).inert).toBe(true);
    expect(view.container.contains(dialog)).toBe(false);
    await user.keyboard('{Escape}');
    expect(view.container.getAttribute('aria-hidden')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete all my data' })).toBe(document.activeElement);
  });

  it('m15: the disclaimer states exactly what the Scorecard lookup sends', () => {
    renderPlanner({ plan: samplePlan(), disclaimerDismissed: false });
    expect(screen.getByText(/sends the school name, the data year, the list of requested data fields, and an API key/)).toBeTruthy();
  });

  it('M1: when repayment cannot be projected, gaps stay visible and the loan date is highlighted', () => {
    const base = samplePlan();
    const plan: PlannerPlan = { ...base, loans: base.loans.map(loan => (loan.id === 'loan-b' ? { ...loan, disbursementDate: '2031-06-01' } : loan)) };
    // A stub store bypasses validation so the engine's partial-results path is exercised directly.
    const store: PlannerStore = {
      document: { plan, disclaimerDismissed: true },
      updatePlan: () => ({ ok: true, value: plan }),
      dismissDisclaimer: () => {}, saveStatus: { state: 'saved', message: null, savedAt: null }, undo: null,
      markUndoable: () => {}, importText: () => ({ ok: false, errors: [] }), exportJson: () => ({ ok: true, value: '' }),
      deleteAllData: () => ({ ok: true, notice: null }),
    };
    render(<PlannerApp store={store} />);
    expect(screen.getByTestId('key-gap').textContent).toBe('$6,000.00');
    expect(screen.getByTestId('key-debt-free').textContent).toBe("Can't be projected");
    const yearId = plan.schoolYears[0].id;
    const yearCard = byId(`year-${yearId}-heading`).closest('article') as HTMLElement;
    expect(yearCard.textContent).toContain('$6,000.00');
    expect(screen.getByRole('region', { name: 'School year summary table' })).toBeTruthy();
    const field = byId('loans.loan-b.disbursementDate');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('loans.loan-b.disbursementDate-error')?.textContent).toMatch(/results can't be projected/);
    const card = byId('loans.loan-b-heading').closest('article') as HTMLElement;
    // The loan card starts collapsed: its summary flags the problem; expanding shows the full alert.
    expect(byId('loans.loan-b-attention').textContent).toMatch(/Needs attention: 1 field \(repayment can.t be projected\)/);
    fireEvent.click(within(byId('loans.loan-b-heading')).getByRole('button'));
    expect(within(card).getByRole('alert').textContent).toMatch(/because of this loan/);
    const results = byId('results-heading').closest('section') as HTMLElement;
    expect(results.textContent).toMatch(/Repayment can't be projected yet/);
    expect(within(results).getByRole('link', { name: 'Go to the field' }).getAttribute('href')).toBe('#loans.loan-b.disbursementDate');
    expect(screen.queryByRole('region', { name: 'Amortization schedule table' })).toBeNull();
  });

  it('graduation edits that would start repayment before a loan is disbursed show the error at the field', async () => {
    const user = userEvent.setup();
    const base = samplePlan();
    const view = renderPlanner({ plan: { ...base, loans: base.loans.map(loan => ({ ...loan, disbursementDate: '2029-08-24' })) } });
    const field = byId('settings.graduationDate');
    await user.clear(field);
    await user.type(field, '2028-05-20');
    await user.tab();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('settings.graduationDate-error')?.textContent).toMatch(/loan/i);
    expect(view.plan().settings.graduationDate).toBe(base.settings.graduationDate);
  });
});
