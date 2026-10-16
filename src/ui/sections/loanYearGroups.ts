import { useCallback, useState } from 'react';
import type { PlannerLoan, PlannerPlan } from '../../engine/planner-contracts';
import { money, sum } from '../../engine/money';
import { loanAcademicYear } from '../../engine/planner';
import { UNASSIGNED_ACADEMIC_YEAR, academicYearOfSchoolYear, formatAcademicYear } from '../../engine/academicYear';

/**
 * UI preference only (not plan data): whether the Loans page groups loans by academic year on this device.
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

/** Key of the section for loans without an academic year. */
export const UNASSIGNED_YEAR = 'unassigned';

/** Group key for a loan: its academic year ('2026-2027'), or UNASSIGNED_YEAR. */
export function loanYearKey(plan: PlannerPlan, loan: PlannerLoan): string {
  return loanAcademicYear(plan, loan) ?? UNASSIGNED_YEAR;
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
 * Presentation-only grouping by each loan's assigned academic year: years in chronological order,
 * loans within a year by disbursement date (ties keep plan order), and unassigned loans last.
 */
export function groupLoansByAcademicYear(plan: PlannerPlan): LoanYearGroup[] {
  const byKey = new Map<string, { loan: PlannerLoan; index: number }[]>();
  plan.loans.forEach((loan, index) => {
    const key = loanYearKey(plan, loan);
    const list = byKey.get(key) ?? [];
    list.push({ loan, index });
    byKey.set(key, list);
  });
  const keys = [...byKey.keys()].filter(key => key !== UNASSIGNED_YEAR).sort();
  if (byKey.has(UNASSIGNED_YEAR)) keys.push(UNASSIGNED_YEAR);
  return keys.map(key => {
    const entries = byKey.get(key)!;
    entries.sort((a, b) => (a.loan.disbursementDate < b.loan.disbursementDate ? -1 : a.loan.disbursementDate > b.loan.disbursementDate ? 1 : a.index - b.index));
    return {
      key,
      label: key === UNASSIGNED_YEAR ? 'Unassigned' : formatAcademicYear(key),
      loans: entries,
      totalPrincipal: totalPrincipal(entries.map(entry => entry.loan)),
    };
  });
}

/**
 * Selector options for a loan's academic year: the plan's school years and any other ranges loans use,
 * in chronological order, then Unassigned.
 */
export function academicYearOptions(plan: PlannerPlan): [string, string][] {
  const ranges = new Set(plan.schoolYears.map(academicYearOfSchoolYear));
  for (const loan of plan.loans) {
    const academicYear = loanAcademicYear(plan, loan);
    if (academicYear) ranges.add(academicYear);
  }
  return [
    ...[...ranges].sort().map(range => [range, formatAcademicYear(range)] as [string, string]),
    [UNASSIGNED_ACADEMIC_YEAR, 'Unassigned'],
  ];
}

function totalPrincipal(loans: readonly PlannerLoan[]): string {
  try {
    return money(sum(loans.map(loan => loan.principal)));
  } catch {
    return '0.00';
  }
}
