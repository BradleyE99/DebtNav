import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { PlannerLoan, PlannerPlan, TargetPaymentResult } from './planner-contracts';
import { createDefaultPlan, calculatePlannerOutputs } from './planner';
import { solveTargetPayment, targetDateFor, type PayoffTargetGoal } from './targetPayment';
import { D } from './money';

const TODAY = '2026-10-16';
/** Default plan: graduation 2030-05-20, voluntary start = federal repayment start 2030-11-20, first payment 2030-12-20. */
const loan = (id: string, principal: string, annualRate: string, extra: Partial<PlannerLoan> = {}): PlannerLoan => ({
  id, name: id, type: 'unsubsidized', principal, annualRate, disbursementDate: '2030-11-20', termMonths: 120, ...extra,
});
function plan(loans: PlannerLoan[], budget = '100.00', mutate: (p: PlannerPlan) => void = () => {}): PlannerPlan {
  const p = createDefaultPlan();
  p.loans = loans;
  p.postGradIncome.monthlyDebtBudget = budget;
  mutate(p);
  return p;
}
const within = (months: number): PayoffTargetGoal => ({ mode: 'target', kind: 'duration', months });
const by = (date: string): PayoffTargetGoal => ({ mode: 'target', kind: 'date', date });
function feasible(result: TargetPaymentResult) {
  if (result.status !== 'feasible') throw new Error(JSON.stringify(result));
  return result;
}
function project(p: PlannerPlan, budget: string) {
  const out = calculatePlannerOutputs({ ...p, postGradIncome: { ...p.postGradIncome, monthlyDebtBudget: budget }, repayment: { ...p.repayment, extraMonthlyPayment: '0.00' } });
  if (!out.ok || !out.value.repayment) throw new Error(JSON.stringify(out));
  return out.value.repayment;
}
const meets = (p: PlannerPlan, budget: string, targetDate: string) => {
  const r = project(p, budget);
  return r.status === 'paidOff' && r.debtFreeDate !== null && r.debtFreeDate <= targetDate;
};

