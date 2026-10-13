import type { SetupPlan as Plan, SchoolYear } from './contracts';
export type { SetupPlan as Plan, SchoolYear } from './contracts';

export type PlanErrors = Partial<Record<'startDate' | 'graduationDate', string>>;
export type PlanResult = { ok: true; plan: Plan } | { ok: false; errors: PlanErrors };

function parseDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return;
  const date = new Date(value + 'T00:00:00.000Z');
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return;
  return date;
}

// Anchor every anniversary to the original date; Feb 29 clamps to Feb 28.
function anniversary(start: Date, offset: number): string {
  const year = start.getUTCFullYear() + offset;
  const month = start.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return String(year).padStart(4, '0') + '-' + String(month + 1).padStart(2, '0') + '-' +
    String(Math.min(start.getUTCDate(), lastDay)).padStart(2, '0');
}

/** Year intervals are [start, end); graduation on an anniversary adds no extra year.
 * Same-day enrollment and graduation produce one zero-length school year.
 * Invalid edits return errors without modifying the existing plan.
 */
export function savePlan(startDate: string, graduationDate: string, existing?: Plan): PlanResult {
  const start = parseDate(startDate);
  const graduation = parseDate(graduationDate);
  const errors: PlanErrors = {};
  if (!start) errors.startDate = 'Enter a valid school start date.';
  if (!graduation) errors.graduationDate = 'Enter a valid graduation date.';
  if (start && graduation && graduationDate < startDate) {
    errors.graduationDate = 'Graduation must be on or after your school start date.';
  }
  if (!start || !graduation || Object.keys(errors).length) return { ok: false, errors };

  const retained = new Map(existing?.schoolYears.map(year => [year.id, year]));
  const schoolYears: SchoolYear[] = [];
  let offset = 0;
  let yearStart = startDate;
  do {
    ++offset;
    const nextStart = start.getUTCFullYear() + offset > 9999
      ? graduationDate
      : anniversary(start, offset);
    const id = yearStart;
    const previous = retained.get(id);
    schoolYears.push({
      ...previous,
      id,
      startDate: yearStart,
      endDate: nextStart < graduationDate ? nextStart : graduationDate,
      costItems: previous?.costItems ?? [],
      resources: previous?.resources ?? [],
    });
    yearStart = nextStart;
  } while (yearStart < graduationDate);
  return { ok: true, plan: { ...existing, settings: { ...existing?.settings, startDate, graduationDate }, schoolYears } };
}
