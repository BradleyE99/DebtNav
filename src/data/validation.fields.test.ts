import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDefaultPlan, reconcileSchoolYears } from '../engine/planner';
import type { PlannerPlan } from '../engine/planner-contracts';
import { validateDocument, validatePlannerPlan } from './validation';

function planWithRecords(): PlannerPlan {
  const plan = createDefaultPlan();
  const year = plan.schoolYears[0];
  year.costItems.push({ id: 'tuition', category: 'tuition', label: 'Tuition', amount: '12000.00', semester: 'annual' });
  year.resources.push({ id: 'grant', type: 'grant', label: 'Pell', amount: '3000.00', incomeMode: 'fixed', hourlyWage: '0', hoursPerWeek: '0', weeksWorked: '0', unavailablePercent: '0' });
  plan.loans.push({ id: 'loan-a', name: 'Direct', type: 'unsubsidized', principal: '5500.00', annualRate: '0.0653', disbursementDate: plan.settings.startDate, termMonths: 120, schoolYearId: year.id });
  plan.loans.push({ id: 'loan-b', name: 'Private', type: 'private', principal: '2000.00', annualRate: '0.09', disbursementDate: plan.settings.startDate, termMonths: 120 });
  plan.lifeEvents.push({ id: 'bonus', name: 'Bonus', date: '2031-06-01', type: 'windfall', amount: '1000.00', allocationPercent: '50', recurrence: 'yearly', recurrenceEndDate: '2035-06-01' });
  plan.repayment.customOrder = ['loan-b', 'loan-a'];
  return plan;
}

/** A plan that exercises every field, including every optional one. */
function fullPlan(): PlannerPlan {
  const plan = planWithRecords();
  const yearId = plan.schoolYears[0].id;
  plan.schoolYears[0].resources.push({ id: 'job', type: 'job', label: 'Cafe', amount: '0.00', incomeMode: 'hourly', hourlyWage: '15.00', hoursPerWeek: '15', weeksWorked: '30', unavailablePercent: '40' });
  Object.assign(plan.loans[0], { payInterestWhileInSchool: false, accruesInterestInSchool: true, capitalizeInterest: true, monthlyPayment: '80.00', gapAtCreation: '5500.00' });
  plan.lifeEvents.push({ id: 'fees', name: 'Lab fee', date: '2027-01-10', type: 'expense', amount: '300.00', allocationPercent: '100', schoolYearId: yearId, recurrence: 'once' });
  plan.scenarios = [{ id: 'raise', name: 'Raise', overrides: { 'postGradIncome.annualSalary': '65000.00', 'loans.loan-a.termMonths': 180 } }];
  return plan;
}

const paths = (plan: unknown) => {
  const result = validatePlannerPlan(plan);
  return result.ok ? [] : result.errors.map(error => error.path);
};

/** Field path (record IDs, never indexes) for a leaf found by walking the plan with indexes. */
function fieldPathOf(plan: unknown, keys: string[]): { path: string; isId: boolean } {
  const out: string[] = [];
  let cursor: unknown = plan;
  let isId = false;
  keys.forEach((key, i) => {
    if (Array.isArray(cursor)) {
      const item: unknown = cursor[Number(key)];
      if (item !== null && typeof item === 'object') out.push((item as { id: string }).id);
      cursor = item;
      return;
    }
    if (key === 'id' && i === keys.length - 1) isId = true;
    else out.push(key);
    cursor = (cursor as Record<string, unknown>)[key];
  });
  return { path: out.join('.'), isId };
}

describe('field-level coverage (every PlannerPlan field)', () => {
  const base = fullPlan();
  const leaves: string[][] = [];
  const walk = (value: unknown, keys: string[]) => {
    if (keys.at(-1) === 'overrides') {
      for (const key of Object.keys(value as object)) leaves.push([...keys, key]);
    } else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, [...keys, key]);
    } else {
      leaves.push(keys);
    }
  };
  walk(base, []);

  it('the full plan is valid and has many leaves', () => {
    expect(validatePlannerPlan(base)).toMatchObject({ ok: true });
    expect(leaves.length).toBeGreaterThan(80);
  });

  it.each(leaves.map(keys => [keys.join('.'), keys] as const))('an invalid value at %s is reported at its field path', (_label, keys) => {
    const plan = structuredClone(base) as unknown as Record<string, unknown>;
    let cursor = plan;
    for (const key of keys.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
    cursor[keys.at(-1)!] = { not: 'valid' };
    const { path, isId } = fieldPathOf(base, keys);
    const errors = paths(plan);
    if (isId) {
      // A broken id cannot name a path, so it is reported on the collection.
      expect(errors).toContain(path.split('.').slice(0, -1).join('.'));
    } else if (keys.includes('customOrder')) {
      expect(errors).toContain('repayment.customOrder');
    } else if (keys.includes('overrides')) {
      expect(errors).toContain(`scenarios.raise.overrides.${keys.at(-1)}`);
    } else {
      expect(errors).toContain(path);
    }
  });
});

