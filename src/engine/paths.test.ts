/** US-801 field-path helpers: overrides keyed by stable record ids, never array indexes. */
import { describe, it, expect } from 'vitest';
import type { PlannerPlan } from './planner-contracts';
import { createDefaultPlan, applyScenario } from './planner';
import {
  getPathValue, isResolvablePath, setScenarioOverride, clearScenarioOverride, applyOverrides, overridablePaths, pruneDanglingReferences,
} from './paths';

function samplePlan(): PlannerPlan {
  const plan = createDefaultPlan();
  plan.schoolYears[0].costItems = [{ id: 'tuition', category: 'tuition', label: 'Tuition', amount: '12000.00', semester: 'annual' }];
  plan.schoolYears[0].resources = [
    { id: 'job', type: 'job', label: 'Campus job', amount: '0', incomeMode: 'hourly', hourlyWage: '15.00', hoursPerWeek: '15', weeksWorked: '30', unavailablePercent: '0' },
    { id: 'grant', type: 'grant', label: '', amount: '4000.00', incomeMode: 'fixed', hourlyWage: '0', hoursPerWeek: '0', weeksWorked: '0', unavailablePercent: '0' },
  ];
  plan.loans = [{ id: 'a', name: 'Loan A', type: 'unsubsidized', principal: '5000.00', annualRate: '0.06', disbursementDate: '2026-08-24', termMonths: 120, schoolYearId: 'year-1' }];
  plan.lifeEvents = [
    { id: 'bonus', name: 'Bonus', date: '2031-06-01', type: 'windfall', amount: '3000.00', allocationPercent: '100', schoolYearId: 'year-4' },
    { id: 'grant3', name: '', date: '2028-09-01', type: 'aid', amount: '1500.00', allocationPercent: '100' },
  ];
  plan.scenarios = [{ id: 's', name: 'Scenario', overrides: {} }];
  return plan;
}

describe('path resolution', () => {
  it('reads leaves through record ids and rejects unsafe, dangling, id and scenario paths', () => {
    const plan = samplePlan();
    expect(getPathValue(plan, 'repayment.voluntaryStart.months')).toBe(6);
    expect(getPathValue(plan, 'settings.graceMonths')).toBeUndefined(); // removed in schema v4
    expect(getPathValue(plan, 'loans.a.principal')).toBe('5000.00');
    expect(getPathValue(plan, 'schoolYears.year-1.costItems.tuition.amount')).toBe('12000.00');
    for (const path of ['', 'loans.missing.principal', 'loans.a.id', 'scenarios.s.name', '__proto__.x', 'loans.a.constructor', 'settings..x', 'settings', 'loans.a.nope', 'x'.repeat(501)]) {
      expect(getPathValue(plan, path)).toBeUndefined();
      expect(isResolvablePath(plan, path)).toBe(false);
    }
    expect(isResolvablePath(plan, 123 as unknown as string)).toBe(false);
    // Optional leaves may be overridden even when the base omits them.
    expect(isResolvablePath(plan, 'loans.a.monthlyPayment')).toBe(true);
    expect(getPathValue(plan, 'loans.a.monthlyPayment')).toBeUndefined();
    expect(isResolvablePath(plan, 'repayment.maxMonths')).toBe(false); // removed in schema v4
    expect(isResolvablePath(plan, 'lifeEvents.bonus.recurrence')).toBe(true);
    expect(isResolvablePath(plan, 'settings.maxMonths')).toBe(false);
    // Non-primitive leaves (arrays/objects) are not overridable.
    expect(isResolvablePath(plan, 'repayment.customOrder')).toBe(false);
  });
});

