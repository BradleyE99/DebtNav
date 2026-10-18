/**
 * Independent acceptance tests for the DebtNav simplification (tester, phase 1).
 *
 * Every expected value below was derived OUTSIDE the engine: by hand arithmetic or by the tester's own
 * decimal reference model (scratchpad tester/ref.py, Python Decimal, ROUND_HALF_UP to cents). Derivations
 * are listed in team/test-plan.md under the matching case id (R1…R12). The engine is never called to
 * produce an expected value.
 *
 * Shared conventions of the reference model (from planner-contracts.ts / the requirements):
 *  - Default plan: school starts 2026-08-24, graduation 2030-05-20, voluntary start = graduation + 6 months
 *    = 2030-11-20, first payment 2030-12-20; federal repayment period start R = 2030-11-20.
 *  - Monthly interest = round_half_up(balance × annualRate / 12, cents); minimum = amortized payment, cents.
 *  - In-school interest (unsubsidized) = round_half_up(principal × rate / 365 × days), capitalized at R.
 *  - Avalanche: required minimums first, extra to the highest rate, freed money rolls forward.
 */
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { calculatePlannerOutputs, createDefaultPlan, type PlannerOutputs } from './planner';
import { solveTargetPayment } from './targetPayment';
import type { CostItem, LifeEvent, PlannerLoan, PlannerPlan, Resource } from './planner-contracts';
import type { AmortizationMonth, Projection } from './contracts';

// ------------------------------------------------------------------------------------------ helpers
const R = '2030-11-20';
const loan = (id: string, principal: string, annualRate: string, extra: Partial<PlannerLoan> = {}): PlannerLoan => ({
  id, name: `Loan ${id}`, type: 'unsubsidized', principal, annualRate, disbursementDate: R, termMonths: 120, academicYear: 'unassigned', ...extra,
});
function plan(loans: PlannerLoan[], budget: string, lifeEvents: LifeEvent[] = []): PlannerPlan {
  const base = createDefaultPlan();
  return {
    ...base,
    loans,
    postGradIncome: { ...base.postGradIncome, annualSalary: '55000.00', monthlyDebtBudget: budget, raiseAllocationPercent: '50' },
    repayment: { ...base.repayment, strategyId: 'avalanche', extraMonthlyPayment: '0.00', customOrder: [], payoffTarget: { mode: 'budget' } },
    lifeEvents,
    scenarios: [],
  };
}
function outputs(p: PlannerPlan): PlannerOutputs {
  const out = calculatePlannerOutputs(p);
  if (!out.ok) throw new Error(JSON.stringify(out.errors));
  return out.value;
}
function repayment(p: PlannerPlan): Projection {
  const r = outputs(p).repayment;
  if (!r) throw new Error('repayment unavailable');
  return r;
}
const sumOf = (values: string[]) => values.reduce((a, b) => a.plus(b), new Decimal(0)).toFixed(2);
const rowAt = (p: Projection, date: string): AmortizationMonth => {
  const row = p.amortizationSchedule.find(r => r.date === date);
  if (!row) throw new Error(`no row ${date}`);
  return row;
};
const cost = (id: string, amount: string): CostItem => ({ id, category: 'tuition', label: id, amount, semester: 'annual' });
const res = (id: string, type: Resource['type'], amount: string, extra: Partial<Resource> = {}): Resource => ({
  id, type, label: id, amount, incomeMode: 'fixed', hourlyWage: '0', hoursPerWeek: '0', weeksWorked: '0', unavailablePercent: '0', ...extra,
});
const event = (id: string, type: LifeEvent['type'], date: string, amount: string, allocationPercent: string): LifeEvent =>
  ({ id, name: id, type, date, amount, allocationPercent, recurrence: 'once' });