describe('dates (US-101)', () => {
  const withDates = (start: string, graduation: string) => {
    const plan = createDefaultPlan();
    plan.settings.startDate = start;
    plan.settings.graduationDate = graduation;
    return reconcileSchoolYears(plan);
  };

  it('requires graduation strictly after the start date', () => {
    const same = withDates('2026-08-24', '2026-08-24');
    expect(validatePlannerPlan(same)).toMatchObject({
      ok: false,
      errors: [expect.objectContaining({ path: 'settings.graduationDate', message: 'Graduation must be after your school start date.' })],
    });
    expect(paths(withDates('2026-08-24', '2026-08-23'))).toContain('settings.graduationDate');
    expect(validatePlannerPlan(withDates('2026-08-24', '2026-08-25')).ok).toBe(true);
  });

  it('rejects impossible calendar dates and non-ISO formats', () => {
    for (const bad of ['2027-02-29', '2026-13-01', '2026-04-31', '2026-8-24', '08/24/2026', '2026-08-24T00:00:00Z', '', ' 2026-08-24']) {
      const plan = createDefaultPlan();
      plan.settings.startDate = bad;
      expect(paths(plan), bad).toContain('settings.startDate');
    }
  });

  it('limits every plan date to the years 1900–2199', () => {
    expect(paths(withDates('1899-12-31', '1903-05-01'))).toContain('settings.startDate');
    expect(validatePlannerPlan(withDates('1900-01-01', '1903-05-01')).ok).toBe(true);
    expect(paths(withDates('2195-08-01', '2200-01-01'))).toContain('settings.graduationDate');
    const plan = planWithRecords();
    plan.loans[0].disbursementDate = '1899-12-31';
    plan.lifeEvents[0].recurrenceEndDate = '2200-01-01';
    expect(paths(plan)).toEqual(expect.arrayContaining(['loans.loan-a.disbursementDate', 'lifeEvents.bonus.recurrenceEndDate']));
  });
});

describe('numbers (US-102, US-201, US-401)', () => {
  it.each([
    ['grace -1', (p: PlannerPlan) => { p.settings.graceMonths = -1; }, 'settings.graceMonths'],
    ['grace 2.5', (p: PlannerPlan) => { p.settings.graceMonths = 2.5; }, 'settings.graceMonths'],
    ['grace as text', (p: PlannerPlan) => { (p.settings as any).graceMonths = '6'; }, 'settings.graceMonths'],
    ['negative money', (p: PlannerPlan) => { p.loans[0].principal = '-1.00'; }, 'loans.loan-a.principal'],
    ['money as a JS number', (p: PlannerPlan) => { (p.loans[0] as any).principal = 100; }, 'loans.loan-a.principal'],
    ['NaN money', (p: PlannerPlan) => { p.loans[0].principal = 'NaN'; }, 'loans.loan-a.principal'],
    ['Infinity money', (p: PlannerPlan) => { p.loans[0].principal = 'Infinity'; }, 'loans.loan-a.principal'],
    ['hex money', (p: PlannerPlan) => { p.loans[0].principal = '0x10'; }, 'loans.loan-a.principal'],
    ['negative rate', (p: PlannerPlan) => { p.loans[0].annualRate = '-0.01'; }, 'loans.loan-a.annualRate'],
    ['percent above 100', (p: PlannerPlan) => { p.schoolYears[0].resources[0].unavailablePercent = '100.01'; }, `schoolYears.${p0().schoolYears[0].id}.resources.grant.unavailablePercent`],
    ['hours above 168', (p: PlannerPlan) => { p.schoolYears[0].resources[0].hoursPerWeek = '169'; }, `schoolYears.${p0().schoolYears[0].id}.resources.grant.hoursPerWeek`],
    ['bad enum', (p: PlannerPlan) => { (p.schoolYears[0].costItems[0] as any).category = 'rent'; }, `schoolYears.${p0().schoolYears[0].id}.costItems.tuition.category`],
    ['bad loan type', (p: PlannerPlan) => { (p.loans[0] as any).type = 'parent-plus'; }, 'loans.loan-a.type'],
    ['bad currency', (p: PlannerPlan) => { (p.settings as any).currency = 'EUR'; }, 'settings.currency'],
  ])('rejects %s', (_name, mutate, path) => {
    const plan = planWithRecords();
    mutate(plan);
    expect(paths(plan)).toContain(path);
  });

  it('accepts the boundaries 0 and 30% for rates, 0 and 12 for grace, and the money cap', () => {
    const plan = planWithRecords();
    plan.loans[0].annualRate = '0';
    plan.loans[1].annualRate = '0.30';
    plan.settings.graceMonths = 12;
    plan.loans[0].principal = '1000000000.00';
    expect(validatePlannerPlan(plan).ok).toBe(true);
    plan.settings.graceMonths = 0;
    expect(validatePlannerPlan(plan).ok).toBe(true);
  });
});
const p0 = () => createDefaultPlan();

