import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDefaultPlan } from '../engine/planner';
import type { PlannerPlan } from '../engine/planner-contracts';
import { validateDocument, validatePlannerPlan } from './validation';
import { importDocument } from './storage';

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

const paths = (plan: unknown) => {
  const result = validatePlannerPlan(plan);
  return result.ok ? [] : result.errors.map(error => error.path);
};

describe('validatePlannerPlan', () => {
  it('accepts the default plan and a plan with records', () => {
    expect(validatePlannerPlan(createDefaultPlan()).ok).toBe(true);
    expect(validatePlannerPlan(planWithRecords()).ok).toBe(true);
  });

  it('reports field paths by record ID, never by index', () => {
    const plan = planWithRecords();
    const yearId = plan.schoolYears[0].id;
    plan.loans[1].principal = '-5';
    plan.schoolYears[0].costItems[0].amount = '1.001';
    plan.lifeEvents[0].allocationPercent = '101';
    expect(paths(plan)).toEqual(expect.arrayContaining([
      'loans.loan-b.principal',
      `schoolYears.${yearId}.costItems.tuition.amount`,
      'lifeEvents.bonus.allocationPercent',
    ]));
  });

  it.each([
    ['money above the limit', (p: PlannerPlan) => { p.postGradIncome.annualSalary = '1000000000.01'; }, 'postGradIncome.annualSalary'],
    ['money with three decimals', (p: PlannerPlan) => { p.repayment.extraMonthlyPayment = '1.001'; }, 'repayment.extraMonthlyPayment'],
    ['blank money', (p: PlannerPlan) => { p.postGradIncome.monthlyDebtBudget = ''; }, 'postGradIncome.monthlyDebtBudget'],
    ['exponent money', (p: PlannerPlan) => { p.postGradIncome.monthlyDebtBudget = '1e3'; }, 'postGradIncome.monthlyDebtBudget'],
    ['rate above 30%', (p: PlannerPlan) => { p.loans[0].annualRate = '0.31'; }, 'loans.loan-a.annualRate'],
    ['grace above 12', (p: PlannerPlan) => { p.settings.graceMonths = 13; }, 'settings.graceMonths'],
    ['term 0', (p: PlannerPlan) => { p.loans[0].termMonths = 0; }, 'loans.loan-a.termMonths'],
    ['horizon 1201', (p: PlannerPlan) => { p.repayment.maxMonths = 1201; }, 'repayment.maxMonths'],
    ['family size 21', (p: PlannerPlan) => { p.repayment.familySize = 21; }, 'repayment.familySize'],
    ['blank name', (p: PlannerPlan) => { p.loans[0].name = '  '; }, 'loans.loan-a.name'],
    ['long name', (p: PlannerPlan) => { p.loans[0].name = 'x'.repeat(201); }, 'loans.loan-a.name'],
    ['impossible date', (p: PlannerPlan) => { p.loans[0].disbursementDate = '2026-02-30'; }, 'loans.loan-a.disbursementDate'],
    ['unknown strategy', (p: PlannerPlan) => { (p.repayment as { strategyId: string }).strategyId = 'input-order'; }, 'repayment.strategyId'],
    ['custom order with unknown loan', (p: PlannerPlan) => { p.repayment.customOrder = ['ghost']; }, 'repayment.customOrder'],
    ['custom order duplicate', (p: PlannerPlan) => { p.repayment.customOrder = ['loan-a', 'loan-a']; }, 'repayment.customOrder'],
    ['unknown school year', (p: PlannerPlan) => { p.loans[0].schoolYearId = 'gone'; }, 'loans.loan-a.schoolYearId'],
    ['bad recurrence', (p: PlannerPlan) => { (p.lifeEvents[0] as { recurrence: string }).recurrence = 'monthly'; }, 'lifeEvents.bonus.recurrence'],
    ['recurrence end before date', (p: PlannerPlan) => { p.lifeEvents[0].recurrenceEndDate = '2030-01-01'; }, 'lifeEvents.bonus.recurrenceEndDate'],
    ['duplicate loan ID', (p: PlannerPlan) => { p.loans[1].id = 'loan-a'; p.repayment.customOrder = []; }, 'loans.loan-a'],
    ['graduation before start', (p: PlannerPlan) => { p.settings.graduationDate = '2020-01-01'; }, 'settings.graduationDate'],
    ['school span over 50 years', (p: PlannerPlan) => { p.settings.graduationDate = '2077-08-25'; }, 'settings.graduationDate'],
    ['years out of order', (p: PlannerPlan) => { p.schoolYears.reverse(); }, 'schoolYears'],
    ['too many events', (p: PlannerPlan) => { p.lifeEvents = Array.from({ length: 101 }, (_, i) => ({ ...p.lifeEvents[0], id: `e${i}` })); }, 'lifeEvents'],
  ])('rejects %s', (_name, mutate, path) => {
    const plan = planWithRecords();
    mutate(plan);
    expect(paths(plan)).toContain(path);
  });

  it('accepts opaque and date-shaped school-year IDs', () => {
    const plan = planWithRecords();
    plan.schoolYears = plan.schoolYears.map((year, i) => ({ ...year, id: i === 0 ? year.id : `yr_${i}` }));
    plan.schoolYears[0] = { ...plan.schoolYears[0], id: plan.schoolYears[0].startDate };
    plan.loans[0].schoolYearId = plan.schoolYears[0].id;
    expect(validatePlannerPlan(plan).ok).toBe(true);
  });

  it('rejects a loan disbursed after repayment starts at the loan field (review M1)', () => {
    const plan = planWithRecords();
    plan.loans[1].disbursementDate = '2040-01-01';
    const result = validatePlannerPlan(plan);
    expect(result).toMatchObject({ ok: false, errors: [{ path: 'loans.loan-b.disbursementDate', message: 'Disbursement must be on or before repayment start (2030-11-20).' }] });
    plan.loans[1].disbursementDate = '2030-11-20';
    expect(validatePlannerPlan(plan).ok).toBe(true);
  });

  it('rejects calendar overflow beyond 9999', () => {
    const plan = createDefaultPlan();
    plan.settings.startDate = '9999-01-01';
    plan.settings.graduationDate = '9999-12-31';
    expect(validatePlannerPlan(plan).ok).toBe(false);
  });

  describe('scenarios', () => {
    it('accepts valid ID-based overrides', () => {
      const plan = planWithRecords();
      plan.scenarios = [{ id: 'later', name: 'Later', overrides: {
        'postGradIncome.monthlyDebtBudget': '200.00',
        [`schoolYears.${plan.schoolYears[0].id}.bufferPercent`]: '5',
        'settings.graduationDate': '2031-05-20',
      } }];
      expect(validatePlannerPlan(plan).ok).toBe(true);
    });

    it.each([
      ['__proto__ segment', { '__proto__.polluted': true }],
      ['constructor segment', { 'loans.constructor.principal': '1' }],
      ['prototype segment', { 'prototype.x': '1' }],
      ['object value', { 'postGradIncome.annualSalary': {} as unknown as string }],
      ['wrong type for target', { 'settings.graceMonths': '3' }],
      ['invalid effective value', { 'postGradIncome.monthlyDebtBudget': '-1' }],
      ['effective dates out of range', { 'settings.graduationDate': '9999-12-31' }],
    ])('rejects %s', (_name, overrides) => {
      const plan = planWithRecords();
      plan.scenarios = [{ id: 's1', name: 'S', overrides: overrides as Record<string, string> }];
      expect(validatePlannerPlan(plan).ok).toBe(false);
    });

    it('reports effective-plan errors under the scenario override path', () => {
      const plan = planWithRecords();
      plan.scenarios = [{ id: 's1', name: 'S', overrides: { 'postGradIncome.monthlyDebtBudget': '1.234' } }];
      expect(paths(plan)).toContain('scenarios.s1.overrides.postGradIncome.monthlyDebtBudget');
    });
  });

  it('rejects prototype keys at any depth', () => {
    const raw = JSON.stringify(planWithRecords()).replace('"settings":{', '"settings":{"__proto__":{"x":1},');
    expect(validatePlannerPlan(JSON.parse(raw)).ok).toBe(false);
  });
});