// ------------------------------------------------------------------------- R1 annual borrowing
describe('R1 annual borrowing per academic year', () => {
  function borrowingPlan(): PlannerPlan {
    const p = plan([
      loan('y1a', '8000.00', '0.0639', { disbursementDate: '2026-08-24', academicYear: '2026-2027' }),
      loan('y1b', '3000.00', '0.0639', { disbursementDate: '2027-01-10', academicYear: '2026-2027' }),
      // Disbursed in year 1's calendar range but assigned to 2027-2028: counts for year 2 only.
      loan('y2', '1000.00', '0.0639', { disbursementDate: '2027-05-01', academicYear: '2027-2028' }),
    ], '400.00');
    p.schoolYears = p.schoolYears.map((y, i) => i === 0 ? {
      ...y,
      costItems: [cost('tuition', '20000.00'), { ...cost('housing', '5000.00'), category: 'housing' }],
      resources: [
        res('pell', 'grant', '6000.00'),
        res('merit', 'scholarship', '2000.00'),
        // In-school earnings: $15/h × 10 h × 30 weeks = 4,500; 80% available (20% unavailable) → 3,600.
        res('job', 'job', '0.00', { incomeMode: 'hourly', hourlyWage: '15.00', hoursPerWeek: '10', weeksWorked: '30', unavailablePercent: '20' }),
      ],
    } : i === 1 ? { ...y, costItems: [cost('tuition', '10000.00')], resources: [res('family', 'family', '12500.00')] } : y);
    return p;
  }
  it('year 1: cost 25,000 − resources 11,600 = gap 13,400; loans 11,000 → remaining 2,400', () => {
    expect(outputs(borrowingPlan()).years[0]).toMatchObject({
      costs: '25000.00', resources: '11600.00', gap: '13400.00', surplus: '0.00', borrowed: '11000.00', remaining: '2400.00',
    });
  });
  it('year 2: surplus 2,500, gap 0, the 1,000 loan is borrowed but never a resource; remaining 0', () => {
    expect(outputs(borrowingPlan()).years[1]).toMatchObject({
      costs: '10000.00', resources: '12500.00', gap: '0.00', surplus: '2500.00', borrowed: '1000.00', remaining: '0.00',
    });
  });
  it('each loan is counted exactly once across years (Σ borrowed = Σ assigned principal = 12,000)', () => {
    expect(sumOf(outputs(borrowingPlan()).years.map(y => y.borrowed))).toBe('12000.00');
  });
  it('remaining is never negative when loans exceed the gap', () => {
    const p = borrowingPlan();
    p.loans = [...p.loans, loan('big', '50000.00', '0.0639', { disbursementDate: '2026-08-24', academicYear: '2026-2027' })];
    expect(outputs(p).years[0]).toMatchObject({ borrowed: '61000.00', remaining: '0.00' });
  });
  it('0% available earnings contribute nothing; 100% available contribute the full 4,500', () => {
    const p = borrowingPlan();
    const setJob = (pct: string) => ({ ...p, schoolYears: p.schoolYears.map((y, i) => i !== 0 ? y : {
      ...y, resources: y.resources.map(r => r.id === 'job' ? { ...r, unavailablePercent: pct } : r),
    }) });
    expect(outputs(setJob('100')).years[0]).toMatchObject({ resources: '8000.00', gap: '17000.00' });
    expect(outputs(setJob('0')).years[0]).toMatchObject({ resources: '12500.00', gap: '12500.00' });
  });
});

// ------------------------------------------------------------------------- R2 single loan amortization
describe('R2 single loan $30,000 at 6.5% over 120 months', () => {
  const p = () => plan([loan('a', '30000.00', '0.065')], '340.64');
  it('minimum 340.64; 120 payments; final 341.25 absorbs rounding; total paid 40,877.41; interest 10,877.41', () => {
    const r = repayment(p());
    expect(r.loans[0].minimumMonthlyPayment).toBe('340.64');
    expect(r.status).toBe('paidOff');
    expect(r.amortizationSchedule).toHaveLength(120);
    expect(r.amortizationSchedule[0]).toMatchObject({ date: '2030-12-20', payment: '340.64', interest: '162.50', principal: '178.14' });
    expect(r.amortizationSchedule[119].payment).toBe('341.25');
    expect(r.debtFreeDate).toBe('2040-11-20');
    expect(r.totalRepaymentPayments).toBe('40877.41');
    expect(r.totalInterestPaid).toBe('10877.41');
  });
  it('no in-school interest when disbursed at the repayment period start', () => {
    expect(repayment(p()).loans[0]).toMatchObject({ accruedInterest: '0.00', capitalizedInterest: '0.00', balanceAtRepaymentStart: '30000.00' });
  });
});

// ------------------------------------------------------------------------- R3 zero rate
describe('R3 zero-rate loan $12,000', () => {
  it('minimum 100.00 over 120 months; budget 250 → 48 equal payments, no interest, debt-free 2034-11-20', () => {
    const r = repayment(plan([loan('z', '12000.00', '0', { type: 'private', requiredPayment: { graceMonths: 6 } })], '250.00'));
    expect(r.loans[0].minimumMonthlyPayment).toBe('100.00');
    expect(r.amortizationSchedule).toHaveLength(48);
    expect(r.amortizationSchedule.every(row => row.payment === '250.00' && row.interest === '0.00')).toBe(true);
    expect(r.debtFreeDate).toBe('2034-11-20');
    expect(r.totalInterestPaid).toBe('0.00');
    expect(r.totalRepaymentPayments).toBe('12000.00');
  });
});

