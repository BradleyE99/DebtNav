/** US-507 required-payment timing and voluntary start; US-1006 remaining gap. */
import { describe, it, expect } from 'vitest';
import type { PlannerLoan, PlannerPlan } from './planner-contracts';
import { createDefaultPlan, calculatePlannerOutputs, type PlannerOutputs } from './planner';
import { loanPaymentTiming, oneMonthBefore, countMissedPayments, voluntaryStartDate, firstVoluntaryPaymentDate } from './paymentTiming';
import { D, sum } from './money';

/** Default plan: graduation 2030-05-20; federal R = 2030-11-20; voluntary start 6 months after graduation. */
const loan = (id: string, principal: string, annualRate: string, extra: Partial<PlannerLoan> = {}): PlannerLoan => ({
  id, name: id, type: 'unsubsidized', principal, annualRate, disbursementDate: '2029-08-24', termMonths: 120, ...extra,
});
function plan(loans: PlannerLoan[], budget = '400.00', mutate: (p: PlannerPlan) => void = () => {}): PlannerPlan {
  const p = createDefaultPlan();
  p.loans = loans;
  p.postGradIncome.monthlyDebtBudget = budget;
  mutate(p);
  return p;
}
const startAt = (months: number) => (p: PlannerPlan) => { p.repayment.voluntaryStart = { kind: 'afterGraduation', months }; };
function outputs(p: PlannerPlan): PlannerOutputs & { repayment: NonNullable<PlannerOutputs['repayment']> } {
  const out = calculatePlannerOutputs(p);
  if (!out.ok || !out.value.repayment) throw new Error(JSON.stringify(out.ok ? out.value.repaymentUnavailable : out.errors));
  return out.value as PlannerOutputs & { repayment: NonNullable<PlannerOutputs['repayment']> };
}

describe('loanPaymentTiming', () => {
  const p = createDefaultPlan();
  it('federal default: graduation + 6 months (34 CFR 685.207), first payment one month later, labeled estimate', () => {
    expect(loanPaymentTiming(p, loan('a', '1', '0'))).toMatchObject({ repaymentPeriodStart: '2030-11-20', firstRequiredPaymentDate: '2030-12-20', basis: 'federalDefault' });
    expect(loanPaymentTiming(p, loan('a', '1', '0')).assumption).toMatch(/Estimated.*6 months/);
    expect(loanPaymentTiming(p, loan('a', '1', '0', { type: 'subsidized', requiredPayment: { graceMonths: 2 } })).basis).toBe('federalDefault');
  });
  it('an actual first due date overrides every estimate', () => {
    for (const type of ['subsidized', 'private'] as const) {
      expect(loanPaymentTiming(p, loan('a', '1', '0', { type, requiredPayment: { firstDueDate: '2031-01-15', graceMonths: 3, inSchoolPayments: true } })))
        .toMatchObject({ repaymentPeriodStart: '2030-12-15', firstRequiredPaymentDate: '2031-01-15', basis: 'actualDueDate', assumption: null });
    }
  });
  it('private/other: in-school payments, loan grace, or not configured (no invented 6-month default)', () => {
    expect(loanPaymentTiming(p, loan('a', '1', '0', { type: 'private', requiredPayment: { inSchoolPayments: true, graceMonths: 6 } })))
      .toMatchObject({ repaymentPeriodStart: '2029-08-24', firstRequiredPaymentDate: '2029-09-24', basis: 'inSchool' });
    expect(loanPaymentTiming(p, loan('a', '1', '0', { type: 'other', requiredPayment: { graceMonths: 0 } })))
      .toMatchObject({ repaymentPeriodStart: '2030-05-20', firstRequiredPaymentDate: '2030-06-20', basis: 'loanGrace' });
    expect(loanPaymentTiming(p, loan('a', '1', '0', { type: 'private' })))
      .toEqual({ loanId: 'a', repaymentPeriodStart: null, firstRequiredPaymentDate: null, basis: 'notConfigured', assumption: null });
  });
  it('oneMonthBefore inverts the month convention, keeping month ends', () => {
    expect(oneMonthBefore('2031-01-15')).toBe('2030-12-15');
    expect(oneMonthBefore('2030-06-30')).toBe('2030-05-31');
    expect(oneMonthBefore('2032-03-29')).toBe('2032-02-29');
    expect(oneMonthBefore('2031-03-30')).toBe('2031-02-28');
    expect(oneMonthBefore('2031-01-31')).toBe('2030-12-31');
  });
  it('voluntary start: months after graduation or an explicit date', () => {
    expect(voluntaryStartDate(p)).toBe('2030-11-20');
    const dated = { ...p, repayment: { ...p.repayment, voluntaryStart: { kind: 'date' as const, date: '2030-07-01' } } };
    expect(voluntaryStartDate(dated)).toBe('2030-07-01');
    expect(firstVoluntaryPaymentDate(dated)).toBe('2030-08-01');
    expect(countMissedPayments('2030-12-20', '2031-03-20')).toBe(3);
    expect(countMissedPayments('2030-12-20', '2030-12-20')).toBe(0);
  });
});

