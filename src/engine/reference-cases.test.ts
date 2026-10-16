/**
 * Independent reference cases (tester). Expected values were computed outside the engine with a
 * standalone decimal script that follows docs/REQUIREMENTS.md §8 (monthly interest = round half-up
 * of balance × rate / 12, M = P·r / (1 − (1 + r)^−n), simple daily in-school accrual over 365,
 * extra payments after minimums in strategy order, final payment absorbs the remainder). They are
 * hard-coded here on purpose: this file must never derive an expectation from the engine itself.
 *
 * Default plan dates: graduation 2030-05-20 + 6 months grace → repayment starts 2030-11-20 and
 * payment n falls on 2030-11-20 + n months.
 */
import { describe, it, expect } from 'vitest';
import type { PlannerLoan, PlannerPlan, CostItem, Resource } from './planner-contracts';
import type { Projection } from './contracts';
import { createDefaultPlan, calculatePlannerOutputs, type PlannerOutputs } from './planner';
import { D, sum } from './money';

const REPAYMENT_START = '2030-11-20';

const loan = (id: string, principal: string, annualRate: string, extra: Partial<PlannerLoan> = {}): PlannerLoan => ({
  id, name: id, type: 'subsidized', principal, annualRate, disbursementDate: REPAYMENT_START, termMonths: 120, ...extra,
});
const cost = (id: string, amount: string): CostItem => ({ id, category: 'tuition', label: id, amount, semester: 'annual' });
const resource = (id: string, type: Resource['type'], amount: string, extra: Partial<Resource> = {}): Resource => ({
  id, type, label: id, amount, incomeMode: 'fixed', hourlyWage: '0.00', hoursPerWeek: '0', weeksWorked: '0', unavailablePercent: '0', ...extra,
});

function planWith(loans: PlannerLoan[], budget: string, edit: (plan: PlannerPlan) => void = () => {}): PlannerPlan {
  const plan = createDefaultPlan();
  plan.loans = loans;
  plan.postGradIncome.monthlyDebtBudget = budget;
  edit(plan);
  return plan;
}
function outputs(plan: PlannerPlan): PlannerOutputs {
  const result = calculatePlannerOutputs(plan);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}
function repayment(plan: PlannerPlan): Projection {
  const value = outputs(plan).repayment;
  if (!value) throw new Error(JSON.stringify(outputs(plan).repaymentUnavailable));
  return value;
}
const firstPayoffMonth = (projection: Projection, loanId: string) =>
  projection.amortizationSchedule.find(row => row.loans.some(l => l.loanId === loanId && new D(l.remainingBalance).isZero()))?.month;

describe('reference: standard amortization (US-502, US-503, US-504)', () => {
  const plan = planWith([loan('std', '30000.00', '0.065')], '340.64');

  it('minimum payment for $30,000 at 6.5% over 120 months is $340.64', () => {
    expect(repayment(plan).loans[0].minimumMonthlyPayment).toBe('340.64');
    expect(outputs(plan).minimumTotal).toBe('340.64');
    expect(outputs(plan).paymentShortfall).toBe('0.00');
  });

  it('pays off in exactly 120 payments with total interest $10,877.41 (within $1 per SRS; exact by reference)', () => {
    const r = repayment(plan);
    expect(r.status).toBe('paidOff');
    expect(r.amortizationSchedule).toHaveLength(120);
    expect(r.debtFreeDate).toBe('2040-11-20');
    expect(r.totalInterestPaid).toBe('10877.41');
  });

  it('first row 340.64 = 162.50 interest + 178.14 principal; final payment is adjusted to $341.25 and ends at $0.00', () => {
    const rows = repayment(plan).amortizationSchedule;
    expect(rows[0]).toMatchObject({ payment: '340.64', interest: '162.50', principal: '178.14', remainingBalance: '29821.86' });
    expect(rows[119]).toMatchObject({ payment: '341.25', interest: '1.84', principal: '339.41', remainingBalance: '0.00' });
  });

  it('principal paid sums to the starting balance to the cent; payments = principal + interest', () => {
    const rows = repayment(plan).amortizationSchedule;
    expect(sum(rows.map(row => row.principal)).toFixed(2)).toBe('30000.00');
    expect(sum(rows.map(row => row.payment)).toFixed(2)).toBe('40877.41');
    for (const row of rows) expect(new D(row.interest).plus(row.principal).toFixed(2)).toBe(row.payment);
  });
});

