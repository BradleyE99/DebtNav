// @vitest-environment jsdom
/** Loan academic years on the Loans page: the selector, the summary, "Group by academic year", and the device preference. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlannerLoan, PlannerPlan } from '../../engine/planner-contracts';
import { renderPlanner, samplePlan } from '../testing/renderPlanner';
import { revealField } from '../reveal';
import {
  LOAN_GROUPING_PREFERENCE_KEY, academicYearOptions, groupLoansByAcademicYear, readLoanGroupingPreference, writeLoanGroupingPreference,
} from './loanYearGroups';

beforeEach(() => { window.localStorage.clear(); window.history.replaceState(null, '', '/#loans'); });
afterEach(() => { cleanup(); window.localStorage.clear(); window.history.replaceState(null, '', '/'); vi.restoreAllMocks(); });
const navigate = (name: string) => fireEvent.click(within(screen.getByRole('navigation', { name: 'Planner sections' })).getByRole('link', { name }));

const byId = (id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`No element with id ${id}`);
  return element as HTMLInputElement;
};
const toggle = (loanId: string) => within(byId(`loans.${loanId}-heading`)).getByRole('button');
const isOpen = (loanId: string) => toggle(loanId).getAttribute('aria-expanded') === 'true';
const groupBy = () => screen.getByRole('checkbox', { name: 'Group by academic year' });
const yearToggle = (key: string) => within(byId(`loans-year-${key}`)).getAllByRole('button')[0];
const yearOpen = (key: string) => yearToggle(key).getAttribute('aria-expanded') === 'true';
const yearKeys = () => [...document.querySelectorAll('.loan-year')].map(section => section.id.replace('loans-year-', ''));
const loansIn = (key: string) => [...byId(`loans-year-${key}-loans`).querySelectorAll('article.loan-card')].map(card => card.querySelector('.loan-card__heading')!.id.replace(/^loans\.|-heading$/g, ''));
const academicYear = (loanId: string) => byId(`loans.${loanId}.academicYear`) as unknown as HTMLSelectElement;

/**
 * School years run 2026–2027 … 2029–2030. All three loans are disbursed in 2026, but loan-b pays
 * for 2027–2028: grouping follows the academic year, not the date.
 */
function yearsPlan(): PlannerPlan {
  const base = samplePlan();
  const [a, b] = base.loans;
  const c: PlannerLoan = { ...a, id: 'loan-c', name: 'Gamma loan', principal: '1000.00', disbursementDate: '2026-08-01', academicYear: '2026-2027' };
  return {
    ...base,
    loans: [{ ...a, academicYear: '2026-2027' }, { ...b, academicYear: '2027-2028' }, c],
    repayment: { ...base.repayment, customOrder: ['loan-a', 'loan-b', 'loan-c'] },
  };
}

