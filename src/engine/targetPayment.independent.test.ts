/**
 * Independent US-506 checks (tester). Expected values: team/tester-expected.md §1–§4 (hand amortization and a
 * separate Python Decimal reference). The solver result is also re-verified through the ordinary projection.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { solveTargetPayment } from './targetPayment';
import { calculatePlannerOutputs } from './planner';
import { D } from './money';
import type { PayoffTarget, PlannerPlan, TargetPaymentResult } from './planner-contracts';
import type { PlannerLoan, PlannerPlan as Plan_, VoluntaryStart } from './planner-contracts';
import { createDefaultPlan } from './planner';

// Plan helpers (shared shape with team/tester-expected.md).
/** Default plan: graduation 2030-05-20; federal repayment period start R = 2030-11-20; first required payment 2030-12-20. */
const FEDERAL_R = '2030-11-20';
const TODAY = '2026-10-16';

const loan = (id: string, principal: string, annualRate: string, extra: Partial<PlannerLoan> = {}): PlannerLoan => ({
  id, name: `Loan ${id}`, type: 'unsubsidized', principal, annualRate, disbursementDate: FEDERAL_R, termMonths: 120, ...extra,
});

function planWith(loans: PlannerLoan[], budget: string, options: { strategyId?: string; customOrder?: string[]; voluntaryStart?: VoluntaryStart } = {}): Plan_ {
  const base = createDefaultPlan();
  return {
    ...base,
    loans,
    postGradIncome: { ...base.postGradIncome, monthlyDebtBudget: budget },
    repayment: {
      ...base.repayment,
      strategyId: options.strategyId ?? 'avalanche',
      customOrder: options.customOrder ?? [],
      extraMonthlyPayment: '0.00',
      payoffTarget: { mode: 'budget' },
      voluntaryStart: options.voluntaryStart ?? { kind: 'afterGraduation', months: 6 },
    },
    lifeEvents: [],
    scenarios: [],
  };
}


type Target = Exclude<PayoffTarget, { mode: 'budget' }>;
const months = (n: number): Target => ({ mode: 'target', kind: 'duration', months: n });
const byDate = (date: string): Target => ({ mode: 'target', kind: 'date', date });

function feasible(result: TargetPaymentResult) {
  if (result.status !== 'feasible') throw new Error(`expected feasible, got ${JSON.stringify(result)}`);
  return result;
}
function runWithBudget(plan: PlannerPlan, budget: string) {
  const out = calculatePlannerOutputs({ ...plan, postGradIncome: { ...plan.postGradIncome, monthlyDebtBudget: budget } });
  if (!out.ok || !out.value.repayment) throw new Error(JSON.stringify(out));
  return out.value.repayment;
}

describe('US-506 zero interest (acceptance)', () => {
  const plan = planWith([loan('z', '12000.00', '0')], '400.00');

  it('$12,000 at 0% within 12 months requires exactly $1,000.00', () => {
    const r = feasible(solveTargetPayment(plan, months(12), TODAY));
    expect(r.requiredMonthlyBudget).toBe('1000.00');
    expect(r.verifiedDebtFreeDate).toBe('2031-11-20');
    expect(r.targetDate).toBe('2031-11-20');
    expect(new D(r.totalInterest).toFixed(2)).toBe('0.00');
  });

  it('the same target by date gives the same requirement', () => {
    expect(feasible(solveTargetPayment(plan, byDate('2031-11-20'), TODAY)).requiredMonthlyBudget).toBe('1000.00');
  });

  it('rounds up to the cent: 11 months needs $1,090.91 (1,090.90 misses)', () => {
    expect(feasible(solveTargetPayment(plan, months(11), TODAY)).requiredMonthlyBudget).toBe('1090.91');
    expect(runWithBudget(plan, '1090.90').debtFreeDate).toBe('2031-11-20');
    expect(runWithBudget(plan, '1090.91').debtFreeDate).toBe('2031-10-20');
  });

  it('reports required, chosen and difference without changing the chosen budget', () => {
    const before = JSON.stringify(plan);
    const r = feasible(solveTargetPayment(plan, months(12), TODAY));
    expect(r.chosenMonthlyBudget).toBe('400.00');
    expect(r.difference).toBe('600.00');
    expect(JSON.stringify(plan)).toBe(before);
  });
});

describe('US-506 single interest-bearing loan ($10,000 at 6%, 24 months)', () => {
  const plan = planWith([loan('s', '10000.00', '0.06')], '300.00');

  it('equals the amortization formula rounded up to cents (443.2061… → 443.21)', () => {
    const r = feasible(solveTargetPayment(plan, months(24), TODAY));
    expect(r.requiredMonthlyBudget).toBe('443.21');
    expect(r.verifiedDebtFreeDate).toBe('2032-11-20');
    expect(r.totalInterest).toBe('636.94');
    expect(r.difference).toBe('143.21');
  });

  it('hand amortization: 443.21 pays off in 24 payments, 443.20 needs 25', () => {
    const ok = runWithBudget(plan, '443.21');
    expect(ok.amortizationSchedule).toHaveLength(24);
    expect(ok.amortizationSchedule[0].loans[0]).toMatchObject({ interest: '50.00', principal: '393.21', remainingBalance: '9606.79' });
    expect(ok.amortizationSchedule[1].loans[0]).toMatchObject({ interest: '48.03', principal: '395.18', remainingBalance: '9211.61' });
    expect(ok.amortizationSchedule[2].loans[0]).toMatchObject({ interest: '46.06', remainingBalance: '8814.46' });
    expect(ok.amortizationSchedule[23].loans[0]).toMatchObject({ payment: '443.11', interest: '2.20', remainingBalance: '0.00' });
    expect(ok.totalInterestPaid).toBe('636.94');
    const short = runWithBudget(plan, '443.20');
    expect(short.amortizationSchedule).toHaveLength(25);
    expect(short.amortizationSchedule[24].payment).toBe('0.18');
  });
});