describe('reference: zero-interest loan', () => {
  it('$1,000 at 0% over 12 months: minimum $83.33, 11 × 83.33 then a final $83.37, zero interest', () => {
    const r = repayment(planWith([loan('zero', '1000.00', '0', { termMonths: 12 })], '83.33'));
    expect(r.loans[0].minimumMonthlyPayment).toBe('83.33');
    expect(r.status).toBe('paidOff');
    expect(r.amortizationSchedule).toHaveLength(12);
    expect(r.amortizationSchedule.slice(0, 11).every(row => row.payment === '83.33' && row.interest === '0.00')).toBe(true);
    expect(r.amortizationSchedule[11]).toMatchObject({ payment: '83.37', remainingBalance: '0.00' });
    expect(r.totalInterestPaid).toBe('0.00');
    expect(r.debtFreeDate).toBe('2031-11-20');
  });

  it('a 0% rate is a valid input (no errors, repayment available)', () => {
    expect(outputs(planWith([loan('zero', '1200.00', '0', { termMonths: 12 })], '100.00')).repaymentUnavailable).toBeNull();
  });
});

describe('reference: in-school accrual and capitalization (US-403, US-404)', () => {
  // Disbursed 2029-11-20, repayment 2030-11-20: 365 days. 5000 × 0.06 × 365/365 = 300.00.
  const unsub = (extra: Partial<PlannerLoan> = {}) => loan('u', '5000.00', '0.06', { type: 'unsubsidized', disbursementDate: '2029-11-20', ...extra });

  it('unsubsidized accrues $300.00 simple interest and capitalizes to $5,300.00', () => {
    const r = repayment(planWith([unsub()], '58.84'));
    expect(r.loans[0]).toMatchObject({ accruedInterest: '300.00', capitalizedInterest: '300.00', balanceAtRepaymentStart: '5300.00', minimumMonthlyPayment: '58.84' });
    expect(r.balanceAtRepaymentStart).toBe('5300.00');
  });

  it('capitalized plan at the $58.84 minimum: 120 payments and total interest $2,060.92 (300.00 accrued + 1,760.92 repayment)', () => {
    const r = repayment(planWith([unsub()], '58.84'));
    expect(r.status).toBe('paidOff');
    expect(r.amortizationSchedule).toHaveLength(120);
    expect(r.totalInterestPaid).toBe('2060.92');
  });

  it('subsidized accrues $0.00 during school and grace', () => {
    const r = repayment(planWith([unsub({ type: 'subsidized' })], '55.51'));
    expect(r.loans[0]).toMatchObject({ accruedInterest: '0.00', balanceAtRepaymentStart: '5000.00', minimumMonthlyPayment: '55.51' });
  });

  it('private loans accrue like unsubsidized by default', () => {
    expect(repayment(planWith([unsub({ type: 'private' })], '58.84')).loans[0].accruedInterest).toBe('300.00');
  });

  it('paying interest while in school: nothing capitalizes, 12 monthly payments ≈ $300 (per-period cent rounding gives 300.01)', () => {
    const r = repayment(planWith([unsub({ payInterestWhileInSchool: true })], '55.51'));
    expect(r.loans[0]).toMatchObject({ capitalizedInterest: '0.00', balanceAtRepaymentStart: '5000.00' });
    expect(r.inSchoolInterestPayments).toHaveLength(12);
    expect(r.inSchoolInterestPayments[0].amount).toBe('24.66'); // 5000 × 0.06 × 30/365
    expect(sum(r.inSchoolInterestPayments.map(p => p.amount)).toFixed(2)).toBe('300.01');
  });

  it('capitalization switched off keeps $5,000 repayment balance while still reporting $300 accrued', () => {
    const r = repayment(planWith([unsub({ capitalizeInterest: false })], '60.00'));
    expect(r.loans[0]).toMatchObject({ accruedInterest: '300.00', capitalizedInterest: '0.00', balanceAtRepaymentStart: '5000.00' });
  });

  it('uncapitalized $300 is repaid first, with no interest charged on it: minimum $58.84, 120 payments, final $45.81, total $2,047.77', () => {
    const r = repayment(planWith([unsub({ capitalizeInterest: false })], '58.84'));
    expect(r.loans[0].minimumMonthlyPayment).toBe('58.84');
    expect(r.status).toBe('paidOff');
    expect(r.amortizationSchedule).toHaveLength(120);
    expect(r.amortizationSchedule.at(-1)).toMatchObject({ payment: '45.81', remainingBalance: '0.00' });
    expect(r.totalInterestPaid).toBe('2047.77');
    // Month 1: $25.00 new interest + $300 carried interest absorb the whole payment.
    expect(r.amortizationSchedule[0]).toMatchObject({ payment: '58.84', interest: '58.84', principal: '0.00' });
  });
});

