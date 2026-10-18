/**
 * Academic years ('2026-2027'): which school year a loan pays for. Kept separate from the loan's
 * disbursement date, which alone drives interest accrual and repayment.
 *
 * Stored on a loan as `academicYear`: a range 'YYYY-YYYY' (second year = first + 1) or 'unassigned'.
 * A plan school year's academic year is named by the calendar year it starts in.
 */
export const UNASSIGNED_ACADEMIC_YEAR = 'unassigned';

const MIN_START_YEAR = 1900;
const MAX_START_YEAR = 2198;

/** 'YYYY-YYYY' for the academic year starting in `startYear`, or null outside 1900–2198. */
export function academicYearFromStart(startYear: number): string | null {
  return Number.isInteger(startYear) && startYear >= MIN_START_YEAR && startYear <= MAX_START_YEAR ? `${startYear}-${startYear + 1}` : null;
}

/** True for a well-formed range such as '2026-2027'. */
export function isAcademicYear(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{4})$/.exec(value);
  return match !== null && academicYearFromStart(Number(match[1])) === value; // money-lint-allow: calendar year, not money
}

/** The academic year a school year represents, named by the calendar year it starts in. */
export function academicYearOfSchoolYear(year: { startDate: string }): string {
  const start = Number(year.startDate.slice(0, 4)); // money-lint-allow: calendar year, not money
  return `${start}-${start + 1}`;
}

/** Display label: '2026-2027' → '2026–2027'. */
export function formatAcademicYear(value: string): string {
  return value.replace('-', '–');
}
