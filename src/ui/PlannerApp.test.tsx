// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { memoryStorage, renderPlanner, samplePlan } from './testing/renderPlanner';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const byId = (id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`No element with id ${id}`);
  return element as HTMLInputElement;
};
/** jsdom's File lacks text(); provide it. */
function jsonFile(text: string): File {
  const file = new File([text], 'plan.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => text });
  return file;
}
const keyGap = () => screen.getByTestId('key-gap').textContent;
const keyInterest = () => screen.getByTestId('key-interest').textContent;

function firstYearId(plan = samplePlan()) { return plan.schoolYears[0].id; }

describe('editable fields', () => {
  it('lets the user clear a money field (error, results keep last valid) and type a new value (results update)', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    const yearId = firstYearId();
    const amount = byId(`schoolYears.${yearId}.costItems.cost-1.amount`);
    expect(screen.getAllByLabelText('Amount')).toContain(amount);
    expect(amount.value).toBe('10,000.00');
    expect(keyGap()).toBe('$6,000.00');

    await user.click(amount);
    await user.clear(amount);
    expect(amount.value).toBe('');
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    const error = byId(`${amount.id}-error`);
    expect(amount.getAttribute('aria-describedby')).toContain(error.id);
    expect(error.textContent).toMatch(/Enter a dollar amount\./);
    expect(error.textContent).toMatch(/Results use the last valid value/);
    expect(keyGap()).toBe('$6,000.00');
    expect(view.plan().schoolYears[0].costItems[0].amount).toBe('10000.00');

    await user.type(amount, '12000');
    expect(amount.value).toBe('12000');
    expect(amount.getAttribute('aria-invalid')).toBeNull();
    expect(keyGap()).toBe('$8,000.00');
    expect(view.plan().schoolYears[0].costItems[0].amount).toBe('12000.00');

    await user.tab();
    expect(amount.value).toBe('12,000.00');
  });

  it("accepts '55,000' and '$400', and rejects 'abc' without committing", async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    const salary = screen.getByLabelText('Expected annual salary') as HTMLInputElement;
    await user.tripleClick(salary);
    await user.keyboard('55,000');
    expect(salary.getAttribute('aria-invalid')).toBeNull();
    expect(view.plan().postGradIncome.annualSalary).toBe('55000.00');

    const budget = screen.getByLabelText('Monthly amount for all loans') as HTMLInputElement;
    await user.clear(budget);
    await user.type(budget, '$400');
    expect(view.plan().postGradIncome.monthlyDebtBudget).toBe('400.00');

    await user.clear(budget);
    await user.type(budget, 'abc');
    expect(budget.value).toBe('abc');
    expect(budget.getAttribute('aria-invalid')).toBe('true');
    expect(byId('postGradIncome.monthlyDebtBudget-error').textContent).toMatch(/digits only/);
    expect(view.plan().postGradIncome.monthlyDebtBudget).toBe('400.00');
  });

  it('shows the rate as a percent and stores the annual fraction; rejects rates over 30%', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    const rate = byId('loans.loan-a.annualRate');
    expect(rate.value).toBe('5');
    await user.clear(rate);
    await user.type(rate, '6.8');
    expect(view.plan().loans[0].annualRate).toBe('0.068');
    await user.clear(rate);
    await user.type(rate, '31');
    expect(byId('loans.loan-a.annualRate-error').textContent).toMatch(/0% to 30%/);
    // '3' was the last valid text while typing '31'.
    expect(view.plan().loans[0].annualRate).toBe('0.03');
  });

  it('follows values changed elsewhere (undo after removal restores the field)', async () => {
    const user = userEvent.setup();
    renderPlanner({ plan: samplePlan() });
    const yearId = firstYearId();
    await user.click(screen.getByRole('button', { name: 'Remove cost Tuition' }));
    expect(document.getElementById(`schoolYears.${yearId}.costItems.cost-1.amount`)).toBeNull();
    expect(keyGap()).toBe('$0.00');
    await user.click(within(screen.getByText(/Remove cost "Tuition"/).closest('.undo-bar') as HTMLElement).getByRole('button', { name: 'Undo' }));
    expect(byId(`schoolYears.${yearId}.costItems.cost-1.amount`).value).toBe('10,000.00');
    expect(keyGap()).toBe('$6,000.00');
  });
});

