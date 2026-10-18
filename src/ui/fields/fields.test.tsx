// @vitest-environment jsdom
/**
 * One test per field type: the user can click, clear (blank shows an error and never becomes 0),
 * type invalid text (it stays visible with a field error and never reaches the stored plan), and
 * type a valid value (it commits immediately and the results update — no Calculate button).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { navigateTo, renderPlanner, samplePlan } from '../testing/renderPlanner';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

const byId = (id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`No element with id ${id}`);
  return element as HTMLInputElement;
};
const errorText = (id: string) => document.getElementById(`${id}-error`)?.textContent ?? null;
const loanCard = (id: string) => byId(`loans.${id}-heading`).closest('article') as HTMLElement;
/** Value shown next to an inline figure label inside a container. */
function figure(container: HTMLElement, label: string): string {
  const term = [...container.querySelectorAll('dt')].find(dt => dt.textContent === label);
  if (!term) throw new Error(`No figure labeled ${label}`);
  return term.nextElementSibling?.textContent ?? '';
}
const yearId = samplePlan().schoolYears[0].id;
const yearCard = () => byId(`year-${yearId}-heading`).closest('article') as HTMLElement;

function expectNoCalculateButton() {
  expect(screen.queryByRole('button', { name: /calculate/i })).toBeNull();
}

