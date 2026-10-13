export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function addMonths(anchor: string, months: number): string {
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
export const daysBetween = (start: string, end: string): number =>
  (Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000;