describe('school timeline', () => {
  it('keeps every year\'s costs when the start date changes (commits after the date settles)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = renderPlanner({ plan: samplePlan() });
    const before = view.plan();
    const start = byId('settings.startDate');
    fireEvent.change(start, { target: { value: '2026-09-01' } });
    expect(view.plan().settings.startDate).toBe(before.settings.startDate);
    await act(async () => { vi.advanceTimersByTime(700); });
    const after = view.plan();
    expect(after.settings.startDate).toBe('2026-09-01');
    expect(after.schoolYears[0].id).toBe(before.schoolYears[0].id);
    expect(after.schoolYears[0].costItems).toHaveLength(1);
    expect(byId(`schoolYears.${after.schoolYears[0].id}.costItems.cost-1.amount`).value).toBe('10,000.00');
  });

  it('shows a field error and keeps the text when graduation is before the start date', () => {
    const view = renderPlanner({ plan: samplePlan() });
    const graduation = byId('settings.graduationDate');
    fireEvent.change(graduation, { target: { value: '2020-01-01' } });
    fireEvent.blur(graduation);
    expect(graduation.value).toBe('2020-01-01');
    expect(graduation.getAttribute('aria-invalid')).toBe('true');
    expect(byId('settings.graduationDate-error').textContent).toMatch(/Graduation/);
    expect(view.plan().settings.graduationDate).toBe(samplePlan().settings.graduationDate);
  });

  it('offers undo when a date change removes school years with data', async () => {
    const user = userEvent.setup();
    const plan = samplePlan();
    const view = renderPlanner({ plan });
    const graduation = byId('settings.graduationDate');
    fireEvent.change(graduation, { target: { value: plan.schoolYears[0].endDate } });
    fireEvent.keyDown(graduation, { key: 'Enter' });
    // Only the first year carries data, so shortening to one year removes nothing worth undoing.
    expect(view.plan().schoolYears).toHaveLength(1);
    fireEvent.change(graduation, { target: { value: plan.settings.graduationDate } });
    fireEvent.blur(graduation);
    expect(view.plan().schoolYears).toHaveLength(plan.schoolYears.length);
    // Add data to the last year, then remove it by shortening the timeline.
    const lastYear = view.plan().schoolYears.at(-1)!;
    await user.click(screen.getByRole('button', { name: `Add cost to Year ${plan.schoolYears.length}` }));
    expect(view.plan().schoolYears.at(-1)!.costItems).toHaveLength(1);
    fireEvent.change(graduation, { target: { value: lastYear.startDate } });
    fireEvent.blur(graduation);
    expect(view.plan().schoolYears.length).toBeLessThan(plan.schoolYears.length);
    expect(screen.getByText(/removed by this date change/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(view.plan().schoolYears).toHaveLength(plan.schoolYears.length);
    expect(view.plan().schoolYears.at(-1)!.costItems).toHaveLength(1);
  });
});

describe('records', () => {
  it('adds, edits, and removes costs and resources', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    await user.click(screen.getByRole('button', { name: 'Add cost to Year 1' }));
    const item = view.plan().schoolYears[0].costItems[1];
    const amount = byId(`schoolYears.${view.plan().schoolYears[0].id}.costItems.${item.id}.amount`);
    await user.clear(amount);
    await user.type(amount, '2000');
    expect(keyGap()).toBe('$8,000.00');
    await user.selectOptions(byId(`schoolYears.${view.plan().schoolYears[0].id}.costItems.${item.id}.semester`), 'fall');
    expect(screen.getByText('Fall subtotal')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Add resource to Year 1' }));
    const resource = view.plan().schoolYears[0].resources[1];
    const base = `schoolYears.${view.plan().schoolYears[0].id}.resources.${resource.id}`;
    await user.selectOptions(byId(`${base}.type`), 'job');
    await user.selectOptions(byId(`${base}.incomeMode`), 'hourly');
    // $15 × 15 h × 30 weeks = $6,750 → gap 12,000 − 10,750 = 1,250.
    expect(keyGap()).toBe('$1,250.00');
    await user.clear(byId(`${base}.unavailablePercent`));
    await user.type(byId(`${base}.unavailablePercent`), '40');
    expect(view.plan().schoolYears[0].resources[1].unavailablePercent).toBe('40');
    await user.click(screen.getByRole('button', { name: /Remove resource Grant/ }));
    expect(view.plan().schoolYears[0].resources).toHaveLength(1);
  });

  it('adds, edits, and removes a loan; total debt updates', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    expect(screen.getByText(/Total borrowed:/).textContent).toContain('$25,000.00');
    await user.click(screen.getByRole('button', { name: 'Add loan' }));
    const loan = view.plan().loans[2];
    expect(view.plan().repayment.customOrder).toContain(loan.id);
    const principal = byId(`loans.${loan.id}.principal`);
    await user.clear(principal);
    await user.type(principal, '1,000');
    expect(screen.getByText(/Total borrowed:/).textContent).toContain('$26,000.00');
    await user.click(byId(`loans.${loan.id}.payInterestWhileInSchool`));
    expect(view.plan().loans[2].payInterestWhileInSchool).toBe(true);
    expect(screen.getByText(/per month in school and grace/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: `Remove loan ${loan.name}` }));
    expect(view.plan().loans).toHaveLength(2);
    expect(view.plan().repayment.customOrder).not.toContain(loan.id);
  });

  it('creates a loan from the gap pre-filled with gap + buffer, with a mismatch notice when the gap changes', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: { ...samplePlan(), loans: [], repayment: { ...samplePlan().repayment, customOrder: [] } } });
    await user.click(screen.getByRole('button', { name: 'Create loan from gap for Year 1' }));
    const [loan] = view.plan().loans;
    expect(loan.principal).toBe('6000.00');
    expect(document.activeElement?.id).toBe(`loans.${loan.id}.name`);
    const amount = byId(`schoolYears.${view.plan().schoolYears[0].id}.costItems.cost-1.amount`);
    await user.clear(amount);
    await user.type(amount, '11000');
    expect(view.plan().loans[0].principal).toBe('6000.00');
    expect(screen.getByText(/The loan was not changed/)).toBeTruthy();
  });

  it('adds, edits, and removes a life event with an impact sentence', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    await user.click(screen.getByRole('button', { name: 'Add life event' }));
    const event = view.plan().lifeEvents[0];
    const amount = byId(`lifeEvents.${event.id}.amount`);
    await user.clear(amount);
    await user.type(amount, '3000');
    expect(view.plan().lifeEvents[0].amount).toBe('3000.00');
    expect(await screen.findByText(/This event moves your debt-free date earlier by \d+ months? and saves \$[\d,]+\.\d\d interest\./)).toBeTruthy();
    await user.selectOptions(byId(`lifeEvents.${event.id}.recurrence`), 'yearly');
    expect(view.plan().lifeEvents[0].recurrence).toBe('yearly');
    await user.click(screen.getByRole('button', { name: /Remove event New event/ }));
    expect(view.plan().lifeEvents).toHaveLength(0);
  });

  it('adds a scenario, stores only changed overrides, resets to base, and removes it', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    await user.click(screen.getByRole('button', { name: 'Add scenario' }));
    const scenario = view.plan().scenarios[0];
    const salaryId = `scenarios.${scenario.id}.overrides.postGradIncome.monthlyDebtBudget`;
    const budget = byId(salaryId);
    expect(budget.value).toBe('600.00');
    await user.clear(budget);
    await user.type(budget, '600');
    expect(view.plan().scenarios[0].overrides).toEqual({});
    await user.clear(budget);
    await user.type(budget, '900');
    expect(view.plan().scenarios[0].overrides).toEqual({ 'postGradIncome.monthlyDebtBudget': '900.00' });
    expect(await screen.findByText(/^Debt-free (between|in) /)).toBeTruthy();

    // Any-field picker.
    await user.selectOptions(byId(`scenarios.${scenario.id}.picker`), 'loans.loan-a.annualRate');
    await user.click(screen.getByRole('button', { name: `Add field to ${scenario.name}` }));
    const rate = byId(`scenarios.${scenario.id}.overrides.loans.loan-a.annualRate`);
    await user.clear(rate);
    await user.type(rate, '7');
    expect(view.plan().scenarios[0].overrides['loans.loan-a.annualRate']).toBe('0.07');

    await user.click(screen.getByRole('button', { name: 'Reset to base for Monthly debt budget' }));
    expect(view.plan().scenarios[0].overrides['postGradIncome.monthlyDebtBudget']).toBeUndefined();
    expect(byId(salaryId).value).toBe('600.00');
    await user.click(screen.getByRole('button', { name: 'Reset all to base' }));
    expect(view.plan().scenarios[0].overrides).toEqual({});
    await user.click(screen.getByRole('button', { name: `Remove scenario ${scenario.name}` }));
    expect(view.plan().scenarios).toHaveLength(0);
  });
});

