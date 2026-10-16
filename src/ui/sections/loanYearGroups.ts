import { useCallback, useState } from 'react';
import type { PlannerLoan } from '../../engine/planner-contracts';
import { money, sum } from '../../engine/money';
import { parseDateInput } from '../../data/parse';

/**
 * UI preference only (not plan data): whether the Loans page groups loans by disbursement year on this device.
 * Like the sidebar preference, it is not a plan key, so "Delete all my data" leaves it alone.
 */
export const LOAN_GROUPING_PREFERENCE_KEY = 'debtnav.ui.loansGroupByYear';

/** Storage can be missing or throw (private modes, disabled storage, SecurityError on access). */
export function readLoanGroupingPreference(): boolean {
  try {
    return window.localStorage.getItem(LOAN_GROUPING_PREFERENCE_KEY) === 'year';
  } catch {
    return false;
  }
}

export function writeLoanGroupingPreference(groupByYear: boolean): void {
  try {
    window.localStorage.setItem(LOAN_GROUPING_PREFERENCE_KEY, groupByYear ? 'year' : 'none');
  } catch {
    // Not remembered on this device; grouping still works for this visit.
  }
}

export function useLoanGroupingPreference(): [groupByYear: boolean, setGroupByYear: (groupByYear: boolean) => void] {
  const [groupByYear, setState] = useState(readLoanGroupingPreference);
  const setGroupByYear = useCallback((next: boolean) => {
    setState(next);
    writeLoanGroupingPreference(next);
  }, []);
  return [groupByYear, setGroupByYear];
}

/** Key of the section for loans without a valid disbursement date. */
export const UNASSIGNED_YEAR = 'unassigned';

/** Group key for a loan: its disbursement date's calendar year ('2026'), or UNASSIGNED_YEAR. */
export function loanYearKey(loan: Pick<PlannerLoan, 'disbursementDate'>): string {
  const date = loan.disbursementDate;
  return typeof date === 'string' && parseDateInput(date).ok ? date.slice(0, 4) : UNASSIGNED_YEAR;
}

export interface LoanYearGroup {
  key: string;
  label: string;
  /** Loans in disbursement order, with their position in the plan (used for fallback names). */
  loans: { loan: PlannerLoan; index: number }[];
  /** Σ principal of the group's loans, as a money string. */
  totalPrincipal: string;
}

/**
 * Presentation-only grouping: years in chronological order, loans within a year by disbursement date
 * (ties keep plan order), and loans without a valid date last under "Unassigned year".
 */
export function groupLoansByYear(loans: readonly PlannerLoan[]): LoanYearGroup[] {
  const byKey = new Map<string, { loan: PlannerLoan; index: number }[]>();
  loans.forEach((loan, index) => {
    const key = loanYearKey(loan);
    const list = byKey.get(key) ?? [];
    list.push({ loan, index });
    byKey.set(key, list);
  });
  const keys = [...byKey.keys()].filter(key => key !== UNASSIGNED_YEAR).sort();
  if (byKey.has(UNASSIGNED_YEAR)) keys.push(UNASSIGNED_YEAR);
  return keys.map(key => {
    const entries = byKey.get(key)!;
    if (key !== UNASSIGNED_YEAR) {
      entries.sort((a, b) => (a.loan.disbursementDate < b.loan.disbursementDate ? -1 : a.loan.disbursementDate > b.loan.disbursementDate ? 1 : a.index - b.index));
    }
    return {
      key,
      label: key === UNASSIGNED_YEAR ? 'Unassigned year' : key,
      loans: entries,
      totalPrincipal: totalPrincipal(entries.map(entry => entry.loan)),
    };
  });
}

function totalPrincipal(loans: readonly PlannerLoan[]): string {
  try {
    return money(sum(loans.map(loan => loan.principal)));
  } catch {
    return '0.00';
  }
}
