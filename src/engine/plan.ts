import type { SetupPlan as Plan, SchoolYear } from './contracts';
export type { SetupPlan as Plan, SchoolYear } from './contracts';

export type PlanErrors = Partial<Record<'startDate' | 'graduationDate', string>>;
export type PlanResult = { ok: true; plan: Plan } | { ok: false; errors: PlanErrors };
export interface YearRange { startDate: string; endDate: string }
export type YearRangesResult = { ok: true; ranges: YearRange[] } | { ok: false; errors: PlanErrors };

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return;
  const date = new Date(value + 'T00:00:00.000Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return;
  return date;
}

/** Anchor every anniversary to the original date; Feb 29 clamps to Feb 28. */
function anniversary(start: Date, offset: number): string {
  const year = start.getUTCFullYear() + offset;
  const month = start.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return String(year).padStart(4, '0') + '-' + String(month + 1).padStart(2, '0') + '-' +
    String(Math.min(start.getUTCDate(), lastDay)).padStart(2, '0');
}

/**
 * Academic-year boundaries for a plan. Intervals are [start, end); every start is an anniversary
 * of the school start date; the final year ends at graduation. Graduation on an anniversary adds
 * no extra year, and same-day enrollment and graduation produce one zero-length school year.
 */
export function schoolYearRanges(startDate: string, graduationDate: string): YearRangesResult {
  const start = parseDate(startDate);
  const graduation = parseDate(graduationDate);
  const errors: PlanErrors = {};
  if (!start) errors.startDate = 'Enter a valid school start date.';
  if (!graduation) errors.graduationDate = 'Enter a valid graduation date.';
  if (start && graduation && graduationDate < startDate) {
    errors.graduationDate = 'Graduation must be on or after your school start date.';
  }
  if (!start || !graduation || Object.keys(errors).length) return { ok: false, errors };

  const ranges: YearRange[] = [];
  let offset = 0;
  let yearStart = startDate;
  do {
    ++offset;
    const nextStart = start.getUTCFullYear() + offset > 9999 ? graduationDate : anniversary(start, offset);
    ranges.push({ startDate: yearStart, endDate: nextStart < graduationDate ? nextStart : graduationDate });
    yearStart = nextStart;
  } while (yearStart < graduationDate);
  return { ok: true, ranges };
}

/**
 * Match recomputed ranges to existing years by ordinal position. Surviving years keep their id
 * and all data (only dates change); removed trailing years are dropped; new trailing years get
 * a deterministic id 'year-<position>' (suffixed if that id is already taken).
 */
export function reconcileYears<T extends SchoolYear>(
  existing: readonly T[],
  ranges: readonly YearRange[],
  createYear: (id: string, range: YearRange) => T,
): T[] {
  const kept = existing.slice(0, ranges.length);
  const used = new Set(kept.map(year => year.id));
  return ranges.map((range, index) => {
    const previous = kept[index];
    if (previous) return { ...previous, startDate: range.startDate, endDate: range.endDate };
    let id = 'year-' + (index + 1);
    for (let suffix = 2; used.has(id); suffix++) id = 'year-' + (index + 1) + '-' + suffix;
    used.add(id);
    return createYear(id, range);
  });
}

/** Invalid edits return errors without modifying the existing plan. */
export function savePlan(startDate: string, graduationDate: string, existing?: Plan): PlanResult {
  const result = schoolYearRanges(startDate, graduationDate);
  if (!result.ok) return result;
  const schoolYears = reconcileYears<SchoolYear>(existing?.schoolYears ?? [], result.ranges, (id, range) => ({
    id, ...range, costItems: [], resources: [],
  }));
  return { ok: true, plan: { ...existing, settings: { ...existing?.settings, startDate, graduationDate }, schoolYears } };
}