describe('repayment', () => {
  it('changing the strategy updates results', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    const avalancheInterest = keyInterest();
    await user.selectOptions(screen.getByLabelText('Payoff strategy'), 'snowball');
    expect(view.plan().repayment.strategyId).toBe('snowball');
    expect(keyInterest()).not.toBe(avalancheInterest);
    const table = screen.getByRole('table', { name: /Same plan, different payoff orders/ });
    expect(within(table).getByText('Your choice').closest('tr')?.textContent).toMatch(/Snowball/);
    expect(table.textContent).not.toMatch(/\bbest\b/i);
  });

  it('reorders the custom payoff order with keyboard-accessible buttons', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    const down = screen.getByRole('button', { name: 'Move down Alpha loan' });
    down.focus();
    await user.keyboard('{Enter}');
    expect(view.plan().repayment.customOrder).toEqual(['loan-b', 'loan-a']);
    expect(screen.getByText('Alpha loan moved to position 2 of 2.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Move up Alpha loan' }));
    expect(view.plan().repayment.customOrder).toEqual(['loan-a', 'loan-b']);
  });

  it('warns about a budget shortfall and negative amortization without a debt-free date', async () => {
    const user = userEvent.setup();
    renderPlanner({ plan: samplePlan() });
    const budget = screen.getByLabelText('Monthly amount for all loans');
    await user.clear(budget);
    await user.type(budget, '50');
    expect(screen.getByText(/short of the minimum payments/)).toBeTruthy();
    expect(screen.getByText(/payments don't cover the interest/)).toBeTruthy();
    expect(screen.getByTestId('key-debt-free').textContent).toBe('No debt-free date');
  });

  it('pages through the amortization schedule', async () => {
    const user = userEvent.setup();
    renderPlanner({ plan: samplePlan() });
    expect(screen.getByRole('table', { name: /All loans combined: months 1–24 of/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Next 24 months' }));
    expect(screen.getByRole('table', { name: /months 25–48 of/ })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Show'), 'loan-b');
    expect(screen.getByRole('table', { name: /Beta loan: months 1–/ })).toBeTruthy();
  });
});

describe('data and disclaimer', () => {
  it('shows the disclaimer on first visit, dismisses it, and reopens it from the footer', async () => {
    const user = userEvent.setup();
    renderPlanner({ storage: memoryStorage() });
    expect(screen.getByRole('heading', { name: 'Estimates, not financial advice' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'I understand' }));
    expect(screen.queryByRole('heading', { name: 'Estimates, not financial advice' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'About these estimates (disclaimer)' }));
    expect(document.activeElement?.textContent).toBe('Estimates, not financial advice');
  });

  it('delete dialog: focus moves in, Tab is trapped, Escape cancels and returns focus, confirm deletes', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    const trigger = screen.getByRole('button', { name: 'Delete all my data' });
    await user.click(trigger);
    const dialog = screen.getByRole('alertdialog', { name: 'Delete all DebtNav data?' });
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete all data' });
    expect(document.activeElement).toBe(cancel);
    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(view.plan().loans).toHaveLength(2);

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Delete all data' }));
    expect(view.plan().loans).toHaveLength(0);
    expect(view.storage.getItem('debtnav.plan')).toBeNull();
  });

  it('imports a valid file and rejects an invalid one without changing the plan', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    const exported = view.store().exportJson();
    if (!exported.ok) throw new Error('export failed');
    const budget = screen.getByLabelText('Monthly amount for all loans');
    await user.clear(budget);
    await user.type(budget, '700');
    await user.upload(screen.getByLabelText('Import plan (JSON)'), jsonFile(exported.value));
    expect(await screen.findByText(/Plan imported/)).toBeTruthy();
    expect((screen.getByLabelText('Monthly amount for all loans') as HTMLInputElement).value).toBe('600.00');
    await user.upload(screen.getByLabelText('Import plan (JSON)'), jsonFile('{bad'));
    expect(await screen.findByText(/Import failed; your current plan is unchanged/)).toBeTruthy();
    expect(view.plan().postGradIncome.monthlyDebtBudget).toBe('600.00');
  });

  it('has no axe-core violations on the main render', async () => {
    renderPlanner({ plan: { ...samplePlan(), scenarios: [{ id: 'sc-1', name: 'Conservative', overrides: { 'postGradIncome.annualSalary': '45000.00' } }] }, disclaimerDismissed: false });
    // Color contrast cannot be computed in jsdom; it is checked in a real browser.
    const result = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});
