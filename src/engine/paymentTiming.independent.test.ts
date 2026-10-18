/**
 * Independent US-102/US-507 checks (tester). Expected values: team/tester-expected.md §5.
 */
import { describe, it, expect } from 'vitest';
import { calculatePlannerOutputs, type PlannerOutputs } from './planner';
import type { PlannerPlan } from './planner-contracts';
import { D } from './money';
import type { PlannerLoan, PlannerPlan as Plan_, VoluntaryStart } from './planner-contracts';
import { createDefaultPlan } from './planner';

// Plan helpers (shared shape with team/tester-expected.md).
/** Default plan: graduation 2030-05-20; federal repayment period start R = 2030-11-20; first required payment 2030-12-20. */
const GRADUATION = '2030-05-20';
const FEDERAL_R = '2030-11-20';

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


function outputs(plan: PlannerPlan): PlannerOutputs {
  const out = calculatePlannerOutputs(plan);
  if (!out.ok) throw new Error(JSON.stringify(out.errors));
  if (!out.value.repayment) throw new Error(JSON.stringify(out.value.repaymentUnavailable));
  return out.value;
}

describe('US-507 early voluntary start (subsidized $12,000 at 5%, budget $1,000)', () => {
  const sub = loan('e', '12000.00', '0.05', { type: 'subsidized', disbursementDate: GRADUATION });
  const early = outputs(planWith([sub], '1000.00', { voluntaryStart: { kind: 'afterGraduation', months: 0 } }));
  const baseline = outputs(planWith([sub], '1000.00', { voluntaryStart: { kind: 'afterGraduation', months: 6 } }));

  it('required dates do not move when payments start early', () => {
    const expected = { loanId: 'e', repaymentPeriodStart: '2030-11-20', firstRequiredPaymentDate: '2030-12-20', basis: 'federalDefault' };
    expect(early.paymentTiming).toEqual([expect.objectContaining(expected)]);
    expect(baseline.paymentTiming).toEqual([expect.objectContaining(expected)]);
    expect(early.paymentTiming[0].assumption).toMatch(/6 months/);
  });

  it('first voluntary payment follows the chosen start', () => {
    expect(early.firstVoluntaryPaymentDate).toBe('2030-06-20');
    expect(baseline.firstVoluntaryPaymentDate).toBe('2030-12-20');
  });

  it('six interest-free early payments reduce the balance to $6,000 at the repayment-period start', () => {
    const rows = early.repayment!.amortizationSchedule;
    expect(rows.slice(0, 6).map(row => [row.date, row.interest, row.payment, row.remainingBalance])).toEqual([
      ['2030-06-20', '0.00', '1000.00', '11000.00'], ['2030-07-20', '0.00', '1000.00', '10000.00'],
      ['2030-08-20', '0.00', '1000.00', '9000.00'], ['2030-09-20', '0.00', '1000.00', '8000.00'],
      ['2030-10-20', '0.00', '1000.00', '7000.00'], ['2030-11-20', '0.00', '1000.00', '6000.00'],
    ]);
    expect(rows.slice(6).map(row => row.interest)).toEqual(['25.00', '20.94', '16.86', '12.76', '8.65', '4.52', '0.37']);
    expect(rows.at(-1)).toMatchObject({ date: '2031-06-20', payment: '89.10', remainingBalance: '0.00' });
    expect(early.repayment!.debtFreeDate).toBe('2031-06-20');
    expect(early.repayment!.totalInterestPaid).toBe('89.10');
    expect(early.repayment!.loans[0].capitalizedInterest).toBe('0.00');
    expect(early.missedObligations).toEqual([]);
  });

  it('baseline without the early start: 13 payments from 2030-12-20, $336.50 interest', () => {
    expect(baseline.repayment!.amortizationSchedule).toHaveLength(13);
    expect(baseline.repayment!.debtFreeDate).toBe('2031-12-20');
    expect(baseline.repayment!.totalInterestPaid).toBe('336.50');
    expect(baseline.missedObligations).toEqual([]);
  });

  it('unsubsidized early start: same required dates, no warnings, never later or costlier (NFR-3)', () => {
    const unsub = loan('u', '10000.00', '0.0653', { disbursementDate: '2029-08-24' });
    const e = outputs(planWith([unsub], '400.00', { voluntaryStart: { kind: 'afterGraduation', months: 0 } }));
    const b = outputs(planWith([unsub], '400.00'));
    expect(e.paymentTiming).toEqual(b.paymentTiming);
    expect(e.missedObligations).toEqual([]);
    expect(e.repayment!.debtFreeDate! <= b.repayment!.debtFreeDate!).toBe(true);
    expect(new D(e.repayment!.totalInterestPaid!).lte(b.repayment!.totalInterestPaid!)).toBe(true);
  });
});

