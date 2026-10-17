/**
 * Math review (2026-10-16): regression tests for defects found in the calculation review and for
 * the engine helpers the readiness layer relies on (resourceGrossValue, resourceValue,
 * baseMonthlyBudget, non-payoff statuses). Expected values were recomputed independently.
 */
import { describe, it, expect } from 'vitest';
import type { PlannerLoan, PlannerPlan, PlannerProjection, Resource } from './planner-contracts';
import { createDefaultPlan, calculatePlannerProjection, resourceGrossValue, resourceValue, baseMonthlyBudget } from './planner';

/** Default plan: repayment starts 2030-11-20; first payment 2030-12-20. */
const loan = (id: string, principal: string, annualRate: string, extra: Partial<PlannerLoan> = {}): PlannerLoan => ({
  id, name: id, type: 'unsubsidized', principal, annualRate, disbursementDate: '2029-11-20', termMonths: 120, ...extra,
});
function project(plan: PlannerPlan): PlannerProjection {
  const result = calculatePlannerProjection(plan);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

describe('minimum payment with uncapitalized school interest', () => {
  it('amortizes principal plus separate accrued interest, so paying the minimum ends on the term', () => {
    // $5,000 at 6% accrues $300.00 over 365 days. Before the fix the minimum ($55.51) covered only the
    // $5,000 principal and the loan ran 130 months; amortizing $5,300 over 120 months gives $58.84.
    const plan = createDefaultPlan();
    plan.loans = [loan('a', '5000.00', '0.06', { capitalizeInterest: false })];
    const probe = project(plan);
    expect(probe.repayment.loans[0]).toMatchObject({ accruedInterest: '300.00', capitalizedInterest: '0.00', balanceAtRepaymentStart: '5000.00', minimumMonthlyPayment: '58.84' });
    plan.postGradIncome.monthlyDebtBudget = probe.minimumTotal;
    const atMinimum = project(plan).repayment;
    expect(atMinimum.status).toBe('paidOff');
    expect(atMinimum.amortizationSchedule).toHaveLength(120);
    expect(atMinimum.amortizationSchedule.at(-1)).toMatchObject({ payment: '45.81', remainingBalance: '0.00' });
    expect(atMinimum.totalInterestPaid).toBe('2047.77');
  });

  it('is unchanged for capitalized and paid-in-school interest', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('cap', '5000.00', '0.06'), loan('paid', '5000.00', '0.06', { payInterestWhileInSchool: true })];
    const [cap, paid] = project(plan).repayment.loans;
    expect(cap).toMatchObject({ balanceAtRepaymentStart: '5300.00', minimumMonthlyPayment: '58.84' });
    expect(paid).toMatchObject({ balanceAtRepaymentStart: '5000.00', minimumMonthlyPayment: '55.51' });
  });
});

describe('readiness helpers', () => {
  const job = (extra: Partial<Resource>): Resource => ({
    id: 'j', type: 'job', label: 'Job', amount: '0.00', incomeMode: 'hourly', hourlyWage: '15.00', hoursPerWeek: '15', weeksWorked: '30', unavailablePercent: '40', ...extra,
  });
  it('US-302: gross earnings before the unavailable share, and the share that counts', () => {
    expect(resourceGrossValue(job({})).toFixed(2)).toBe('6750.00');
    expect(resourceValue(job({})).toFixed(2)).toBe('4050.00');
    expect(resourceGrossValue(job({ incomeMode: 'fixed', amount: '1200.50' })).toFixed(2)).toBe('1200.50');
    expect(resourceGrossValue(job({ hourlyWage: '0.00' })).toFixed(2)).toBe('0.00');
  });

  it('base budget = monthlyDebtBudget + legacy extraMonthlyPayment, and the shortfall uses it', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('a', '30000.00', '0.065', { type: 'subsidized', disbursementDate: '2030-11-20' })];
    plan.postGradIncome.monthlyDebtBudget = '300.00';
    plan.repayment.extraMonthlyPayment = '25.00';
    expect(baseMonthlyBudget(plan).toFixed(2)).toBe('325.00');
    expect(project(plan)).toMatchObject({ minimumTotal: '340.64', paymentShortfall: '15.64' });
  });
});

describe('non-payoff statuses', () => {
  const base = () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('a', '30000.00', '0.065', { type: 'subsidized', disbursementDate: '2030-11-20' })];
    return plan;
  };
  it('US-503 reference: $340.64/month pays $30,000 at 6.5% in 120 payments, interest $10,877.41', () => {
    const plan = base();
    plan.postGradIncome.monthlyDebtBudget = '340.64';
    expect(project(plan).repayment).toMatchObject({ status: 'paidOff', debtFreeDate: '2040-11-20', totalInterestPaid: '10877.41' });
  });
  it('budget $0 or below interest is notAmortizing; above interest but too slow is horizonExceeded', () => {
    const plan = base();
    for (const budget of ['0.00', '10.00', '162.50']) { // monthly interest is 30000 × 0.065 / 12 = $162.50
      plan.postGradIncome.monthlyDebtBudget = budget;
      expect(project(plan).repayment).toMatchObject({ status: 'notAmortizing', debtFreeDate: null, totalInterestPaid: null });
    }
    // v4: no user horizon; the internal cap is 1200 months. $0.10 above the interest needs about 1,367 months.
    plan.postGradIncome.monthlyDebtBudget = '162.60';
    const slow = project(plan).repayment;
    expect(slow).toMatchObject({ status: 'horizonExceeded', debtFreeDate: null, totalInterestPaid: null });
    expect(slow.amortizationSchedule).toHaveLength(1200);
    expect(slow.warnings.map(w => w.code)).toContain('HORIZON_EXCEEDED');
  });
  it('a $0 base budget that a later raise makes positive still pays off', () => {
    const plan = base();
    plan.postGradIncome.monthlyDebtBudget = '0.00';
    plan.lifeEvents = [{ id: 'raise', name: 'Raise', date: '2032-01-01', type: 'income', amount: '67000.00', allocationPercent: '50' }];
    // From Jan 2032 the budget is (67000 − 55000) / 12 × 50% = $500.00.
    const result = project(plan).repayment;
    expect(baseMonthlyBudget(plan).isZero()).toBe(true);
    expect(result.status).toBe('paidOff');
    expect(result.amortizationSchedule.find(row => row.date === '2032-01-20')?.payment).toBe('500.00');
  });
});