// ------------------------------------------------------------------------- R4 unsubsidized capitalization
describe('R4 unsubsidized $10,000 at 5% disbursed 2026-08-24', () => {
  it('1,549 days of simple interest = 2,121.92, capitalized at 2030-11-20; minimum 128.57', () => {
    const r = repayment(plan([loan('u', '10000.00', '0.05', { disbursementDate: '2026-08-24' })], '200.00'));
    expect(r.loans[0]).toMatchObject({
      accruedInterest: '2121.92', capitalizedInterest: '2121.92', balanceAtRepaymentStart: '12121.92', minimumMonthlyPayment: '128.57',
    });
  });
  it('budget 200: 71 payments, final 0.70 on 2036-10-20; total interest 4,000.70 (2,121.92 capitalized + 1,878.78)', () => {
    const r = repayment(plan([loan('u', '10000.00', '0.05', { disbursementDate: '2026-08-24' })], '200.00'));
    expect(r.amortizationSchedule).toHaveLength(71);
    expect(r.amortizationSchedule.at(-1)).toMatchObject({ date: '2036-10-20', payment: '0.70' });
    expect(r.totalRepaymentPayments).toBe('14000.70');
    expect(r.totalInterestPaid).toBe('4000.70');
    // Capitalized interest is counted once: Σ scheduled interest + capitalized = total interest.
    expect(sumOf(r.amortizationSchedule.map(row => row.interest))).toBe('1878.78');
  });
  it('subsidized loan with the same inputs accrues nothing in school', () => {
    const r = repayment(plan([loan('s', '10000.00', '0.05', { type: 'subsidized', disbursementDate: '2026-08-24' })], '200.00'));
    expect(r.loans[0]).toMatchObject({ accruedInterest: '0.00', balanceAtRepaymentStart: '10000.00' });
  });
});

// ------------------------------------------------------------------------- R5 avalanche roll-forward
describe('R5 avalanche A $10,000 at 4% + B $5,000 at 7%, budget $400', () => {
  const r = () => repayment(plan([loan('A', '10000.00', '0.04'), loan('B', '5000.00', '0.07')], '400.00'));
  it('minimums 101.25 and 58.05; extra goes to the 7% loan first', () => {
    const p = r();
    expect(p.loans.map(l => l.minimumMonthlyPayment)).toEqual(['101.25', '58.05']);
    const m1 = p.amortizationSchedule[0].loans;
    expect(m1.find(l => l.loanId === 'A')!.payment).toBe('101.25');
    expect(m1.find(l => l.loanId === 'B')!.payment).toBe('298.75');
  });
  it('B is paid off in month 18 (2032-05-20) with 197.98; the freed 100.77 rolls to A the same month', () => {
    const row = r().amortizationSchedule[17];
    expect(row.date).toBe('2032-05-20');
    expect(row.payment).toBe('400.00');
    expect(row.loans.find(l => l.loanId === 'B')).toMatchObject({ payment: '197.98', remainingBalance: '0.00' });
    expect(row.loans.find(l => l.loanId === 'A')).toMatchObject({ payment: '202.02', remainingBalance: '8641.46' }); // 8742.23 − 100.77 rolled forward
  });
  it('debt-free after 41 months (2034-04-20); total paid 16,183.52; interest 1,183.52', () => {
    const p = r();
    expect(p.amortizationSchedule).toHaveLength(41);
    expect(p.debtFreeDate).toBe('2034-04-20');
    expect(p.totalRepaymentPayments).toBe('16183.52');
    expect(p.totalInterestPaid).toBe('1183.52');
  });
});

// ------------------------------------------------------------------------- R6 one-time bonus
describe('R6 bonus $5,000 on 2032-06-15, 60% to debt ($3,000), $30,000 at 6.5%, budget $400', () => {
  const withBonus = () => repayment(plan([loan('f', '30000.00', '0.065')], '400.00', [event('bonus', 'windfall', '2032-06-15', '5000.00', '60')]));
  it('baseline without bonus: 97 months, debt-free 2038-12-20, interest 8,600.22', () => {
    const p = repayment(plan([loan('f', '30000.00', '0.065')], '400.00'));
    expect(p.amortizationSchedule).toHaveLength(97);
    expect(p.debtFreeDate).toBe('2038-12-20');
    expect(p.totalInterestPaid).toBe('8600.22');
  });
  it('only the June 2032 payment rises, by exactly the 3,000 debt portion (400 → 3,400)', () => {
    const p = withBonus();
    expect(rowAt(p, '2032-05-20').payment).toBe('400.00');
    expect(rowAt(p, '2032-06-20')).toMatchObject({ payment: '3400.00', interest: '138.25', principal: '3261.75', remainingBalance: '22260.62' });
    expect(rowAt(p, '2032-07-20').payment).toBe('400.00');
  });
  it('with bonus: 86 months, debt-free 2038-01-20, total paid 37,163.66, interest 7,163.66', () => {
    const p = withBonus();
    expect(p.amortizationSchedule).toHaveLength(86);
    expect(p.debtFreeDate).toBe('2038-01-20');
    expect(p.totalRepaymentPayments).toBe('37163.66');
    expect(p.totalInterestPaid).toBe('7163.66');
  });
  it('a bonus dated before repayment is applied in repayment month 1 (assumption shown as a notice)', () => {
    const out = outputs(plan([loan('f', '30000.00', '0.065')], '400.00', [event('early', 'windfall', '2029-06-01', '1000.00', '100')]));
    expect(out.repayment!.amortizationSchedule[0].payment).toBe('1400.00');
    expect(out.notices.some(n => /before repayment/i.test(n))).toBe(true);
  });
});

