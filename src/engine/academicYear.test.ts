/** Academic-year assignment: format, legacy attribution, annual borrowing, and independence from interest. */
import { describe, expect, it } from 'vitest';
import type { PlannerLoan, PlannerPlan } from './planner-contracts';
import { academicYearFromStart, academicYearOfSchoolYear, formatAcademicYear, isAcademicYear } from './academicYear';
import { assignLegacyAcademicYears, calculatePlannerOutputs, createDefaultPlan, createLoanFromGap, loanAcademicYear, loanYearIndex } from './planner';

const loan = (id: string, extra: Partial<PlannerLoan> = {}): PlannerLoan => ({
  id, name: id, type: 'unsubsidized', principal: '5000.00', annualRate: '0.05', disbursementDate: '2026-08-24', termMonths: 120, ...extra,
});

/** Default school years: 2026-2027 … 2029-2030 (start 2026-08-24, graduation 2030-05-20). */
function planWith(...loans: PlannerLoan[]): PlannerPlan {
  const plan = createDefaultPlan();
  return { ...plan, loans, repayment: { ...plan.repayment, customOrder: loans.map(item => item.id) } };
}

describe('academic year values', () => {
  it('accepts consecutive ranges within 1900–2199 only', () => {
    expect(isAcademicYear('2026-2027')).toBe(true);
    for (const bad of ['2026-2028', '2026–2027', '26-27', '1899-1900', '2199-2200', 'unassigned', '', 2026]) expect(isAcademicYear(bad)).toBe(false);
    expect(academicYearFromStart(2025)).toBe('2025-2026');
    expect(academicYearFromStart(1899)).toBeNull();
    expect(academicYearOfSchoolYear({ startDate: '2027-01-10' })).toBe('2027-2028');
    expect(formatAcademicYear('2026-2027')).toBe('2026–2027');
  });

  it('labels the default plan school years as ranges', () => {
    expect(createDefaultPlan().schoolYears.map(academicYearOfSchoolYear)).toEqual(['2026-2027', '2027-2028', '2028-2029', '2029-2030']);
  });
});

describe('loan attribution', () => {
  it('uses the stored academic year, independent of the disbursement date', () => {
    const plan = planWith(
      loan('assigned', { academicYear: '2028-2029' }),
      loan('custom', { academicYear: '2024-2025' }),
      loan('none', { academicYear: 'unassigned' }),
    );
    expect(plan.loans.map(item => loanAcademicYear(plan, item))).toEqual(['2028-2029', '2024-2025', null]);
    expect(plan.loans.map(item => loanYearIndex(plan, item))).toEqual([2, -1, -1]);
  });

  it('keeps the earlier attribution for loans saved before academic years: schoolYearId, then the date', () => {
    const base = createDefaultPlan();
    const plan = planWith(
      loan('gap', { schoolYearId: base.schoolYears[1].id, disbursementDate: '2026-09-01' }),
      loan('dated', { disbursementDate: '2028-01-15' }),
      loan('outside', { disbursementDate: '2025-06-01' }),
    );
    expect(plan.loans.map(item => loanAcademicYear(plan, item))).toEqual(['2027-2028', '2027-2028', null]);
    const migrated = assignLegacyAcademicYears(plan);
    expect(migrated.loans.map(item => item.academicYear)).toEqual(['2027-2028', '2027-2028', 'unassigned']);
    // Nothing else changes, and the stored year no longer follows the date.
    expect(migrated.loans.map(({ academicYear: _ignored, ...rest }) => rest)).toEqual(plan.loans);
    const moved = { ...migrated, loans: migrated.loans.map(item => ({ ...item, disbursementDate: '2029-01-15' })) };
    expect(moved.loans.map(item => loanAcademicYear(moved, item))).toEqual(['2027-2028', '2027-2028', null]);
    expect(assignLegacyAcademicYears(migrated)).toBe(migrated);
  });

  it('gives gap-created loans the academic year of their school year', () => {
    const plan = createDefaultPlan();
    expect(createLoanFromGap(plan, plan.schoolYears[2].id, 'new').academicYear).toBe('2028-2029');
  });
});

describe('annual borrowing and interest', () => {
  const years = (plan: PlannerPlan) => {
    const result = calculatePlannerOutputs(plan);
    if (!result.ok) throw new Error('projection failed');
    return result.value;
  };

  it('counts each loan once, in its assigned academic year', () => {
    const plan = planWith(
      loan('a', { academicYear: '2026-2027', principal: '1000.00' }),
      loan('b', { academicYear: '2027-2028', principal: '2000.00', disbursementDate: '2026-09-01' }),
      loan('c', { academicYear: '2031-2032', principal: '4000.00' }),
      loan('d', { academicYear: 'unassigned', principal: '8000.00' }),
    );
    expect(years(plan).years.map(year => year.borrowed)).toEqual(['1000.00', '2000.00', '0.00', '0.00']);
  });

  it('changing only the academic year leaves dates, balances, and interest unchanged', () => {
    const before = planWith(loan('a', { academicYear: '2026-2027' }), loan('b', { academicYear: '2027-2028', disbursementDate: '2027-08-30', annualRate: '0.07' }));
    const after: PlannerPlan = { ...before, loans: before.loans.map(item => ({ ...item, academicYear: item.id === 'a' ? '2029-2030' : 'unassigned' })) };
    const one = years(before);
    const two = years(after);
    expect(two.repayment).toEqual(one.repayment);
    expect(two.minimumTotal).toBe(one.minimumTotal);
    expect(two.timeline).toEqual(one.timeline);
    expect(two.years.map(year => year.borrowed)).toEqual(['0.00', '0.00', '0.00', '5000.00']);
  });

  it('flags a gap mismatch only while the loan stays in its gap year', () => {
    const base = createDefaultPlan();
    const gapLoan = loan('g', { schoolYearId: base.schoolYears[0].id, gapAtCreation: '100.00', academicYear: '2026-2027' });
    expect(years(planWith(gapLoan)).years[0].mismatchLoanIds).toEqual(['g']);
    expect(years(planWith({ ...gapLoan, academicYear: '2027-2028' })).years.flatMap(year => year.mismatchLoanIds)).toEqual([]);
  });
});