describe('validateDocument', () => {
  it('strips non-persisted fields such as drafts', () => {
    const result = validateDocument({ plan: createDefaultPlan(), disclaimerDismissed: true, drafts: { a: 'b' } });
    expect(result.ok && Object.keys(result.value).sort()).toEqual(['disclaimerDismissed', 'plan']);
  });

  it('requires a boolean disclaimer preference', () => {
    expect(validateDocument({ plan: createDefaultPlan() }).ok).toBe(false);
  });
});

describe('never throws (NFR-11)', () => {
  it('handles arbitrary JSON values', () => {
    fc.assert(fc.property(fc.jsonValue(), value => {
      expect(validatePlannerPlan(value).ok).toBe(false);
      expect(validateDocument(value).ok).toBe(false);
      expect(importDocument(JSON.stringify(value) ?? '').ok).toBe(false);
    }), { numRuns: 300 });
  });

  it('handles arbitrary text imports', () => {
    fc.assert(fc.property(fc.string(), text => {
      expect(() => importDocument(text)).not.toThrow();
    }), { numRuns: 300 });
  });

  it('handles arbitrary values substituted into every field of a valid plan', () => {
    const base = planWithRecords();
    const leafPaths: string[][] = [];
    const walk = (value: unknown, path: string[]) => {
      if (value !== null && typeof value === 'object') for (const [key, child] of Object.entries(value)) walk(child, [...path, key]);
      else leafPaths.push(path);
    };
    walk(base, []);
    fc.assert(fc.property(fc.constantFrom(...leafPaths), fc.jsonValue(), (path, replacement) => {
      const plan = structuredClone(base) as unknown as Record<string, unknown>;
      let cursor = plan;
      for (const key of path.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
      cursor[path.at(-1)!] = replacement;
      const result = validatePlannerPlan(plan);
      if (!result.ok) for (const error of result.errors) expect(typeof error.path).toBe('string');
    }), { numRuns: 500 });
  });

  it('handles a hostile object whose getters throw', () => {
    const hostile = new Proxy({}, { get() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); } });
    expect(validatePlannerPlan(hostile).ok).toBe(false);
    expect(validateDocument({ plan: hostile, disclaimerDismissed: false }).ok).toBe(false);
  });
});