// ------------------------------------------------------------------------- R7 dated raise
describe('R7 raise $55,000 → $65,000 on 2033-01-01 with 30% allocation (+$250/month)', () => {
  it('budget 400 until Dec 2032, 650 from Jan 2033; 66 months, debt-free 2036-05-20, interest 6,424.73', () => {
    const p = repayment(plan([loan('g', '30000.00', '0.065')], '400.00', [event('raise', 'income', '2033-01-01', '65000.00', '30')]));
    expect(rowAt(p, '2032-12-20').payment).toBe('400.00');
    expect(rowAt(p, '2033-01-20').payment).toBe('650.00');
    expect(p.amortizationSchedule).toHaveLength(66);
    expect(p.debtFreeDate).toBe('2036-05-20');
    expect(p.amortizationSchedule.at(-1)!.payment).toBe('424.73');
    expect(p.totalInterestPaid).toBe('6424.73');
  });
  it('a raise with 0% allocation never changes debt payments (no silent change)', () => {
    const p = repayment(plan([loan('g', '30000.00', '0.065')], '400.00', [event('raise', 'income', '2033-01-01', '65000.00', '0')]));
    expect(p.amortizationSchedule.every(row => row.payment === '400.00' || row === p.amortizationSchedule.at(-1))).toBe(true);
    expect(p.debtFreeDate).toBe('2038-12-20');
  });
});

// ------------------------------------------------------------------------- R8 payment below interest
describe('R8 budget $150 < first-month interest $162.50 on $30,000 at 6.5%', () => {
  it('non-payoff: no debt-free date, no total interest, remaining 30,012.50 shown, shortfall 190.64', () => {
    const out = outputs(plan([loan('h', '30000.00', '0.065')], '150.00'));
    const p = out.repayment!;
    expect(p.status).toBe('notAmortizing');
    expect(p.debtFreeDate).toBeNull();
    expect(p.totalInterestPaid).toBeNull();
    expect(p.amortizationSchedule.at(-1)!.remainingBalance).toBe('30012.50');
    expect(out.paymentShortfall).toBe('190.64');
    expect(p.warnings.some(w => w.code === 'NEGATIVE_AMORTIZATION')).toBe(true);
  });
  it('zero budget is also non-payoff, never a fake date', () => {
    const p = repayment(plan([loan('h', '30000.00', '0.065')], '0.00'));
    expect(p.debtFreeDate).toBeNull();
    expect(p.status).not.toBe('paidOff');
  });
});

// ------------------------------------------------------------------------- R9 final partial payment
describe('R9 $1,000 at 12%, budget $300', () => {
  it('300, 300, 300, then a partial 122.48; interest 10.00 + 7.10 + 4.17 + 1.21 = 22.48', () => {
    const p = repayment(plan([loan('i', '1000.00', '0.12')], '300.00'));
    expect(p.amortizationSchedule.map(r => [r.payment, r.interest, r.remainingBalance])).toEqual([
      ['300.00', '10.00', '710.00'], ['300.00', '7.10', '417.10'], ['300.00', '4.17', '121.27'], ['122.48', '1.21', '0.00'],
    ]);
    expect(p.debtFreeDate).toBe('2031-03-20');
    expect(p.totalRepaymentPayments).toBe('1022.48');
    expect(p.totalInterestPaid).toBe('22.48');
  });
});