describe('grouping helpers', () => {
  it('groups by academic year in order, loans by date, unassigned last; options list ranges then Unassigned', () => {
    const base = yearsPlan();
    const plan: PlannerPlan = { ...base, loans: [...base.loans, { ...base.loans[0], id: 'loan-d', academicYear: 'unassigned' }, { ...base.loans[0], id: 'loan-e', academicYear: '2024-2025' }] };
    const groups = groupLoansByAcademicYear(plan);
    expect(groups.map(group => group.label)).toEqual(['2024–2025', '2026–2027', '2027–2028', 'Unassigned']);
    expect(groups[1].loans.map(entry => entry.loan.id)).toEqual(['loan-c', 'loan-a']);
    expect(groups[1].totalPrincipal).toBe('6000.00');
    expect(academicYearOptions(plan).map(([, label]) => label)).toEqual(['2024–2025', '2026–2027', '2027–2028', '2028–2029', '2029–2030', 'Unassigned']);
  });

  it('reads and writes the device preference, tolerating storage that throws', () => {
    expect(readLoanGroupingPreference()).toBe(false);
    writeLoanGroupingPreference(true);
    expect(window.localStorage.getItem(LOAN_GROUPING_PREFERENCE_KEY)).toBe('year');
    expect(readLoanGroupingPreference()).toBe(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(readLoanGroupingPreference()).toBe(false);
    expect(() => writeLoanGroupingPreference(false)).not.toThrow();
  });
});

describe('academic year selector', () => {
  it('shows existing loans in the school year they already counted toward', () => {
    // samplePlan loans predate academic years; both are dated at the start of 2026–2027.
    const view = renderPlanner({ plan: samplePlan() });
    expect(view.plan().loans.map(loan => loan.academicYear)).toEqual(['2026-2027', '2026-2027']);
    expect(toggle('loan-a').textContent).toMatch(/Academic year\s*2026–2027/);
    expect(academicYear('loan-a').value).toBe('2026-2027');
    expect([...academicYear('loan-a').options].map(option => option.text)).toEqual(['2026–2027', '2027–2028', '2028–2029', '2029–2030', 'Unassigned', 'Add another academic year…']);
  });

  it('changes only the academic year, and can unassign it', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: yearsPlan() });
    const before = view.plan().loans[0];
    await user.click(toggle('loan-a'));
    await user.selectOptions(academicYear('loan-a'), '2029-2030');
    expect(view.plan().loans[0]).toEqual({ ...before, academicYear: '2029-2030' });
    expect(toggle('loan-a').textContent).toMatch(/Academic year\s*2029–2030/);
    await user.selectOptions(academicYear('loan-a'), 'unassigned');
    expect(view.plan().loans[0].academicYear).toBe('unassigned');
    expect(toggle('loan-a').textContent).toMatch(/Academic year\s*Unassigned/);
    expect(view.plan().repayment.customOrder).toEqual(['loan-a', 'loan-b', 'loan-c']);
  });

  it('adds an academic year that is not in the plan', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: yearsPlan() });
    await user.click(toggle('loan-b'));
    await user.selectOptions(academicYear('loan-b'), '__add__');
    expect(view.plan().loans[1].academicYear).toBe('2027-2028');
    await act(async () => { await new Promise(resolve => requestAnimationFrame(() => resolve(null))); });
    const start = byId('loans.loan-b.academicYear-start');
    expect(document.activeElement).toBe(start);
    await user.type(start, '19{Enter}');
    expect(start.getAttribute('aria-invalid')).toBe('true');
    expect(byId('loans.loan-b.academicYear-start-error').textContent).toContain('1900 to 2198');
    await user.clear(start);
    await user.type(start, '2024');
    expect(byId('loans.loan-b.academicYear-start-hint').textContent).toBe('Adds 2024–2025.');
    await user.keyboard('{Enter}');
    expect(view.plan().loans[1].academicYear).toBe('2024-2025');
    expect(view.plan().loans[1].disbursementDate).toBe(samplePlan().loans[1].disbursementDate);
    expect(document.getElementById('loans.loan-b.academicYear-start')).toBeNull();
    expect(academicYear('loan-b').value).toBe('2024-2025');
    // The new range is offered to every loan; Cancel (or Escape) adds nothing.
    await user.click(toggle('loan-a'));
    expect([...academicYear('loan-a').options].map(option => option.value)).toContain('2024-2025');
    await user.selectOptions(academicYear('loan-a'), '__add__');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(view.plan().loans[0].academicYear).toBe('2026-2027');
  });
});

