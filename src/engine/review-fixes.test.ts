/** Independent-review fixes: M1 (partial results, id paths), m1 (scenario failures), m2 (registry ids), m6 (frozen memo). */
import { describe, it, expect } from 'vitest';
import type { PlannerLoan, PlannerPlan } from './planner-contracts';
import { createDefaultPlan, calculatePlannerOutputs, calculatePlannerProjection, calculatePlannerComparisons } from './planner';
import { isStrategyId, listStrategies } from './strategies/registry';

/** Default plan: repayment starts 2030-11-20. */
const loan = (id: string, name: string, extra: Partial<PlannerLoan> = {}): PlannerLoan => ({
  id, name, type: 'unsubsidized', principal: '10000.00', annualRate: '0.06', disbursementDate: '2029-08-24', termMonths: 120, ...extra,
});
function planWithLateLoan(): PlannerPlan {
  const plan = createDefaultPlan();
  plan.schoolYears[0].costItems = [{ id: 'tuition', category: 'tuition', label: 'Tuition', amount: '20000.00', semester: 'annual' }];
  plan.loans = [loan('early', 'Year 1 loan', { disbursementDate: '2026-08-24' }), loan('late', 'Summer loan', { disbursementDate: '2031-06-01' })];
  return plan;
}

describe('M1: a repayment problem keeps borrowing-phase results', () => {
  it('returns year summaries and a timeline with repayment unavailable and a named, id-based reason', () => {
    const result = calculatePlannerOutputs(planWithLateLoan());
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const outputs = result.value;
    expect(outputs.repayment).toBeNull();
    expect(outputs.minimumTotal).toBeNull();
    expect(outputs.paymentShortfall).toBeNull();
    expect(outputs.years[0]).toMatchObject({ costs: '20000.00', gap: '20000.00', borrowed: '10000.00' });
    expect(outputs.repaymentUnavailable?.errors).toEqual([expect.objectContaining({ path: 'loans.late.disbursementDate', code: 'OUT_OF_RANGE' })]);
    expect(outputs.repaymentUnavailable?.reason).toBe('Loan "Summer loan": disbursement (2031-06-01) must be on or before repayment starts (2030-11-20).');
    expect(outputs.timeline.map(entry => entry.type)).toEqual(['school', 'school', 'school', 'school', 'graduation', 'repayment']);
  });

  it('keeps calculatePlannerProjection backward compatible: same failure shape, now with id paths', () => {
    const result = calculatePlannerProjection(planWithLateLoan());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map(error => error.path)).toEqual(['loans.late.disbursementDate']);
    const valid = createDefaultPlan();
    valid.loans = [loan('a', 'A')];
    const outputs = calculatePlannerOutputs(valid);
    const projection = calculatePlannerProjection(valid);
    if (!outputs.ok || !projection.ok) throw new Error('projection failed');
    expect(outputs.value.repaymentUnavailable).toBeNull();
    const { repaymentUnavailable: _none, ...shared } = outputs.value;
    expect(projection.value).toEqual(shared);
  });

  it('still fails outright for invalid planner inputs (the store rejects these before they reach results)', () => {
    const plan = planWithLateLoan();
    plan.postGradIncome.monthlyDebtBudget = 'abc';
    expect(calculatePlannerOutputs(plan)).toMatchObject({ ok: false, errors: [{ path: 'postGradIncome.monthlyDebtBudget' }] });
  });
});

describe('m1: scenarios that cannot be projected are reported, not dropped', () => {
  it('lists the failure with its reason and leaves the range open-ended', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('a', 'Grad loan', { disbursementDate: '2030-01-15' })];
    plan.scenarios = [
      { id: 'faster', name: 'Faster', overrides: { 'postGradIncome.monthlyDebtBudget': '600.00' } },
      { id: 'early', name: 'Graduate early', overrides: { 'settings.graduationDate': '2029-05-20', 'repayment.voluntaryStart.months': 0 } },
    ];
    const result = calculatePlannerComparisons(plan);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.value.scenarioComparisons.map(item => item.id)).toEqual(['faster']);
    expect(result.value.scenarioFailures).toEqual([{
      id: 'early', name: 'Graduate early',
      errors: [expect.objectContaining({ path: 'loans.a.disbursementDate' })],
      reason: 'Loan "Grad loan": disbursement (2030-01-15) must be on or before repayment starts (2029-11-20).',
    }]);
    expect(result.value.scenarioRange.earliest).not.toBeNull();
    expect(result.value.scenarioRange.latest).toBeNull();
    plan.scenarios = plan.scenarios.slice(0, 1);
    const ok = calculatePlannerComparisons(plan);
    if (!ok.ok) throw new Error('comparison failed');
    expect(ok.value.scenarioFailures).toEqual([]);
    expect(ok.value.scenarioRange.latest).not.toBeNull();
  });
});

describe('m2: strategy ids come from the registry', () => {
  it('isStrategyId accepts exactly the user-facing registry ids', () => {
    for (const entry of listStrategies()) expect(isStrategyId(entry.id)).toBe(true);
    for (const id of ['input-order', 'best', '', 1, null, undefined]) expect(isStrategyId(id)).toBe(false);
  });
});

describe('m6: memoized projections are deep-frozen', () => {
  it('callers cannot corrupt cached results', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('a', 'A'), loan('b', 'B', { principal: '3000.00' })];
    const first = calculatePlannerProjection(plan);
    if (!first.ok) throw new Error('projection failed');
    const repayment = first.value.repayment;
    expect(Object.isFrozen(repayment)).toBe(true);
    expect(Object.isFrozen(repayment.amortizationSchedule)).toBe(true);
    expect(Object.isFrozen(repayment.amortizationSchedule[0].loans[0])).toBe(true);
    expect(() => (repayment.amortizationSchedule as unknown[]).reverse()).toThrow(TypeError);
    expect(() => { (repayment.loans[0] as { balanceAtRepaymentStart: string }).balanceAtRepaymentStart = '0.00'; }).toThrow(TypeError);
    const again = calculatePlannerProjection(structuredClone(plan));
    if (!again.ok) throw new Error('projection failed');
    expect(again.value.repayment.amortizationSchedule[0].month).toBe(1);
    expect(again.value.repayment).toEqual(repayment);
    // Fresh per-call wrappers stay mutable for the caller.
    expect(Object.isFrozen(first.value.timeline)).toBe(false);
  });
});