// ------------------------------------------------------------------------- R10 yearly breakdown (from the monthly schedule)
/** Tester's own calendar-year roll-up of a monthly schedule (reference; not the implementer's function). */
function yearlyRollup(p: Projection) {
  const years = new Map<string, { start: Decimal; payments: Decimal; interest: Decimal; principal: Decimal; end: Decimal; months: number }>();
  let balance = new Decimal(p.balanceAtRepaymentStart);
  for (const row of p.amortizationSchedule) {
    const y = row.date.slice(0, 4);
    const entry = years.get(y) ?? { start: balance, payments: new Decimal(0), interest: new Decimal(0), principal: new Decimal(0), end: balance, months: 0 };
    entry.payments = entry.payments.plus(row.payment); entry.interest = entry.interest.plus(row.interest);
    entry.principal = entry.principal.plus(row.principal); entry.end = new Decimal(row.remainingBalance); entry.months++;
    years.set(y, entry); balance = entry.end;
  }
  return [...years.entries()].map(([year, v]) => ({
    year, start: v.start.toFixed(2), payments: v.payments.toFixed(2), interest: v.interest.toFixed(2), principal: v.principal.toFixed(2), end: v.end.toFixed(2), months: v.months,
  }));
}
describe('R10 yearly rows reconcile with the monthly schedule ($30,000 at 6.5%, budget $400)', () => {
  const p = () => repayment(plan([loan('f', '30000.00', '0.065')], '400.00'));
  it('matches the independent calendar-year table (partial first and final years)', () => {
    const rows = yearlyRollup(p());
    expect(rows.map(r => r.year)).toEqual(['2030', '2031', '2032', '2033', '2034', '2035', '2036', '2037', '2038']);
    expect(rows[0]).toMatchObject({ start: '30000.00', payments: '400.00', interest: '162.50', principal: '237.50', end: '29762.50', months: 1 });
    expect(rows[1]).toMatchObject({ start: '29762.50', payments: '4800.00', interest: '1847.64', principal: '2952.36', end: '26810.14' });
    expect(rows[3]).toMatchObject({ start: '23660.05', payments: '4800.00', interest: '1438.96', end: '20299.01' });
    expect(rows[8]).toMatchObject({ start: '4447.94', payments: '4600.22', interest: '152.28', principal: '4447.94', end: '0.00', months: 12 });
  });
  it('Σ yearly payments = total paid; Σ yearly interest = total interest; start − principal = end for every row', () => {
    const projection = p();
    const rows = yearlyRollup(projection);
    expect(sumOf(rows.map(r => r.payments))).toBe(projection.totalRepaymentPayments);
    expect(sumOf(rows.map(r => r.interest))).toBe(projection.totalInterestPaid);
    for (const r of rows) expect(new Decimal(r.start).minus(r.principal).toFixed(2)).toBe(r.end);
    for (let i = 1; i < rows.length; i++) expect(rows[i].start).toBe(rows[i - 1].end);
  });
  it('every monthly row reconciles: payment = interest + principal (no orphan cents)', () => {
    for (const row of p().amortizationSchedule) expect(new Decimal(row.interest).plus(row.principal).toFixed(2)).toBe(row.payment);
  });
  it('bonus months are part of the year\'s payments (2032 includes the 3,000 debt portion)', () => {
    const rows = yearlyRollup(repayment(plan([loan('f', '30000.00', '0.065')], '400.00', [event('bonus', 'windfall', '2032-06-15', '5000.00', '60')])));
    expect(rows.find(r => r.year === '2032')!.payments).toBe('7800.00');
  });
  it('with capitalized interest the monthly schedule still reconciles from the capitalized starting balance', () => {
    const projection = repayment(plan([loan('u', '10000.00', '0.05', { disbursementDate: '2026-08-24' })], '200.00'));
    const rows = yearlyRollup(projection);
    expect(rows[0].start).toBe('12121.92');
    expect(rows.at(-1)!.end).toBe('0.00');
    expect(sumOf(rows.map(r => r.payments))).toBe(projection.totalRepaymentPayments);
  });
});

// ------------------------------------------------------------------------- R11 robustness of the result states
describe('R11 invalid / incomplete / zero states', () => {
  it('no loans: nothing owed, no fake interest; budget-only plan is valid', () => {
    const p = repayment(plan([], '400.00'));
    expect(p.amortizationSchedule).toHaveLength(0);
    expect(p.balanceAtRepaymentStart).toBe('0.00');
  });
  it('invalid money input is rejected with a field path, never computed as zero', () => {
    const out = calculatePlannerOutputs(plan([loan('a', '30000.00', '0.065')], 'abc'));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.map(e => e.path)).toContain('postGradIncome.monthlyDebtBudget');
  });
  it('a loan that cannot be projected keeps the borrowing results (repayment null with a reason)', () => {
    const out = outputs(plan([loan('late', '1000.00', '0.05', { disbursementDate: '2031-06-01' })], '400.00'));
    expect(out.repayment).toBeNull();
    expect(out.repaymentUnavailable?.reason).toBeTruthy();
    expect(out.years.length).toBeGreaterThan(0);
  });
  it('the engine never mutates its input plan', () => {
    const p = plan([loan('f', '30000.00', '0.065')], '400.00', [event('bonus', 'windfall', '2032-06-15', '5000.00', '60')]);
    const before = JSON.stringify(p);
    outputs(p);
    expect(JSON.stringify(p)).toBe(before);
  });
});

// ------------------------------------------------------------------------- R12 partial payoff with a large bonus
describe('R12 bonus larger than the remaining debt', () => {
  it('$1,000 at 12%, budget 300, $5,000 bonus (100%) on 2031-01-15: pays exactly the 717.10 owed, never more', () => {
    const p = repayment(plan([loan('i', '1000.00', '0.12')], '300.00', [event('bonus', 'windfall', '2031-01-15', '5000.00', '100')]));
    expect(p.amortizationSchedule.map(r => r.payment)).toEqual(['300.00', '717.10']);
    expect(p.debtFreeDate).toBe('2031-01-20');
    expect(p.totalRepaymentPayments).toBe('1017.10');
    expect(p.totalInterestPaid).toBe('17.10');
  });
});