describe('Group by academic year', () => {
  it('is off by default, groups with counts and totals, is remembered, and switches back to the flat list', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: yearsPlan() });
    const before = JSON.stringify(view.plan());
    expect(groupBy()).toHaveProperty('checked', false);
    expect(document.querySelector('.loan-year')).toBeNull();

    await user.click(groupBy());
    expect(yearKeys()).toEqual(['2026-2027', '2027-2028']);
    expect(loansIn('2026-2027')).toEqual(['loan-c', 'loan-a']);
    expect(loansIn('2027-2028')).toEqual(['loan-b']);
    expect(yearToggle('2026-2027').textContent).toMatch(/2026–2027\s*2 loans · \$6,000\.00 principal/);
    expect(yearToggle('2027-2028').textContent).toMatch(/2027–2028\s*1 loan · \$20,000\.00 principal/);
    expect(yearToggle('2026-2027').closest('h3')).toBeTruthy();
    expect(toggle('loan-a').closest('h4')).toBeTruthy();
    expect(window.localStorage.getItem(LOAN_GROUPING_PREFERENCE_KEY)).toBe('year');
    expect(JSON.stringify(view.plan())).toBe(before);

    cleanup();
    renderPlanner({ plan: yearsPlan() });
    expect(groupBy()).toHaveProperty('checked', true);
    expect(yearKeys()).toEqual(['2026-2027', '2027-2028']);

    await user.click(groupBy());
    expect(document.querySelector('.loan-year')).toBeNull();
    expect([...document.querySelectorAll('.loan-list > article.loan-card')]).toHaveLength(3);
    expect(toggle('loan-a').closest('h3')).toBeTruthy();
  });

  it('collapses year sections by keyboard without losing drafts or open cards', async () => {
    const user = userEvent.setup();
    writeLoanGroupingPreference(true);
    const view = renderPlanner({ plan: yearsPlan() });
    await user.click(toggle('loan-a'));
    const principal = byId('loans.loan-a.principal');
    await user.clear(principal);
    await user.type(principal, 'abc');
    yearToggle('2026-2027').focus();
    await user.keyboard('{Enter}');
    expect(yearOpen('2026-2027')).toBe(false);
    expect(byId('loans-year-2026-2027-loans').hidden).toBe(true);
    await user.keyboard(' ');
    expect(yearOpen('2026-2027') && isOpen('loan-a')).toBe(true);
    expect(byId('loans.loan-a.principal').value).toBe('abc');
    expect(view.plan().loans[0].principal).toBe('5000.00');
    await user.click(yearToggle('2027-2028'));
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(yearOpen('2027-2028') && isOpen('loan-b')).toBe(true);
  });

  it('moves a loan when its academic year changes, keeping it open and focused; the date does not move it', async () => {
    const user = userEvent.setup();
    writeLoanGroupingPreference(true);
    const view = renderPlanner({ plan: yearsPlan() });
    await user.click(yearToggle('2027-2028'));
    await user.click(toggle('loan-a'));
    await user.selectOptions(academicYear('loan-a'), '2027-2028');
    expect(loansIn('2026-2027')).toEqual(['loan-c']);
    expect(loansIn('2027-2028')).toEqual(['loan-a', 'loan-b']);
    expect(yearOpen('2027-2028') && isOpen('loan-a')).toBe(true);
    expect(document.activeElement?.id).toBe('loans.loan-a.academicYear');
    expect(yearToggle('2027-2028').textContent).toContain('2 loans · $25,000.00');

    const date = byId('loans.loan-a.disbursementDate');
    fireEvent.change(date, { target: { value: '2029-03-01' } });
    expect(view.plan().loans[0].disbursementDate).toBe('2029-03-01');
    expect(view.plan().loans[0].academicYear).toBe('2027-2028');
    expect(loansIn('2027-2028')).toEqual(['loan-b', 'loan-a']);

    await user.selectOptions(academicYear('loan-a'), 'unassigned');
    expect(yearKeys()).toEqual(['2026-2027', '2027-2028', 'unassigned']);
    expect(yearToggle('unassigned').textContent).toMatch(/Unassigned\s*1 loan/);
  });

  it('opens the year section and card of a newly added loan, assigned to the first school year', async () => {
    const user = userEvent.setup();
    writeLoanGroupingPreference(true);
    const view = renderPlanner({ plan: yearsPlan() });
    await user.click(yearToggle('2026-2027'));
    await user.click(screen.getByRole('button', { name: 'Add loan' }));
    const loan = view.plan().loans[3];
    expect(loan.academicYear).toBe('2026-2027');
    expect(yearOpen('2026-2027') && isOpen(loan.id)).toBe(true);
    await act(async () => { await new Promise(resolve => requestAnimationFrame(() => resolve(null))); });
    expect(document.activeElement?.id).toBe(`loans.${loan.id}.name`);
  });

  it('opens a gap-created loan inside its academic year', async () => {
    const user = userEvent.setup();
    writeLoanGroupingPreference(true);
    const plan = yearsPlan();
    plan.loans[2] = { ...plan.loans[2], principal: '500.00' }; // Year 1 still needs $500
    const view = renderPlanner({ plan });
    navigate('College Costs');
    await user.click(screen.getByRole('button', { name: /^Create loan .*for Year 1$/ }));
    const loan = view.plan().loans[3];
    expect(loan.academicYear).toBe('2026-2027');
    expect(yearOpen('2026-2027') && isOpen(loan.id)).toBe(true);
    expect(document.activeElement?.id).toBe(`loans.${loan.id}.name`);
  });

  it('reveals a field by opening its year section and card', async () => {
    const user = userEvent.setup();
    writeLoanGroupingPreference(true);
    renderPlanner({ plan: yearsPlan() });
    await user.click(yearToggle('2027-2028'));
    act(() => { revealField('loans.loan-b.principal'); });
    expect(yearOpen('2027-2028') && isOpen('loan-b')).toBe(true);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
    expect(document.activeElement?.id).toBe('loans.loan-b.principal');
  });

  it('updates groups when a loan is removed', async () => {
    const user = userEvent.setup();
    writeLoanGroupingPreference(true);
    const view = renderPlanner({ plan: yearsPlan() });
    await user.click(toggle('loan-b'));
    await user.click(screen.getByRole('button', { name: 'Remove loan Beta loan' }));
    expect(view.plan().loans.map(loan => loan.id)).toEqual(['loan-a', 'loan-c']);
    expect(yearKeys()).toEqual(['2026-2027']);
    expect(yearToggle('2026-2027').textContent).toContain('2 loans · $6,000.00');
  });
});