describe('US-507 late voluntary start (unsubsidized $10,000 at 6.53%)', () => {
  const unsub = loan('u1', '10000.00', '0.0653', { disbursementDate: '2029-08-24' });

  it('three months late → one MISSED_REQUIRED_PAYMENT warning with 3 missed payments from 2030-12-20', () => {
    const late = outputs(planWith([unsub], '400.00', { voluntaryStart: { kind: 'afterGraduation', months: 9 } }));
    expect(late.firstVoluntaryPaymentDate).toBe('2031-03-20');
    expect(late.paymentTiming[0]).toMatchObject({ repaymentPeriodStart: '2030-11-20', firstRequiredPaymentDate: '2030-12-20' });
    expect(late.missedObligations).toHaveLength(1);
    expect(late.missedObligations[0]).toMatchObject({ code: 'MISSED_REQUIRED_PAYMENT', loanId: 'u1', firstMissedDate: '2030-12-20', missedPayments: 3 });
    expect(late.missedObligations[0].message).not.toMatch(/\b(ok|fine|allowed|may skip)\b/i);
  });

  it('per brief §5b the late projection equals the old grace-9 projection (accrue to the voluntary start)', () => {
    const late = outputs(planWith([unsub], '400.00', { voluntaryStart: { kind: 'afterGraduation', months: 9 } }));
    expect(late.repayment!.debtFreeDate).toBe('2033-08-20');
    expect(late.repayment!.totalInterestPaid).toBe('1918.79');
    expect(late.repayment!.amortizationSchedule).toHaveLength(30);
  });

  it('on-time start has no warnings (old grace-6 numbers); one month late → 1 missed payment', () => {
    const onTime = outputs(planWith([unsub], '400.00'));
    expect(onTime.missedObligations).toEqual([]);
    expect(onTime.repayment!.debtFreeDate).toBe('2033-05-20');
    expect(onTime.repayment!.totalInterestPaid).toBe('1725.09');
    const oneLate = outputs(planWith([unsub], '400.00', { voluntaryStart: { kind: 'afterGraduation', months: 7 } }));
    expect(oneLate.missedObligations[0]).toMatchObject({ firstMissedDate: '2030-12-20', missedPayments: 1 });
  });
});

describe('US-507 private loan terms', () => {
  it('private loan without configured terms gets no invented 6-month default', () => {
    const out = outputs(planWith([loan('p', '5000.00', '0.08', { type: 'private', disbursementDate: '2028-08-24' })], '200.00'));
    expect(out.paymentTiming[0]).toMatchObject({ basis: 'notConfigured', repaymentPeriodStart: null, firstRequiredPaymentDate: null });
  });
  it('private grace 3 months → R = graduation + 3; actual first due date overrides every estimate', () => {
    const grace = outputs(planWith([loan('p', '5000.00', '0.08', { type: 'private', disbursementDate: '2028-08-24', requiredPayment: { graceMonths: 3 } })], '200.00'));
    expect(grace.paymentTiming[0]).toMatchObject({ basis: 'loanGrace', repaymentPeriodStart: '2030-08-20', firstRequiredPaymentDate: '2030-09-20' });
    const due = outputs(planWith([loan('f', '5000.00', '0.05', { disbursementDate: '2028-08-24', requiredPayment: { firstDueDate: '2031-01-15' } })], '200.00'));
    expect(due.paymentTiming[0]).toMatchObject({ basis: 'actualDueDate', firstRequiredPaymentDate: '2031-01-15', repaymentPeriodStart: '2030-12-15' });
  });
});
