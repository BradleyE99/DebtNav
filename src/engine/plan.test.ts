import { describe, expect, it } from 'vitest';
import { savePlan, type Plan } from './plan';
function valid(start: string, end: string, existing?: Plan): Plan {
  const result = savePlan(start, end, existing);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.plan;
}
describe('plan setup', () => {
  it('creates four academic years spanning five calendar years', () => {
    const plan = valid('2026-08-24', '2030-05-15');
    expect(plan.schoolYears.map(y => y.startDate)).toEqual(['2026-08-24','2027-08-24','2028-08-24','2029-08-24']);
    expect(plan.schoolYears.at(-1)?.endDate).toBe('2030-05-15');
  });
  it('does not add a year at the exact anniversary', () => {
    expect(valid('2026-08-24','2027-08-24').schoolYears).toHaveLength(1);
    expect(valid('2026-08-24','2027-08-25').schoolYears).toHaveLength(2);
    expect(valid('2026-08-24','2026-08-24').schoolYears).toHaveLength(1);
  });
  it.each([['','2030-05-15'],['2026-02-30','2030-05-15'],['2026-08-24','bad'],['0000-01-01','2030-05-15'],['2026-08-24','2026-08-23']])('rejects invalid dates %s / %s', (start,end) => {
    expect(savePlan(start,end).ok).toBe(false);
  });
  it('extends and shortens while preserving retained data and leaving inputs untouched', () => {
    const initial = valid('2026-08-24','2028-05-15');
    initial.schoolYears[0].costItems.push({label:'Tuition',amount:'12000.00'});
    initial.schoolYears[1].resources.push({label:'Grant',amount:'4000.00'});
    const before = JSON.stringify(initial);
    const extended = valid('2026-08-24','2030-05-15',initial);
    expect(extended.schoolYears).toHaveLength(4);
    expect(extended.schoolYears[0].costItems).toEqual(initial.schoolYears[0].costItems);
    expect(extended.schoolYears[1].resources).toEqual(initial.schoolYears[1].resources);
    expect(extended.schoolYears[2].costItems).toEqual([]);
    expect(extended.schoolYears[2].resources).toEqual([]);
    expect(extended.schoolYears[1].endDate).toBe('2028-08-24');
    const shortened = valid('2026-08-24','2027-12-01',extended);
    expect(shortened.schoolYears).toHaveLength(2);
    expect(shortened.schoolYears[1].resources).toEqual(initial.schoolYears[1].resources);
    expect(shortened.schoolYears[1].endDate).toBe('2027-12-01');
    expect(JSON.stringify(initial)).toBe(before);
    expect(savePlan('2026-08-24','2025-01-01',initial).ok).toBe(false);
    expect(JSON.stringify(initial)).toBe(before);
  });
  it('handles the last supported calendar year', () => {
    expect(valid('9999-01-01','9999-12-31').schoolYears).toHaveLength(1);
  });
  it('clamps leap-day anniversaries without drifting', () => {
    expect(valid('2024-02-29','2028-03-01').schoolYears.map(y=>y.startDate)).toEqual(['2024-02-29','2025-02-28','2026-02-28','2027-02-28','2028-02-29']);
  });
});
