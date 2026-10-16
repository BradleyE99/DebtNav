// @vitest-environment jsdom
/** Optional "Group by year" view of the Loans page: grouping, totals, moves, adds, reveal, and the device preference. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlannerLoan, PlannerPlan } from '../../engine/planner-contracts';
import { renderPlanner, samplePlan } from '../testing/renderPlanner';
import { revealField } from '../reveal';
import {
  LOAN_GROUPING_PREFERENCE_KEY, groupLoansByYear, loanYearKey, readLoanGroupingPreference, writeLoanGroupingPreference,
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
const groupBy = () => screen.getByRole('checkbox', { name: 'Group by year' });
const yearToggle = (key: string) => within(byId(`loans-year-${key}`)).getAllByRole('button')[0];
const yearOpen = (key: string) => yearToggle(key).getAttribute('aria-expanded') === 'true';
const yearKeys = () => [...document.querySelectorAll('.loan-year')].map(section => section.id.replace('loans-year-', ''));
const loansIn = (key: string) => [...byId(`loans-year-${key}-loans`).querySelectorAll('article.loan-card')].map(card => card.querySelector('.loan-card__heading')!.id.replace(/^loans\.|-heading$/g, ''));

/** loan-a (2026) and loan-b (2027), plus loan-c dated before loan-a's year mate. */
function yearsPlan(): PlannerPlan {
  const base = samplePlan();
  const [a, b] = base.loans;
  const c: PlannerLoan = { ...a, id: 'loan-c', name: 'Gamma loan', principal: '1000.00', disbursementDate: '2026-08-01' };
  return {
    ...base,
    loans: [a, { ...b, disbursementDate: '2027-01-10' }, c],
    repayment: { ...base.repayment, customOrder: ['loan-a', 'loan-b', 'loan-c'] },
  };
}