describe('reference: avalanche vs snowball ordering and rollover (US-601, US-602, US-604)', () => {
  // A: $2,000 @ 8% (min 24.27); B: $1,000 @ 4% (min 10.12); budget $300.
  const loans = () => [loan('a-high', '2000.00', '0.08'), loan('b-small', '1000.00', '0.04')];
  const run = (strategyId: string) => repayment(planWith(loans(), '300.00', plan => { plan.repayment.strategyId = strategyId; }));

  it('minimums are 24.27 and 10.12', () => {
    expect(run('avalanche').loans.map(l => l.minimumMonthlyPayment)).toEqual(['24.27', '10.12']);
  });

  it('avalanche pays the high-rate loan first (month 8), rolls into B (month 11); total interest $84.21', () => {
    const r = run('avalanche');
    expect(firstPayoffMonth(r, 'a-high')).toBe(8);
    expect(firstPayoffMonth(r, 'b-small')).toBe(11);
    expect(r.amortizationSchedule).toHaveLength(11);
    expect(r.totalInterestPaid).toBe('84.21');
    expect(r.debtFreeDate).toBe('2031-10-20');
    // Month 1: B receives only its minimum; all extra goes to A.
    expect(r.amortizationSchedule[0].loans.find(l => l.loanId === 'b-small')?.payment).toBe('10.12');
  });

  it('snowball pays the small balance first (month 4), rolls into A (month 11); total interest $106.89', () => {
    const r = run('snowball');
    expect(firstPayoffMonth(r, 'b-small')).toBe(4);
    expect(firstPayoffMonth(r, 'a-high')).toBe(11);
    expect(r.totalInterestPaid).toBe('106.89');
    expect(r.amortizationSchedule[0].loans.find(l => l.loanId === 'a-high')?.payment).toBe('24.27');
  });

  it('rollover: after the first payoff the whole $300 budget keeps going to debt', () => {
    const r = run('avalanche');
    for (const row of r.amortizationSchedule.slice(0, -1)) expect(row.payment).toBe('300.00');
  });

  it('invariant: avalanche interest ≤ snowball interest', () => {
    expect(new D(run('avalanche').totalInterestPaid!).lte(run('snowball').totalInterestPaid!)).toBe(true);
  });
});

describe('reference: insufficient budgets (US-501, US-505)', () => {
  it('budget $100 below the $162.50 first-month interest: not amortizing, no debt-free date, no total interest', () => {
    const o = outputs(planWith([loan('std', '30000.00', '0.065')], '100.00'));
    expect(o.repayment?.status).toBe('notAmortizing');
    expect(o.repayment?.debtFreeDate).toBeNull();
    expect(o.repayment?.totalInterestPaid).toBeNull();
    expect(o.repayment?.warnings.some(w => w.code === 'NEGATIVE_AMORTIZATION')).toBe(true);
  });

  it('budget exactly equal to interest ($162.50) is still non-payoff', () => {
    expect(repayment(planWith([loan('std', '30000.00', '0.065')], '162.50')).status).toBe('notAmortizing');
  });

  it('budget $0 with a loan is non-payoff', () => {
    expect(repayment(planWith([loan('std', '30000.00', '0.065')], '0.00')).debtFreeDate).toBeNull();
  });

  it('budget $200 below the $340.64 minimum: shortfall $140.64, still pays off in 310 months (final $175.57)', () => {
    const plan = planWith([loan('std', '30000.00', '0.065')], '200.00', p => { p.repayment.maxMonths = 600; });
    const o = outputs(plan);
    expect(o.paymentShortfall).toBe('140.64');
    expect(o.repayment?.status).toBe('paidOff');
    expect(o.repayment?.amortizationSchedule).toHaveLength(310);
    expect(o.repayment?.amortizationSchedule.at(-1)).toMatchObject({ payment: '175.57', remainingBalance: '0.00' });
    expect(o.repayment?.totalInterestPaid).toBe('31975.57');
    expect(o.repayment?.debtFreeDate).toBe('2056-09-20');
  });

  it('same shortfall with a 120-month horizon: horizonExceeded, no debt-free date', () => {
    const r = repayment(planWith([loan('std', '30000.00', '0.065')], '200.00', p => { p.repayment.maxMonths = 120; }));
    expect(r.status).toBe('horizonExceeded');
    expect(r.debtFreeDate).toBeNull();
    expect(r.totalInterestPaid).toBeNull();
  });
});