describe('US-506 solveTargetPayment', () => {
  it('acceptance: $12,000 at 0% with a 12-month target needs $1,000.00', () => {
    const p = plan([loan('z', '12000.00', '0')], '400.00');
    const r = feasible(solveTargetPayment(p, within(12), TODAY));
    expect(r).toMatchObject({ requiredMonthlyBudget: '1000.00', chosenMonthlyBudget: '400.00', difference: '600.00', targetDate: '2031-11-20', verifiedDebtFreeDate: '2031-11-20', totalInterest: '0.00' });
    expect(r.iterations).toBeGreaterThan(1);
  });

  it('single interest-bearing loan equals the closed-form amortization payment rounded up to the cent', () => {
    for (const [principal, rate, n] of [['25000.00', '0.0653', 60], ['8000.00', '0.11', 18], ['40000.00', '0.045', 120]] as const) {
      const p = plan([loan('a', principal, rate)]);
      const r = new D(rate).div(12);
      // M = P·r / (1 − (1 + r)^−n), rounded up to whole cents.
      const closedForm = new D(principal).times(r).div(new D(1).minus(r.plus(1).pow(-n))).toDecimalPlaces(2, D.ROUND_UP);
      const result = feasible(solveTargetPayment(p, within(n), TODAY));
      // Monthly interest is rounded to cents, so the simulated answer may differ from the formula by a cent.
      expect(new D(result.requiredMonthlyBudget).minus(closedForm).abs().lte('0.01')).toBe(true);
      // Verify: the answer pays off in n payments and one cent less does not.
      expect(project(p, result.requiredMonthlyBudget).amortizationSchedule).toHaveLength(n);
      expect(meets(p, new D(result.requiredMonthlyBudget).minus('0.01').toFixed(2), result.targetDate)).toBe(false);
    }
  });

  it('multi-loan avalanche: the extra goes to the highest rate, and the custom order needs more', () => {
    const loans = [loan('hi', '6000.00', '0.08'), loan('mid', '4000.00', '0.06'), loan('lo', '9000.00', '0.03')];
    const avalanche = feasible(solveTargetPayment(plan(loans), within(48), TODAY));
    const lowFirst = feasible(solveTargetPayment(plan(loans, '100.00', p => { p.repayment.strategyId = 'custom'; p.repayment.customOrder = ['lo', 'mid', 'hi']; }), within(48), TODAY));
    expect(new D(lowFirst.requiredMonthlyBudget).gt(avalanche.requiredMonthlyBudget)).toBe(true);
    const run = project(plan(loans), avalanche.requiredMonthlyBudget);
    const paidOrder = ['hi', 'mid', 'lo'].map(id => run.amortizationSchedule.findIndex(row => row.loans.some(l => l.loanId === id && l.remainingBalance === '0.00')));
    expect(paidOrder[0]).toBeLessThan(paidOrder[2]);
    expect(run.debtFreeDate! <= avalanche.targetDate).toBe(true);
  });

  it('includes life events: a windfall lowers the required budget', () => {
    const loans = [loan('a', '15000.00', '0.06')];
    const without = feasible(solveTargetPayment(plan(loans), within(36), TODAY));
    const withBonus = feasible(solveTargetPayment(plan(loans, '100.00', p => {
      p.lifeEvents = [{ id: 'bonus', name: 'Bonus', date: '2031-06-01', type: 'windfall', amount: '3000.00', allocationPercent: '100' }];
    }), within(36), TODAY));
    expect(new D(withBonus.requiredMonthlyBudget).lt(without.requiredMonthlyBudget)).toBe(true);
  });

  it('uses the US-507 timing: an early voluntary start lowers the payment and dates count from the first voluntary payment', () => {
    const loans = [loan('s', '12000.00', '0.05', { type: 'subsidized', disbursementDate: '2029-08-24' })];
    const early = plan(loans, '100.00', p => { p.repayment.voluntaryStart = { kind: 'afterGraduation', months: 0 }; });
    expect(targetDateFor(early, within(12))).toBe('2031-05-20');
    const r = feasible(solveTargetPayment(early, by('2031-11-20'), TODAY));
    const onTime = feasible(solveTargetPayment(plan(loans), by('2031-11-20'), TODAY));
    expect(new D(r.requiredMonthlyBudget).lt(onTime.requiredMonthlyBudget)).toBe(true);
  });

  it('never mutates the plan or the chosen budget', () => {
    const p = plan([loan('a', '5000.00', '0.05')], '250.00', q => { q.repayment.extraMonthlyPayment = '25.00'; });
    const before = JSON.stringify(p);
    const r = feasible(solveTargetPayment(p, within(12), TODAY));
    expect(JSON.stringify(p)).toBe(before);
    expect(r.chosenMonthlyBudget).toBe('275.00');
    expect(new D(r.difference).eq(new D(r.requiredMonthlyBudget).minus('275.00'))).toBe(true);
  });

  it('a negative difference means the chosen budget already reaches the target', () => {
    const r = feasible(solveTargetPayment(plan([loan('a', '1200.00', '0')], '500.00'), within(12), TODAY));
    expect(r.requiredMonthlyBudget).toBe('100.00');
    expect(r.difference).toBe('-400.00');
  });

  it('rejects past, invalid and out-of-range targets; reports infeasible ones', () => {
    const p = plan([loan('a', '5000.00', '0.05')]);
    expect(solveTargetPayment(p, by('2026-10-15'), TODAY)).toMatchObject({ status: 'invalid', reason: 'pastTarget', errors: [{ path: 'repayment.payoffTarget.date' }] });
    expect(solveTargetPayment(p, by('2031-02-30'), TODAY)).toMatchObject({ status: 'invalid', reason: 'invalidTarget' });
    for (const n of [0, -1, 1.5, 1201]) {
      expect(solveTargetPayment(p, within(n), TODAY)).toMatchObject({ status: 'invalid', reason: 'invalidTarget', errors: [{ path: 'repayment.payoffTarget.months' }] });
    }
    expect(solveTargetPayment(p, by('2030-12-01'), TODAY)).toMatchObject({ status: 'infeasible', reason: 'targetBeforeFirstPayment' });
    expect(solveTargetPayment(p, by('2140-01-01'), TODAY)).toMatchObject({ status: 'infeasible', reason: 'beyondSimulationCap' });
    expect(solveTargetPayment(plan([]), within(12), TODAY)).toMatchObject({ status: 'invalid', reason: 'missingInputs' });
    expect(solveTargetPayment(plan([loan('a', '5000.00', '0.05')], 'abc'), within(12), TODAY)).toMatchObject({ status: 'invalid', reason: 'missingInputs' });
  });

  it('within 1200 months is feasible (the cap itself is reachable)', () => {
    const r = feasible(solveTargetPayment(plan([loan('a', '50000.00', '0.07')]), within(1200), TODAY));
    // Just above the interest-only payment (50000 × 0.07 / 12 = 291.67).
    expect(new D(r.requiredMonthlyBudget).gt('291.67')).toBe(true);
    expect(new D(r.requiredMonthlyBudget).lt('300.00')).toBe(true);
  });
});

describe('US-506 property (fast-check): smallest cent budget that meets the target', () => {
  const loanArb = fc.record({
    cents: fc.integer({ min: 1_00, max: 60_000_00 }),
    basisPoints: fc.integer({ min: 0, max: 1500 }),
    subsidized: fc.boolean(),
    term: fc.integer({ min: 12, max: 240 }),
  });
  it('run(required) pays off by the target and run(required − $0.01) does not', () => {
    fc.assert(fc.property(fc.array(loanArb, { minLength: 1, maxLength: 3 }), fc.integer({ min: 1, max: 180 }), fc.integer({ min: 0, max: 12 }),
      fc.constantFrom('avalanche', 'snowball'), (items, months, startMonths, strategyId) => {
        const p = plan(items.map((item, i) => loan(`l${i}`, new D(item.cents).div(100).toFixed(2), new D(item.basisPoints).div(10000).toString(), {
          type: item.subsidized ? 'subsidized' : 'unsubsidized', termMonths: item.term, disbursementDate: '2029-08-24',
        })), '0.00', q => { q.repayment.strategyId = strategyId; q.repayment.voluntaryStart = { kind: 'afterGraduation', months: startMonths }; });
        const r = feasible(solveTargetPayment(p, within(months), TODAY));
        expect(meets(p, r.requiredMonthlyBudget, r.targetDate)).toBe(true);
        expect(project(p, r.requiredMonthlyBudget).debtFreeDate).toBe(r.verifiedDebtFreeDate);
        if (new D(r.requiredMonthlyBudget).gt(0)) expect(meets(p, new D(r.requiredMonthlyBudget).minus('0.01').toFixed(2), r.targetDate)).toBe(false);
      }), { numRuns: 40 });
  });
});
