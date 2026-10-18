export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
/** Memoized month sequences per anchor (projections ask for the same dates for every strategy,
 * scenario and event impact). Bounded so long editing sessions cannot grow it without limit. */
const monthCache = new Map<string, string[]>();
const MONTH_CACHE_ANCHORS = 256;
/** Calendar month addition anchored to the original day; month-end days clamp (Jan 31 + 1 → Feb 28/29). */
export function addMonths(anchor: string, months: number): string {
  if (!Number.isInteger(months) || months < 0 || months > 1200) return computeAddMonths(anchor, months);
  let sequence = monthCache.get(anchor);
  if (!sequence) {
    if (monthCache.size >= MONTH_CACHE_ANCHORS) monthCache.clear();
    sequence = [];
    monthCache.set(anchor, sequence);
  }
  return sequence[months] ??= computeAddMonths(anchor, months);
}
function computeAddMonths(anchor: string, months: number): string {
  const date = new Date(anchor + 'T00:00:00.000Z');
  const target = new Date(date);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const end = new Date(target);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  target.setUTCDate(Math.min(date.getUTCDate(), end.getUTCDate()));
  return target.toISOString().slice(0, 10);
}
/** Anniversary of `anchor` after `years` years (Feb 29 → Feb 28 in non-leap years). */
export const addYears = (anchor: string, years: number): string => addMonths(anchor, years * 12);
/** 'YYYY-MM' of an ISO date. */
export const monthKey = (date: string): string => date.slice(0, 7);
export const daysBetween = (start: string, end: string): number =>
  (Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000;

/**
 * Whole calendar months from `from` to `to` (both YYYY-MM-DD): a month counts once its day is reached
 * (Jan 15 → Mar 14 = 1, → Mar 15 = 2). 0 when `to` is not after `from`.
 */
export function wholeMonthsBetween(from: string, to: string): number {
  if (to <= from) return 0;
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  return Math.max(0, months);
}