describe('reference: zero balances', () => {
  it('a $0 loan alone produces an empty schedule (engine reports paidOff at repayment start; UI must gate this)', () => {
    const r = repayment(planWith([loan('empty', '0.00', '0.065')], '400.00'));
    expect(r.amortizationSchedule).toHaveLength(0);
    expect(r.balanceAtRepaymentStart).toBe('0.00');
    expect(r.debtFreeDate).toBe(REPAYMENT_START);
  });

  it('a $0 loan next to a real loan does not change the real loan result', () => {
    const r = repayment(planWith([loan('empty', '0.00', '0.065'), loan('std', '30000.00', '0.065')], '340.64'));
    expect(r.amortizationSchedule).toHaveLength(120);
    expect(r.totalInterestPaid).toBe('10877.41');
  });
});

describe('reference: borrowing gap vs surplus (US-201, US-301–US-305)', () => {
  const yearOf = (edit: (plan: PlannerPlan) => void) => {
    const plan = createDefaultPlan();
    edit(plan);
    return outputs(plan).years[0];
  };

  it('costs 12,000 + 9,500 + 1,200 = 22,700; grant 4,000 + job 15×15×30 = 6,750 + savings 2,000 → gap $9,950.00', () => {
    const y = yearOf(plan => {
      plan.schoolYears[0].costItems = [cost('t', '12000.00'), cost('h', '9500.00'), cost('b', '1200.00')];
      plan.schoolYears[0].resources = [
        resource('g', 'grant', '4000.00'),
        resource('j', 'job', '0.00', { incomeMode: 'hourly', hourlyWage: '15.00', hoursPerWeek: '15', weeksWorked: '30' }),
        resource('s', 'savings', '2000.00'),
      ];
    });
    expect(y).toMatchObject({ costs: '22700.00', resources: '12750.00', gap: '9950.00', surplus: '0.00', bufferedGap: '9950.00' });
  });

  it('5% buffer on a $9,950 gap → $10,447.50', () => {
    const y = yearOf(plan => {
      plan.schoolYears[0].costItems = [cost('t', '9950.00')];
      plan.schoolYears[0].bufferPercent = '5';
    });
    expect(y.bufferedGap).toBe('10447.50');
  });

  it('resources above cost → gap $0.00 and a separate surplus', () => {
    const y = yearOf(plan => {
      plan.schoolYears[0].costItems = [cost('t', '3000.00')];
      plan.schoolYears[0].resources = [resource('g', 'grant', '4000.00')];
    });
    expect(y).toMatchObject({ gap: '0.00', surplus: '1000.00', bufferedGap: '0.00' });
  });

  it('job with 40% unavailable counts only $4,050.00 of $6,750.00', () => {
    const y = yearOf(plan => {
      plan.schoolYears[0].resources = [resource('j', 'job', '0.00', { incomeMode: 'hourly', hourlyWage: '15.00', hoursPerWeek: '15', weeksWorked: '30', unavailablePercent: '40' })];
    });
    expect(y.resources).toBe('4050.00');
  });

  it('a year with no costs and no resources reports $0 gap and $0 surplus (readiness must mark it missing, not funded)', () => {
    expect(yearOf(() => {})).toMatchObject({ costs: '0.00', gap: '0.00', surplus: '0.00' });
  });

  it('unfunded gap is not debt: a plan with costs but no loans has no balance at repayment', () => {
    const plan = createDefaultPlan();
    plan.schoolYears[0].costItems = [cost('t', '20000.00')];
    const o = outputs(plan);
    expect(o.years[0].gap).toBe('20000.00');
    expect(o.repayment?.balanceAtRepaymentStart).toBe('0.00');
  });
});