// ------------------------------------------------------------------------- X: workbook scenarios (excel-analyst), re-derived by the tester
describe('X1/X7 workbook year-3 funding gap, corrected', () => {
  function x1(): PlannerPlan {
    const ay = '2026-2027';
    const p = plan([
      loan('unsub', '2500.00', '0.0653', { disbursementDate: '2026-08-24', academicYear: ay }),
      loan('sub', '5000.00', '0.0653', { type: 'subsidized', disbursementDate: '2026-08-24', academicYear: ay }),
      loan('plus', '27500.00', '0.0907', { type: 'other', disbursementDate: '2026-08-24', academicYear: ay, requiredPayment: { graceMonths: 6 } }),
      // X7: 3,500 + 2,000 + 28,000 in year 2 — rates never enter money totals.
      loan('s2', '3500.00', '0.0653', { type: 'subsidized', disbursementDate: '2027-08-24', academicYear: '2027-2028' }),
      loan('u2', '2000.00', '0.0639', { disbursementDate: '2027-08-24', academicYear: '2027-2028' }),
      loan('p2', '28000.00', '0.095', { type: 'other', disbursementDate: '2027-08-24', academicYear: '2027-2028', requiredPayment: { graceMonths: 6 } }),
    ], '400.00');
    p.schoolYears = p.schoolYears.map((y, i) => i !== 0 ? y : {
      ...y,
      costItems: [{ ...cost('rent', '8100.00'), category: 'housing' }, cost('school', '31984.00'), { ...cost('food', '3300.00'), category: 'food' }],
      resources: [res('grant', 'grant', '5403.00'), res('bank', 'savings', '2903.00')],
    });
    return p;
  }
  it('cost 43,384 (food included) − non-loan 8,306 = gap 35,078; loans 35,000 → 78 unfunded', () => {
    expect(outputs(x1()).years[0]).toMatchObject({ costs: '43384.00', resources: '8306.00', gap: '35078.00', borrowed: '35000.00', remaining: '78.00' });
  });
  it('year-2 borrowed is exactly 33,500.00', () => {
    expect(outputs(x1()).years[1].borrowed).toBe('33500.00');
  });
});
describe('X6 co-op earnings $25/h × 40 h/wk × 135/7 weeks', () => {
  it('gross 19,285.71; with 20% unavailable 15,428.57', () => {
    const weeks = '19.2857142857';
    const p = plan([], '400.00');
    const job = (pct: string) => ({ ...p, schoolYears: p.schoolYears.map((y, i) => i !== 0 ? y : {
      ...y, resources: [res('coop', 'job', '0.00', { incomeMode: 'hourly', hourlyWage: '25.00', hoursPerWeek: '40', weeksWorked: weeks, unavailablePercent: pct })],
    }) });
    expect(outputs(job('0')).years[0].resources).toBe('19285.71');
    expect(outputs(job('20')).years[0].resources).toBe('15428.57');
  });
});
describe('X5 workbook repayment (12 tranches, 157,913.29), app conventions', () => {
  // Balances = Loan Interest B5:M5 rounded to cents; payment 5,000 → 5,250 (month 13) → 5,500 (month 25) via +3,000 salary
  // steps at 100% allocation. App convention: every loan's minimum first, extra by avalanche (tie: smaller balance).
  // Tester's model (tester/x5.py): 35 months, final 758.80, interest 20,845.50, end of year 1 109,806.91, year 2 53,888.00.
  // (Analyst's 20,445.43 assumes no minimums: all cash to the highest rate; reproduced by the tester with that rule.)
  const tranches: [string, string, string][] = [
    ['U1', '2417.94', '0.0653'], ['U2', '2263.77', '0.0639'], ['U3', '2663.25', '0.0653'], ['U4', '2500.00', '0.0653'],
    ['PP1', '25812.11', '0.095'], ['PP2', '46761.98', '0.095'], ['PP3', '29994.25', '0.0907'], ['PP4', '27500.00', '0.0907'],
    ['S1', '3500.00', '0.0653'], ['S2', '4500.00', '0.0639'], ['S3', '5000.00', '0.0653'], ['S4', '5000.00', '0.0653'],
  ];
  const x5 = () => repayment(plan(tranches.map(([id, b, r]) => loan(id, b, r)), '5000.00', [
    event('step1', 'income', '2031-12-01', '58000.00', '100'), event('step2', 'income', '2032-12-01', '61000.00', '100'),
  ]));
  it('starts at 157,913.30 (cent-rounded tranches) and follows the 5,000 / 5,250 / 5,500 steps', () => {
    const p = x5();
    expect(p.balanceAtRepaymentStart).toBe('157913.30'); // Σ of cent-rounded tranches (workbook 157,913.29 is unrounded)
    expect([p.amortizationSchedule[0].payment, p.amortizationSchedule[12].payment, p.amortizationSchedule[24].payment]).toEqual(['5000.00', '5250.00', '5500.00']);
  });
  it('end of year 1 109,806.91, year 2 53,888.00; payoff month 35 with 758.80; interest 20,845.50', () => {
    const p = x5();
    expect(p.amortizationSchedule[11].remainingBalance).toBe('109806.91');
    expect(p.amortizationSchedule[23].remainingBalance).toBe('53888.00');
    expect(p.amortizationSchedule).toHaveLength(35);
    expect(p.amortizationSchedule[34].payment).toBe('758.80');
    expect(p.totalInterestPaid).toBe('20845.50');
  });
  it('X8: balances clamp at 0 after payoff (no negative remaining balance anywhere)', () => {
    for (const row of x5().amortizationSchedule) {
      expect(new Decimal(row.remainingBalance).gte(0)).toBe(true);
      for (const l of row.loans) expect(new Decimal(l.remainingBalance).gte(0)).toBe(true);
    }
  });
});