describe('scenario override integrity', () => {
  const withOverrides = (overrides: Record<string, unknown>) => {
    const plan = planWithRecords();
    plan.scenarios = [{ id: 's1', name: 'S', overrides: overrides as Record<string, string> }];
    return plan;
  };

  it.each([
    ['a removed record', 'loans.removed-loan.principal', '10.00', /no longer exists/],
    ['a non-overridable field', 'settings.currency', 'USD', /cannot change/],
    ['a record name', 'loans.loan-a.name', 'Renamed', /cannot change/],
    ['an id', 'loans.loan-a.id', 'x', /cannot change/],
    ['a number field with text', 'settings.graceMonths', '3', /wrong kind/],
    ['a rate above 30%', 'loans.loan-a.annualRate', '0.5', /or less/],
    ['grace above 12', 'settings.graceMonths', 13, /whole number/],
    ['an impossible date', 'loans.loan-a.disbursementDate', '2026-02-30', /valid date/],
    ['an unknown strategy', 'repayment.strategyId', 'input-order', /Choose one of/],
  ])('rejects an override of %s at the override path', (_name, key, value, message) => {
    const result = validatePlannerPlan(withOverrides({ [key]: value }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.errors.find(e => e.path === `scenarios.s1.overrides.${key}`);
      expect(error, JSON.stringify(result.errors)).toBeDefined();
      expect(error!.message).toMatch(message);
    }
  });

  it('accepts overrides of every overridable field kind with valid values', () => {
    const plan = planWithRecords();
    const yearId = plan.schoolYears[0].id;
    plan.scenarios = [{ id: 's1', name: 'S', overrides: {
      'settings.graceMonths': 0,
      'repayment.strategyId': 'snowball',
      'loans.loan-a.annualRate': '0.3',
      'loans.loan-a.termMonths': 240,
      'loans.loan-a.disbursementDate': '2027-01-15',
      [`schoolYears.${yearId}.costItems.tuition.amount`]: '13000.00',
      [`schoolYears.${yearId}.resources.grant.unavailablePercent`]: '10',
      'lifeEvents.bonus.allocationPercent': '100',
    } }];
    expect(validatePlannerPlan(plan)).toMatchObject({ ok: true });
  });
});

describe('referential integrity', () => {
  it('rejects event links to missing school years at the field path', () => {
    const plan = planWithRecords();
    plan.lifeEvents[0].schoolYearId = 'gone';
    expect(paths(plan)).toContain('lifeEvents.bonus.schoolYearId');
  });

  it('rejects duplicate record IDs in nested collections', () => {
    const plan = planWithRecords();
    const year = plan.schoolYears[0];
    year.costItems.push({ ...year.costItems[0] });
    expect(paths(plan)).toContain(`schoolYears.${year.id}.costItems.tuition`);
  });
});

describe('validateDocument normalization', () => {
  it('drops derived and unknown data at every level, keeping only plan inputs', () => {
    const plan = fullPlan() as unknown as Record<string, any>;
    plan.projection = { repayment: {} };
    plan.settings.extra = 1;
    plan.loans[0].balanceAtRepayment = '9.00';
    plan.schoolYears[0].gap = '1.00';
    const result = validateDocument({ plan, disclaimerDismissed: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan).toEqual(fullPlan());
    expect(result.value.plan).not.toBe(plan);
  });
});

describe('never throws on arbitrary values (NFR-11)', () => {
  it('handles fc.anything() including undefined, sparse arrays, maps and null prototypes', () => {
    const anything = fc.anything({ withBoxedValues: true, withSparseArray: true, withNullPrototype: true, withMap: true, withSet: true, withDate: true });
    fc.assert(fc.property(anything, value => {
      expect(validatePlannerPlan(value).ok).toBe(false);
      expect(validateDocument(value).ok).toBe(false);
      expect(validateDocument({ plan: value, disclaimerDismissed: true }).ok).toBe(false);
    }), { numRuns: 300 });
  });

  it('handles a valid plan with arbitrary records injected into every collection', () => {
    const collections = ['loans', 'lifeEvents', 'scenarios', 'schoolYears'];
    fc.assert(fc.property(fc.constantFrom(...collections), fc.jsonValue(), (key, junk) => {
      const plan = fullPlan() as unknown as Record<string, unknown[]>;
      plan[key] = [...plan[key], junk];
      const result = validatePlannerPlan(plan);
      if (!result.ok) for (const error of result.errors) expect(error.path.length).toBeGreaterThan(0);
    }), { numRuns: 200 });
  });
});