describe('groupLoansByYear', () => {
  const loan = (id: string, disbursementDate: string, principal = '100.00') =>
    ({ id, name: id, type: 'unsubsidized', principal, annualRate: '0.05', disbursementDate, termMonths: 120 }) as PlannerLoan;

  it('orders years chronologically, loans by date (ties in plan order), and puts invalid dates last', () => {
    const groups = groupLoansByYear([
      loan('late', '2027-09-01'), loan('bad', '2026-02-30'), loan('tie-1', '2026-08-24', '250.50'),
      loan('early', '2026-01-05'), loan('blank', ''), loan('tie-2', '2026-08-24', '49.50'),
    ]);
    expect(groups.map(group => group.label)).toEqual(['2026', '2027', 'Unassigned year']);
    expect(groups[0].loans.map(entry => entry.loan.id)).toEqual(['early', 'tie-1', 'tie-2']);
    expect(groups[0].loans.map(entry => entry.index)).toEqual([3, 2, 5]);
    expect(groups[0].totalPrincipal).toBe('400.00');
    expect(groups[2].loans.map(entry => entry.loan.id)).toEqual(['bad', 'blank']);
    expect(loanYearKey({ disbursementDate: 'soon' })).toBe('unassigned');
    expect(groupLoansByYear([])).toEqual([]);
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

describe('Group by year', () => {
  it('is off by default, groups with counts and totals, is remembered, and switches back to the flat list', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: yearsPlan() });
    const before = JSON.stringify(view.plan());
    expect(groupBy()).toHaveProperty('checked', false);
    expect(document.querySelector('.loan-year')).toBeNull();
    expect(toggle('loan-a').closest('h3')).toBeTruthy();

    await user.click(groupBy());
    expect(yearKeys()).toEqual(['2026', '2027']);
    expect(loansIn('2026')).toEqual(['loan-c', 'loan-a']);
    expect(loansIn('2027')).toEqual(['loan-b']);
    expect(yearToggle('2026').textContent).toMatch(/2026\s*2 loans · \$6,000\.00 principal/);
    expect(yearToggle('2027').textContent).toMatch(/2027\s*1 loan · \$20,000\.00 principal/);
    expect(yearToggle('2026').closest('h3')).toBeTruthy();
    expect(toggle('loan-a').closest('h4')).toBeTruthy();
    // Card summaries are unchanged; fallback names keep their plan numbering.
    expect(toggle('loan-c').textContent).toMatch(/Gamma loan.*Federal Direct Unsubsidized.*Principal\s*\$1,000\.00.*Annual rate\s*5%/);
    expect(window.localStorage.getItem(LOAN_GROUPING_PREFERENCE_KEY)).toBe('year');
    expect(JSON.stringify(view.plan())).toBe(before);

    // Remembered on this device.
    cleanup();
    renderPlanner({ plan: yearsPlan() });
    expect(groupBy()).toHaveProperty('checked', true);
    expect(yearKeys()).toEqual(['2026', '2027']);

    await user.click(groupBy());
    expect(document.querySelector('.loan-year')).toBeNull();
    expect([...document.querySelectorAll('.loan-list > article.loan-card')]).toHaveLength(3);
    expect(toggle('loan-a').closest('h3')).toBeTruthy();
    expect(window.localStorage.getItem(LOAN_GROUPING_PREFERENCE_KEY)).toBe('none');
  });

  it('collapses year sections by keyboard without losing drafts or open cards', async () => {
    const user = userEvent.setup();
    writeLoanGroupingPreference(true);
    const view = renderPlanner({ plan: yearsPlan() });
    expect(yearOpen('2026')).toBe(true);
    await user.click(toggle('loan-a'));
    const principal = byId('loans.loan-a.principal');
    await user.clear(principal);
    await user.type(principal, 'abc');
    yearToggle('2026').focus();
    await user.keyboard('{Enter}');
    expect(yearOpen('2026')).toBe(false);
    expect(byId('loans-year-2026-loans').hidden).toBe(true);
    expect(yearToggle('2026').getAttribute('aria-controls')).toBe('loans-year-2026-loans');
    await user.keyboard(' ');
    expect(yearOpen('2026')).toBe(true);
    expect(isOpen('loan-a')).toBe(true);
    expect(byId('loans.loan-a.principal').value).toBe('abc');
    expect(view.plan().loans[0].principal).toBe('5000.00');
    // Expand all also opens collapsed years.
    await user.click(yearToggle('2027'));
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(yearOpen('2027') && isOpen('loan-b')).toBe(true);
  });

  it('moves a loan to its new year when its disbursement date changes, keeping it open and focused', async () => {
    const user = userEvent.setup();
    writeLoanGroupingPreference(true);
    const view = renderPlanner({ plan: yearsPlan() });
    await user.click(yearToggle('2027'));
    await user.click(toggle('loan-a'));
    const date = byId('loans.loan-a.disbursementDate');
    date.focus();
    fireEvent.change(date, { target: { value: '2027-03-01' } });
    fireEvent.keyDown(date, { key: 'Enter' });
    expect(view.plan().loans[0].disbursementDate).toBe('2027-03-01');
    expect(yearKeys()).toEqual(['2026', '2027']);
    expect(loansIn('2026')).toEqual(['loan-c']);
    expect(loansIn('2027')).toEqual(['loan-b', 'loan-a']);
    expect(yearOpen('2027')).toBe(true);
    expect(isOpen('loan-a')).toBe(true);
    expect(document.activeElement?.id).toBe('loans.loan-a.disbursementDate');
    expect(yearToggle('2026').textContent).toContain('1 loan · $1,000.00');
    expect(yearToggle('2027').textContent).toContain('2 loans · $25,000.00');
    // Repayment order is untouched by presentation.
    expect(view.plan().repayment.customOrder).toEqual(['loan-a', 'loan-b', 'loan-c']);
  });

  it('opens the year section and card of a newly added loan and focuses its name', async () => {
    const user = userEvent.setup();
    writeLoanGroupingPreference(true);
    const view = renderPlanner({ plan: yearsPlan() });
    await user.click(yearToggle('2026'));
    await user.click(screen.getByRole('button', { name: 'Add loan' }));
    const loan = view.plan().loans[3];
    expect(loanYearKey(loan)).toBe('2026');
    expect(yearOpen('2026')).toBe(true);
    expect(isOpen(loan.id)).toBe(true);
    await act(async () => { await new Promise(resolve => requestAnimationFrame(() => resolve(null))); });
    expect(document.activeElement?.id).toBe(`loans.${loan.id}.name`);
    expect(yearToggle('2026').textContent).toContain('3 loans');
  });

  it('opens a gap-created loan inside its year section', async () => {
    const user = userEvent.setup();
    writeLoanGroupingPreference(true);
    const view = renderPlanner({ plan: yearsPlan() });
    navigate('Costs');
    await user.click(screen.getByRole('button', { name: 'Create loan from gap for Year 1' }));
    const loan = view.plan().loans[3];
    expect(yearOpen(loanYearKey(loan))).toBe(true);
    expect(isOpen(loan.id)).toBe(true);
    expect(document.activeElement?.id).toBe(`loans.${loan.id}.name`);
  });

  it('reveals a field by opening its year section and card', async () => {
    const user = userEvent.setup();
    writeLoanGroupingPreference(true);
    renderPlanner({ plan: yearsPlan() });
    await user.click(yearToggle('2027'));
    act(() => { revealField('loans.loan-b.principal'); });
    expect(yearOpen('2027')).toBe(true);
    expect(isOpen('loan-b')).toBe(true);
    expect(yearOpen('2026') && !isOpen('loan-a')).toBe(true);
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
    expect(yearKeys()).toEqual(['2026']);
    await user.click(toggle('loan-c'));
    await user.click(screen.getByRole('button', { name: 'Remove loan Gamma loan' }));
    expect(yearToggle('2026').textContent).toContain('1 loan · $5,000.00');
  });
});