// ------------------------------------------------------------------------- math-auditor defects (team/math-audit.md), re-derived by the tester
// Tester derivations (tester/d.py): 10,000 @ 6% from 2026-08-24 to R 2030-11-20 = 1,549 days → 2,546.30 accrued;
// owed 12,546.30; 120-month minimum 139.29.

const unsub6 = (extra: Partial<PlannerLoan> = {}) => loan('m', '10000.00', '0.06', { disbursementDate: '2026-08-24', ...extra });

describe('D1 target solver never asks for less than the required minimums (DEFECT D1 — fails until fixed)', () => {
  it('10,000 @ 6%, target 240 months: required budget is the 139.29 minimum (limitedByMinimum), not 89.89', () => {
    const p = plan([unsub6()], '400.00');
    const result = solveTargetPayment(p, { mode: 'target', kind: 'duration', months: 240 }, '2026-10-17');
    expect(result.status).toBe('feasible');
    if (result.status !== 'feasible') return;
    expect(new Decimal(result.requiredMonthlyBudget).gte('139.29')).toBe(true); // DEFECT D1: actual 89.89
    expect((result as { limitedByMinimum?: boolean }).limitedByMinimum).toBe(true);
  });
  it('two loans with a raise and a yearly bonus, target 2034-12-31: required ≥ Σ minimums', () => {
    const p = plan([loan('a', '10000.00', '0.05', { disbursementDate: '2026-08-24' }), loan('b', '5000.00', '0.07', { disbursementDate: '2026-08-24' })], '300.00', [
      event('raise', 'income', '2032-01-01', '67000.00', '50'),
      { ...event('bonus', 'windfall', '2033-06-01', '4000.00', '50'), recurrence: 'yearly' },
    ]);
    const minimumTotal = outputs(p).minimumTotal!;
    const result = solveTargetPayment(p, { mode: 'target', kind: 'date', date: '2034-12-31' }, '2026-10-17');
    expect(result.status).toBe('feasible');
    if (result.status !== 'feasible') return;
    expect(new Decimal(result.requiredMonthlyBudget).gte(minimumTotal)).toBe(true); // DEFECT D1: actual 46.86 vs 203.87
  });
});

/** Optional additive fields from math-contracts.md; absent today. */
type RowWithCharged = AmortizationMonth & { interestCharged?: string; newBorrowing?: string };
function owedInvariantBreaks(p: Projection, owedAtStart: string): number {
  let prev = new Decimal(owedAtStart);
  let breaks = 0;
  for (const row of p.amortizationSchedule as RowWithCharged[]) {
    const expected = prev.plus(row.newBorrowing ?? '0').plus(row.interestCharged ?? row.interest).minus(row.payment);
    if (!expected.eq(row.remainingBalance)) breaks++;
    prev = new Decimal(row.remainingBalance);
  }
  return breaks;
}
const owedAtStartOf = (p: Projection) => (p as Projection & { owedAtVoluntaryStart?: string }).owedAtVoluntaryStart;

describe('D2 every row reconciles: owed_n = owed_(n−1) + newBorrowing + interest charged − payment (DEFECT D2 — fails until fixed)', () => {
  it('voluntary start at graduation (6 grace months), 10,000 @ 6%, budget 200', () => {
    const p0 = plan([unsub6()], '200.00');
    const p = repayment({ ...p0, repayment: { ...p0.repayment, voluntaryStart: { kind: 'afterGraduation', months: 0 } } });
    expect(owedAtStartOf(p)).toBeDefined(); // DEFECT D2: Projection.owedAtVoluntaryStart missing
    expect(owedInvariantBreaks(p, owedAtStartOf(p) ?? p.balanceAtRepaymentStart)).toBe(0); // actual: 5 rows break
  });
  it('capitalizeInterest:false, 10,000 @ 6%, budget 200', () => {
    const p = repayment(plan([unsub6({ capitalizeInterest: false })], '200.00'));
    expect(owedInvariantBreaks(p, owedAtStartOf(p) ?? '12546.30')).toBe(0); // DEFECT D2: actual 16 rows break
  });
});

describe('D3 amount owed when payments start includes uncapitalized interest (DEFECT D3 — fails until fixed)', () => {
  it('capitalizeInterest:false → owed at voluntary start 12,546.30 (balanceAtRepaymentStart shows 10,000.00)', () => {
    expect(owedAtStartOf(repayment(plan([unsub6({ capitalizeInterest: false })], '200.00')))).toBe('12546.30');
  });
});