describe('US-801 overrides store only differences', () => {
  it('stores a differing value, removes it when set back to the base (decimal-aware), and clears explicitly', () => {
    let plan = samplePlan();
    plan = setScenarioOverride(plan, 's', 'postGradIncome.monthlyDebtBudget', '500.00');
    expect(plan.scenarios[0].overrides).toEqual({ 'postGradIncome.monthlyDebtBudget': '500.00' });
    plan = setScenarioOverride(plan, 's', 'postGradIncome.monthlyDebtBudget', '400');
    expect(plan.scenarios[0].overrides).toEqual({});
    plan = setScenarioOverride(plan, 's', 'repayment.voluntaryStart.months', 0);
    expect(plan.scenarios[0].overrides).toEqual({ 'repayment.voluntaryStart.months': 0 });
    plan = clearScenarioOverride(plan, 's', 'repayment.voluntaryStart.months');
    expect(plan.scenarios[0].overrides).toEqual({});
  });

  it('leaves the plan unchanged for unknown scenarios, unsafe paths and non-primitive values', () => {
    const plan = samplePlan();
    expect(setScenarioOverride(plan, 'missing', 'repayment.voluntaryStart.months', 1)).toBe(plan);
    expect(setScenarioOverride(plan, 's', '__proto__.polluted', 'x')).toBe(plan);
    expect(setScenarioOverride(plan, 's', 'repayment.voluntaryStart.months', {} as unknown as string)).toBe(plan);
    expect(clearScenarioOverride(plan, 'missing', 'repayment.voluntaryStart.months')).toBe(plan);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('applies overrides to a deep copy, ignoring dangling and unsafe keys; base edits flow through', () => {
    const plan = samplePlan();
    const before = structuredClone(plan);
    const applied = applyOverrides(plan, { 'loans.a.annualRate': '0.05', 'loans.gone.principal': '1', '__proto__.x': 'y', 'loans.a.monthlyPayment': '99.00' });
    expect(applied.loans[0]).toMatchObject({ annualRate: '0.05', monthlyPayment: '99.00' });
    expect(plan).toEqual(before);
    plan.loans[0].principal = '6000.00';
    plan.scenarios[0].overrides = { 'loans.a.annualRate': '0.05' };
    expect(applyScenario(plan, plan.scenarios[0]).loans[0]).toMatchObject({ principal: '6000.00', annualRate: '0.05' });
  });
});

describe('overridable paths and pruning', () => {
  it('lists every overridable field with labels and kinds, all resolvable', () => {
    const plan = samplePlan();
    const paths = overridablePaths(plan);
    const byPath = Object.fromEntries(paths.map(item => [item.path, item]));
    expect(byPath['repayment.strategyId']).toMatchObject({ kind: 'choice', options: ['avalanche', 'snowball', 'custom'] });
    expect(byPath['schoolYears.year-1.resources.job.hourlyWage']).toMatchObject({ kind: 'money', label: 'Year 1: Campus job hourly wage' });
    expect(byPath['schoolYears.year-1.resources.grant.amount']).toMatchObject({ label: 'Year 1: grant amount' });
    expect(byPath['schoolYears.year-1.costItems.tuition.amount'].label).toBe('Year 1: Tuition cost');
    expect(byPath['loans.a.annualRate'].kind).toBe('rate');
    expect(byPath['lifeEvents.bonus.allocationPercent']).toBeDefined();
    expect(byPath['lifeEvents.grant3.allocationPercent']).toBeUndefined();
    expect(byPath['lifeEvents.grant3.amount'].label).toBe('Event: grant3 amount');
    for (const item of paths) expect(isResolvablePath(plan, item.path)).toBe(true);
  });

  it('prunes dangling overrides, custom-order entries and school-year links', () => {
    const plan = samplePlan();
    plan.repayment.customOrder = ['gone', 'a', 'a'];
    plan.scenarios[0].overrides = { 'loans.gone.principal': '1', 'loans.a.principal': '1.00' };
    plan.schoolYears = plan.schoolYears.slice(1);
    const pruned = pruneDanglingReferences(plan);
    expect(pruned.repayment.customOrder).toEqual(['a']);
    expect(pruned.scenarios[0].overrides).toEqual({ 'loans.a.principal': '1.00' });
    expect(pruned.loans[0].schoolYearId).toBeUndefined();
    expect(pruned.lifeEvents[0].schoolYearId).toBe('year-4');
    plan.schoolYears = plan.schoolYears.slice(0, 1);
    expect(pruneDanglingReferences(plan).lifeEvents[0].schoolYearId).toBeUndefined();
  });
});
