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
  it('matches years by position: a shifted start date keeps ids and data (US-101)', () => {
    const initial = valid('2026-08-24', '2030-05-15');
    initial.schoolYears[2].costItems.push({ label: 'Tuition', amount: '12000.00' });
    const ids = initial.schoolYears.map(year => year.id);
    const shifted = valid('2026-08-25', '2030-05-15', initial);
    expect(shifted.schoolYears.map(year => year.id)).toEqual(ids);
    expect(shifted.schoolYears.map(year => year.startDate)).toEqual(['2026-08-25', '2027-08-25', '2028-08-25', '2029-08-25']);
    expect(shifted.schoolYears[2].costItems).toEqual([{ label: 'Tuition', amount: '12000.00' }]);
  });
  it('gives new trailing years deterministic unique ids and keeps legacy date-shaped ids', () => {
    const legacy: Plan = { settings: { startDate: '2026-08-24', graduationDate: '2027-05-15' }, schoolYears: [
      { id: '2026-08-24', startDate: '2026-08-24', endDate: '2027-05-15', costItems: [{ amount: '1.00' }], resources: [] },
    ] };
    const extended = valid('2026-08-24', '2028-05-15', legacy);
    expect(extended.schoolYears.map(year => year.id)).toEqual(['2026-08-24', 'year-2']);
    expect(extended.schoolYears[0].costItems).toHaveLength(1);
    const clash: Plan = { ...legacy, schoolYears: [{ ...legacy.schoolYears[0], id: 'year-2' }] };
    expect(valid('2026-08-24', '2029-05-15', clash).schoolYears.map(year => year.id)).toEqual(['year-2', 'year-2-2', 'year-3']);
    expect(valid('2026-08-24', '2029-05-15', clash)).toEqual(valid('2026-08-24', '2029-05-15', clash));
  });
});