describe('auditor regressions that hold today', () => {
  it('paid off ⇒ total interest = total payments + in-school interest paid − Σ principal (R2, R4, R5, R6, R9)', () => {
    const cases = [
      plan([loan('a', '30000.00', '0.065')], '340.64'),
      plan([unsub6()], '200.00'),
      plan([loan('A', '10000.00', '0.04'), loan('B', '5000.00', '0.07')], '400.00'),
      plan([loan('f', '30000.00', '0.065')], '400.00', [event('bonus', 'windfall', '2032-06-15', '5000.00', '60')]),
      plan([loan('i', '1000.00', '0.12')], '300.00'),
      plan([unsub6({ payInterestWhileInSchool: true })], '200.00'),
    ];
    for (const c of cases) {
      const p = repayment(c);
      expect(p.status).toBe('paidOff');
      const expected = new Decimal(p.totalRepaymentPayments).plus(sumOf(p.loans.map(l => l.inSchoolInterestPaid))).minus(sumOf(p.loans.map(l => l.originalPrincipal)));
      expect(p.totalInterestPaid).toBe(expected.toFixed(2));
    }
  });
  it('budget 0 with payments from graduation stops at the first required month (2030-12-20), not in grace', () => {
    const p0 = plan([unsub6()], '0.00');
    const p = repayment({ ...p0, repayment: { ...p0.repayment, voluntaryStart: { kind: 'afterGraduation', months: 0 } } });
    expect(p.status).toBe('notAmortizing');
    expect(p.amortizationSchedule).toHaveLength(7);
    expect(p.amortizationSchedule.at(-1)!.date).toBe('2030-12-20');
  });
  it('same plan plus a raise to 79,000 on 2031-03-01 @ 25% (+500/month) pays off 2033-06-20 with 153.99', () => {
    // Tester: 1,365 days → 2,243.84 + 6 × 50.00 grace interest = 12,543.84 at R; Dec–Feb unpaid interest compounds; 500/month from Mar 2031.
    const p0 = plan([unsub6()], '0.00', [event('raise', 'income', '2031-03-01', '79000.00', '25')]);
    const p = repayment({ ...p0, repayment: { ...p0.repayment, voluntaryStart: { kind: 'afterGraduation', months: 0 } } });
    expect(p.debtFreeDate).toBe('2033-06-20');
    expect(p.amortizationSchedule.at(-1)!.payment).toBe('153.99');
    expect(p.totalRepaymentPayments).toBe('13653.99');
  });
  it('0% $1,000 over 120 months at budget 8.33: 119 × 8.33 then a bounded final 8.73', () => {
    const p = repayment(plan([loan('z', '1000.00', '0', { type: 'private', requiredPayment: { graceMonths: 6 } })], '8.33'));
    expect(p.amortizationSchedule).toHaveLength(120);
    expect(p.amortizationSchedule.at(-1)!.payment).toBe('8.73');
    expect(p.totalRepaymentPayments).toBe('1000.00');
  });
});

// ------------------------------------------------------------------------- D9 bonus portion actually used (lead ruling: fix; contract C4)
type RowWithWindfall = AmortizationMonth & { windfallApplied?: string };
describe('D9 the bonus portion actually applied is reported (DEFECT D9 — fails until windfallApplied exists)', () => {
  it('R6: the 2032-06 payment reports 3,000.00 bonus applied; Σ windfallApplied = 3,000.00', () => {
    const p = repayment(plan([loan('f', '30000.00', '0.065')], '400.00', [event('bonus', 'windfall', '2032-06-15', '5000.00', '60')]));
    const rows = p.amortizationSchedule as RowWithWindfall[];
    expect(rows.find(r => r.date === '2032-06-20')!.windfallApplied).toBe('3000.00');
    expect(sumOf(rows.map(r => r.windfallApplied ?? '0'))).toBe('3000.00');
  });
  it('R12: in the payoff month the regular 300 is used first, so only 417.10 of the 5,000 is applied', () => {
    const p = repayment(plan([loan('i', '1000.00', '0.12')], '300.00', [event('bonus', 'windfall', '2031-01-15', '5000.00', '100')]));
    const rows = p.amortizationSchedule as RowWithWindfall[];
    expect(rows[1].windfallApplied).toBe('417.10'); // 717.10 − 300.00
    expect(rows[0].windfallApplied ?? '0.00').toBe('0.00');
  });
});
describe('D3 owed-at-start in the ordinary capitalized case (C2)', () => {
  it('unsub 10,000 @ 6% capitalized: owedAtVoluntaryStart 12,546.30 (= Σ principal 10,000 + 2,546.30 accrued)', () => {
    expect(owedAtStartOf(repayment(plan([unsub6()], '200.00')))).toBe('12546.30'); // DEFECT D3: field missing
  });
});