describe('US-506 two-loan avalanche target (36 months)', () => {
  const loans = [loan('hi', '5000.00', '0.07'), loan('lo', '8000.00', '0.04')];

  it('avalanche requires $387.16, total interest $937.58, high-rate loan paid off in month 18', () => {
    const plan = planWith(loans, '139.05');
    const r = feasible(solveTargetPayment(plan, months(36), TODAY));
    expect(r.requiredMonthlyBudget).toBe('387.16');
    expect(r.verifiedDebtFreeDate).toBe('2033-11-20');
    expect(r.totalInterest).toBe('937.58');
    const run = runWithBudget(plan, '387.16');
    const hiPaid = run.amortizationSchedule.find(row => row.loans.some(l => l.loanId === 'hi' && l.remainingBalance === '0.00'));
    expect(hiPaid?.month).toBe(18);
    expect(runWithBudget(plan, '387.15').amortizationSchedule).toHaveLength(37);
  });

  it('respects the strategy: lowest-rate-first custom order needs $393.72', () => {
    const plan = planWith(loans, '139.05', { strategyId: 'custom', customOrder: ['lo', 'hi'] });
    const r = feasible(solveTargetPayment(plan, months(36), TODAY));
    expect(r.requiredMonthlyBudget).toBe('393.72');
    expect(r.totalInterest).toBe('1173.73');
  });
});

describe('US-506 invalid and infeasible targets, simulation cap', () => {
  const plan = planWith([loan('s', '10000.00', '0.06')], '300.00');

  it('rejects a past target date', () => {
    expect(solveTargetPayment(plan, byDate('2026-01-01'), TODAY)).toMatchObject({ status: 'invalid', reason: 'pastTarget' });
  });
  it('identifies a target before the first voluntary payment as infeasible', () => {
    expect(solveTargetPayment(plan, byDate('2030-12-19'), TODAY)).toMatchObject({ status: 'infeasible', reason: 'targetBeforeFirstPayment' });
  });
  it.each([0, 1201, 2.5, -3])('rejects duration %s months', n => {
    expect(solveTargetPayment(plan, months(n), TODAY)).toMatchObject({ status: 'invalid', reason: 'invalidTarget' });
  });
  it('a target beyond the internal 1200-month cap is infeasible (beyondSimulationCap)', () => {
    expect(solveTargetPayment(plan, byDate('2131-01-20'), TODAY)).toMatchObject({ status: 'infeasible', reason: 'beyondSimulationCap' });
  });
  it('missing inputs (no loans) are reported, not solved', () => {
    expect(solveTargetPayment(planWith([], '300.00'), months(12), TODAY).status).not.toBe('feasible');
  });

  it('budget mode: interest-only-plus-a-cent stops at the 1200-month cap as "not found", never as paid off', () => {
    const out = calculatePlannerOutputs(planWith([loan('c', '100000.00', '0.06')], '500.01'));
    if (!out.ok || !out.value.repayment) throw new Error('no projection');
    const r = out.value.repayment;
    expect(r.status).toBe('horizonExceeded');
    expect(r.amortizationSchedule).toHaveLength(1200);
    expect(r.amortizationSchedule[1199].remainingBalance).toBe('99266.46');
    expect(r.debtFreeDate).toBeNull();
    expect(r.totalInterestPaid).toBeNull();
    const warning = r.warnings.find(w => w.code === 'HORIZON_EXCEEDED');
    expect(warning?.message).toMatch(/100 years/);
    expect(warning?.message).toMatch(/not forgiveness/i);
  });
});

describe('US-506 property: the solver returns the smallest verified cent amount', () => {
  it('run(required) meets the target and run(required − 0.01) does not', () => {
    fc.assert(fc.property(
      fc.integer({ min: 100_00, max: 40_000_00 }), fc.integer({ min: 0, max: 12 }), fc.integer({ min: 6, max: 120 }),
      (principalCents, ratePercent, n) => {
        const principal = new D(principalCents).div(100).toFixed(2);
        const plan = planWith([loan('p', principal, new D(ratePercent).div(100).toString())], '0.00');
        const r = feasible(solveTargetPayment(plan, months(n), TODAY));
        const run = runWithBudget(plan, r.requiredMonthlyBudget);
        expect(run.status).toBe('paidOff');
        expect(run.debtFreeDate! <= r.targetDate).toBe(true);
        expect(run.debtFreeDate).toBe(r.verifiedDebtFreeDate);
        const less = new D(r.requiredMonthlyBudget).minus('0.01');
        if (less.gte(0)) {
          const lower = runWithBudget(plan, less.toFixed(2));
          expect(lower.status !== 'paidOff' || lower.debtFreeDate! > r.targetDate).toBe(true);
        }
      }), { numRuns: 25 });
  });
});