describe('US-507 projection timing', () => {
  it('on-time start reports the timing and no missed obligations', () => {
    const out = outputs(plan([loan('a', '10000.00', '0.0653')]));
    expect(out.firstVoluntaryPaymentDate).toBe('2030-12-20');
    expect(out.paymentTiming).toHaveLength(1);
    expect(out.missedObligations).toEqual([]);
    expect(out.repayment.firstPaymentDate).toBe('2030-12-20');
  });

  it('early start, unsubsidized: interest accrues in grace, voluntary payments reduce it, capitalization and minimum happen at R', () => {
    const late = outputs(plan([loan('a', '10000.00', '0.06')], '0.00', startAt(0)));
    // With no payments, nothing changes before R: the minimum is computed from the balance at R.
    const atR = late.repayment.loans[0];
    expect(new D(atR.capitalizedInterest).gt(0)).toBe(true);
    expect(new D(atR.balanceAtRepaymentStart).eq(new D(atR.originalPrincipal).plus(atR.capitalizedInterest))).toBe(true);
    expect(late.repayment.amortizationSchedule.slice(0, 6).every(row => row.payment === '0.00')).toBe(true);
    // A budget in grace pays interest first, then principal; no minimum is required before R.
    const early = outputs(plan([loan('a', '10000.00', '0.06')], '400.00', startAt(0)));
    const first = early.repayment.amortizationSchedule[0].loans[0];
    expect(first.payment).toBe('400.00');
    expect(new D(first.interest).gt(0)).toBe(true);
    expect(new D(early.repayment.totalInterestPaid!).lt(outputs(plan([loan('a', '10000.00', '0.06')])).repayment.totalInterestPaid!)).toBe(true);
    expect(early.missedObligations).toEqual([]);
  });

  it('early start with capitalizeInterest false keeps grace interest separate (never capitalized)', () => {
    const out = outputs(plan([loan('a', '10000.00', '0.06', { capitalizeInterest: false })], '0.00', startAt(0)));
    expect(out.repayment.loans[0].capitalizedInterest).toBe('0.00');
    expect(out.repayment.loans[0].balanceAtRepaymentStart).toBe('10000.00');
  });

  it('subsidized loans accrue nothing through R; 2012-07-01..2014-07-01 loans owe grace interest after graduation (labeled exception)', () => {
    const normal = outputs(plan([loan('s', '6000.00', '0.05', { type: 'subsidized' })], '100.00', startAt(0)));
    expect(normal.repayment.amortizationSchedule.slice(0, 6).map(row => row.interest)).toEqual(Array(6).fill('0.00'));
    const window = outputs(plan([loan('s', '6000.00', '0.05', { type: 'subsidized', disbursementDate: '2013-01-15' })], '100.00', p => {
      p.settings.startDate = '2012-08-24'; p.settings.graduationDate = '2016-05-20';
      p.schoolYears = [];
      p.repayment.voluntaryStart = { kind: 'afterGraduation', months: 0 };
    }));
    // Nothing accrues in school; every grace month after graduation charges interest (the first on the full $6,000).
    expect(window.repayment.loans[0].accruedInterest).not.toBe('0.00');
    const graceRows = window.repayment.amortizationSchedule.slice(0, 6);
    expect(graceRows[0].interest).toBe('25.00');
    expect(graceRows.every(row => new D(row.interest).gt(0))).toBe(true);
    expect(normal.repayment.loans[0].accruedInterest).toBe('0.00');
  });

  it('late start: keeps obligations, warns with the count and first missed date, and accrues to the voluntary start', () => {
    const out = outputs(plan([loan('a', '10000.00', '0.0653'), loan('s', '3000.00', '0.05', { type: 'subsidized' })], '400.00', startAt(9)));
    expect(out.missedObligations.map(w => [w.loanId, w.firstMissedDate, w.missedPayments])).toEqual([['a', '2030-12-20', 3], ['s', '2030-12-20', 3]]);
    expect(out.missedObligations[0].message).toMatch(/late fees, delinquency and default/);
    expect(out.repayment.warnings.filter(w => w.code === 'MISSED_REQUIRED_PAYMENT')).toHaveLength(2);
    // The subsidized loan owes interest from R (2030-11-20) to the late start (2031-02-20): 92 days.
    expect(out.repayment.loans[1].accruedInterest).toBe(new D('3000').times('0.05').times(92).div(365).toDecimalPlaces(2).toFixed(2));
  });

  it('private loans: in-school payment terms with a post-graduation start warn; unconfigured loans never do', () => {
    const inSchool = outputs(plan([loan('p', '5000.00', '0.08', { type: 'private', requiredPayment: { inSchoolPayments: true } })]));
    expect(inSchool.missedObligations[0]).toMatchObject({ firstMissedDate: '2029-09-24', missedPayments: 15 });
    expect(outputs(plan([loan('p', '5000.00', '0.08', { type: 'private' })], '400.00', startAt(0))).missedObligations).toEqual([]);
  });

  it('a loan disbursed after the voluntary start enters the grid at its disbursement and pays one month later', () => {
    const out = outputs(plan([loan('a', '4000.00', '0.05', { disbursementDate: '2028-08-24' }), loan('b', '3000.00', '0.05', { disbursementDate: '2029-08-24' })], '200.00', p => {
      p.repayment.voluntaryStart = { kind: 'date', date: '2029-01-01' };
    }));
    const rows = out.repayment.amortizationSchedule;
    const firstB = rows.findIndex(row => row.loans.some(l => l.loanId === 'b'));
    // Disbursed 2029-08-24: enters at grid date 2029-09-01 (interest accrued daily to then), first payment 2029-10-01.
    expect(rows[firstB].date).toBe('2029-10-01');
    expect(rows.slice(0, firstB).every(row => row.loans.every(l => l.loanId === 'a'))).toBe(true);
    // Both loans are fully repaid; principal paid equals each loan's balance.
    for (const start of out.repayment.loans) {
      const loanRows = rows.flatMap(row => row.loans.filter(l => l.loanId === start.loanId));
      expect(loanRows.at(-1)!.remainingBalance).toBe('0.00');
      expect(sum(loanRows.map(l => l.principal)).gte(start.originalPrincipal)).toBe(true);
    }
  });

  it('the simulation cap message never implies forgiveness', () => {
    // $63,723.29 at R after capitalization: interest $265.51/month, so $265.60 amortizes far past the 100-year cap.
    const out = outputs(plan([loan('a', '60000.00', '0.05')], '265.60'));
    expect(out.repayment.status).toBe('horizonExceeded');
    expect(out.repayment.warnings.at(-1)!.message).toMatch(/No payoff found within the modeled limit of 100 years.*not forgiveness/);
  });
});

describe('US-1006 remaining = max(0, gap − borrowed)', () => {
  it('uses the gap (not gap + buffer) and never goes below zero', () => {
    const p = createDefaultPlan();
    const [year] = p.schoolYears;
    year.costItems = [{ id: 'c', category: 'tuition', label: 'Tuition', amount: '10000.00', semester: 'annual' }];
    year.bufferPercent = '10';
    p.loans = [loan('a', '4000.00', '0.05', { academicYear: '2026-2027', disbursementDate: year.startDate })];
    let summary = calculatePlannerOutputs(p);
    if (!summary.ok) throw new Error('failed');
    expect(summary.value.years[0]).toMatchObject({ gap: '10000.00', bufferedGap: '11000.00', borrowed: '4000.00', remaining: '6000.00' });
    p.loans[0].principal = '10500.00';
    summary = calculatePlannerOutputs(p);
    if (!summary.ok) throw new Error('failed');
    expect(summary.value.years[0]).toMatchObject({ borrowed: '10500.00', remaining: '0.00' });
    expect(summary.value.years[1]).toMatchObject({ gap: '0.00', borrowed: '0.00', remaining: '0.00' });
  });
});