describe('field types: clear, invalid text, valid typing, live results', () => {
  it('money: cost amount', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    navigateTo('school', true);
    const id = `schoolYears.${yearId}.costItems.cost-1.amount`;
    const field = byId(id);
    expect(figure(yearCard(), 'Funding gap')).toBe('$6,000.00');

    await user.click(field);
    await user.clear(field);
    expect(field.value).toBe('');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(errorText(id)).toMatch(/Enter a dollar amount/);
    expect(view.plan().schoolYears[0].costItems[0].amount).toBe('10000.00');

    await user.type(field, '12x');
    expect(field.value).toBe('12x');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(view.plan().schoolYears[0].costItems[0].amount).toBe('12.00'); // last valid text while typing
    await user.clear(field);
    await user.type(field, '$15,500.25');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(view.plan().schoolYears[0].costItems[0].amount).toBe('15500.25');
    expect(figure(yearCard(), 'Funding gap')).toBe('$11,500.25');
    expectNoCalculateButton();
  });

  it('percent: borrowing buffer', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    navigateTo('school', true);
    const id = `schoolYears.${yearId}.bufferPercent`;
    const field = byId(id);
    await user.click(field);
    await user.clear(field);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(errorText(id)).toMatch(/Enter a percentage/);
    expect(view.plan().schoolYears[0].bufferPercent).toBe('0');

    await user.type(field, '150');
    expect(field.value).toBe('150');
    expect(errorText(id)).toMatch(/100 or less/);
    expect(view.plan().schoolYears[0].bufferPercent).toBe('15');
    await user.clear(field);
    await user.type(field, '5');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(yearCard().querySelector('.buffer-control .computed')?.textContent).toBe('Gap + buffer: $6,300.00');
  });

  it('rate: loan interest rate shown as percent, stored as a fraction', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    navigateTo('loans');
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    const id = 'loans.loan-a.annualRate';
    const field = byId(id);
    const before = figure(loanCard('loan-a'), 'Minimum monthly payment');
    await user.click(field);
    await user.clear(field);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(errorText(id)).toMatch(/Enter an interest rate/);
    expect(view.plan().loans[0].annualRate).toBe('0.05');

    await user.type(field, 'six');
    expect(field.value).toBe('six');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(view.plan().loans[0].annualRate).toBe('0.05');
    await user.clear(field);
    await user.type(field, '8.25');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(view.plan().loans[0].annualRate).toBe('0.0825');
    expect(figure(loanCard('loan-a'), 'Minimum monthly payment')).not.toBe(before);
  });

  // v4 (US-507): the global grace period is gone; the integer field exercised here is "payments start N
  // months after graduation" in Repayment Plan (repayment.voluntaryStart.months, 0–60).
  it('integer: months after graduation when payments start', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    navigateTo('repayment');
    const id = 'repayment.voluntaryStart.months';
    const field = byId(id);
    const months = () => { const start = view.plan().repayment.voluntaryStart; return start.kind === 'afterGraduation' ? start.months : null; };
    const firstPayment = () => screen.getByTestId('first-voluntary-payment').textContent;
    expect(firstPayment()).toBe('Dec 20, 2030');
    await user.click(field);
    await user.clear(field);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(errorText(id)).toMatch(/Enter a whole number/);
    expect(months()).toBe(6);

    await user.type(field, '2.5');
    expect(field.value).toBe('2.5');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(months()).toBe(2);
    await user.clear(field);
    await user.type(field, '12');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(months()).toBe(12);
    expect(firstPayment()).toBe('Jun 20, 2031');
    await user.clear(field);
    await user.type(field, '61');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(months()).toBe(6); // '6' was the last valid text while typing '61'
  });

  it('date: loan disbursement date (blank is an error, never a default)', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    navigateTo('loans');
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    const id = 'loans.loan-a.disbursementDate';
    const field = byId(id);
    const original = view.plan().loans[0].disbursementDate;
    const before = figure(loanCard('loan-a'), 'Interest before repayment');
    await user.click(field);
    await user.clear(field);
    expect(field.value).toBe('');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(errorText(id)).toMatch(/Enter a complete date/);
    expect(view.plan().loans[0].disbursementDate).toBe(original);
    expect(figure(loanCard('loan-a'), 'Interest before repayment')).toBe(before);

    await user.type(field, '2029-08-24');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(view.plan().loans[0].disbursementDate).toBe('2029-08-24');
    expect(figure(loanCard('loan-a'), 'Interest before repayment')).not.toBe(before);
  });

  it('text: loan name (blank is an error and the stored name is kept)', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    navigateTo('loans');
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    const id = 'loans.loan-a.name';
    const field = byId(id);
    await user.click(field);
    await user.clear(field);
    expect(field.value).toBe('');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(errorText(id)).toMatch(/Enter a name/);
    expect(view.plan().loans[0].name).toBe('Alpha loan');
    expect(byId('loans.loan-a-heading').textContent).toContain('Alpha loan');

    await user.type(field, '   ');
    expect(field.value).toBe('   ');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    await user.clear(field);
    await user.type(field, 'Stafford');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(view.plan().loans[0].name).toBe('Stafford');
    expect(byId('loans.loan-a-heading').textContent).toContain('Stafford');
    navigateTo('results', true);
    expect(within(screen.getByRole('region', { name: 'Required payment dates table' })).getByText('Stafford')).toBeTruthy();
  });

  it('select: loan type changes in-school interest', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    navigateTo('loans');
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    const field = byId('loans.loan-a.type') as unknown as HTMLSelectElement;
    expect(figure(loanCard('loan-a'), 'Interest before repayment')).not.toBe('$0.00');
    await user.selectOptions(field, 'subsidized');
    expect(view.plan().loans[0].type).toBe('subsidized');
    expect(figure(loanCard('loan-a'), 'Interest before repayment')).toBe('$0.00');
    await user.selectOptions(field, 'unsubsidized');
    expect(figure(loanCard('loan-a'), 'Interest before repayment')).not.toBe('$0.00');
  });

  it('checkbox: "I pay interest while in school" shows the monthly cost and stops capitalization', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    navigateTo('loans');
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    const field = byId('loans.loan-a.payInterestWhileInSchool');
    expect(figure(loanCard('loan-a'), 'Interest added at repayment')).not.toBe('$0.00');
    await user.click(field);
    expect(field.checked).toBe(true);
    expect(view.plan().loans[0].payInterestWhileInSchool).toBe(true);
    expect(figure(loanCard('loan-a'), 'Interest added at repayment')).toBe('$0.00');
    expect(figure(loanCard('loan-a'), 'Balance at repayment')).toBe('$5,000.00');
    expect(figure(loanCard('loan-a'), 'In-school interest you pay')).toMatch(/^\$\d+\.\d\d\/mo$/);
    expect(loanCard('loan-a').textContent).toMatch(/You pay about \$\d+\.\d\d per month in school and grace \(\d+ payments, \$[\d,]+\.\d\d in all\)/);
    // Keyboard toggles it back.
    field.focus();
    await user.keyboard(' ');
    expect(field.checked).toBe(false);
    expect(figure(loanCard('loan-a'), 'Interest added at repayment')).not.toBe('$0.00');
  });

  it('valid edits persist (saved document) and reload into the fields', async () => {
    const user = userEvent.setup();
    const first = renderPlanner({ plan: samplePlan() });
    navigateTo('repayment');
    const salary = screen.getByLabelText('Salary (before tax)') as HTMLInputElement;
    await user.click(salary);
    await user.clear(salary);
    await user.type(salary, '61,250');
    await user.tab();
    expect(salary.value).toBe('61,250.00');
    const storage = first.storage;
    cleanup();
    renderPlanner({ storage });
    navigateTo('repayment');
    expect((screen.getByLabelText('Salary (before tax)') as HTMLInputElement).value).toBe('61,250.00');
  });
});
