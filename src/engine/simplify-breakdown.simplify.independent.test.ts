/**
 * Independent P1/P2 tests (tester): yearly breakdown (C11) and headline inputs (C2, C7).
 * Expected rows come from the tester's own model (scratchpad tester/p1.py and ref.py), never from the engine.
 */
import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { calculatePlannerOutputs, createDefaultPlan, createLoanFromGap, windfallSplit, budgetTimeline } from './planner';
import { yearlyBreakdown } from './yearlyBreakdown';
import { wholeMonthsBetween } from './dates';
import type { LifeEvent, PlannerLoan, PlannerPlan } from './planner-contracts';
import type { Projection } from './contracts';

const R = '2030-11-20';
const loan = (id: string, principal: string, annualRate: string, extra: Partial<PlannerLoan> = {}): PlannerLoan => ({
  id, name: `Loan ${id}`, type: 'unsubsidized', principal, annualRate, disbursementDate: R, termMonths: 120, academicYear: 'unassigned', ...extra,
});
const event = (id: string, type: LifeEvent['type'], date: string, amount: string, allocationPercent: string): LifeEvent =>
  ({ id, name: id, type, date, amount, allocationPercent, recurrence: 'once' });
function plan(loans: PlannerLoan[], budget: string, lifeEvents: LifeEvent[] = [], months = 6): PlannerPlan {
  const base = createDefaultPlan();
  return {
    ...base, loans, lifeEvents, scenarios: [],
    postGradIncome: { ...base.postGradIncome, annualSalary: '55000.00', monthlyDebtBudget: budget },
    repayment: { ...base.repayment, strategyId: 'avalanche', extraMonthlyPayment: '0.00', customOrder: [], payoffTarget: { mode: 'budget' }, voluntaryStart: { kind: 'afterGraduation', months } },
  };
}
function repayment(p: PlannerPlan): Projection {
  const out = calculatePlannerOutputs(p);
  if (!out.ok || !out.value.repayment) throw new Error('no projection');
  return out.value.repayment;
}
const sumOf = (values: string[]) => values.reduce((a, b) => a.plus(b), new Decimal(0)).toFixed(2);
const pick = (r: { year: number; months: number; startBalance: string; payments: string; interest: string; principal: string; endBalance: string }) =>
  [r.year, r.months, r.startBalance, r.payments, r.interest, r.principal, r.endBalance];

const base400 = () => repayment(plan([loan('f', '30000.00', '0.065')], '400.00'));
const bonus = () => repayment(plan([loan('f', '30000.00', '0.065')], '400.00', [event('bonus', 'windfall', '2032-06-15', '5000.00', '60')]));
const graceStart = () => repayment(plan([loan('m', '10000.00', '0.06', { disbursementDate: '2026-08-24' })], '200.00', [], 0));

describe('P1 yearly breakdown — calendar basis', () => {
  it('$30,000 @ 6.5%, budget 400: matches the tester table (partial first year, 12-month final year)', () => {
    const b = yearlyBreakdown(base400(), 'calendar');
    expect(b.rows.map(r => r.year)).toEqual([2030, 2031, 2032, 2033, 2034, 2035, 2036, 2037, 2038]);
    expect(pick(b.rows[0])).toEqual([2030, 1, '30000.00', '400.00', '162.50', '237.50', '29762.50']);
    expect(pick(b.rows[1])).toEqual([2031, 12, '29762.50', '4800.00', '1847.64', '2952.36', '26810.14']);
    expect(pick(b.rows[2])).toEqual([2032, 12, '26810.14', '4800.00', '1649.91', '3150.09', '23660.05']);
    expect(pick(b.rows[8])).toEqual([2038, 12, '4447.94', '4600.22', '152.28', '4447.94', '0.00']);
    expect(b.paidOff).toBe(true);
    expect(b.remainingBalance).toBe('0.00');
    expect(b.totals).toMatchObject({ payments: '38600.22', interest: '8600.22', bonus: '0.00', newBorrowing: '0.00' });
  });
  it('payments start at graduation (6 grace months): 2030 has 7 months, starts at owed 12,243.84 and reconciles', () => {
    // 10,000 × 0.06 / 365 × 1,365 days = 2,243.84 owed at S; grace interest 50.00/month charged; capitalized at R.
    const p = graceStart();
    const b = yearlyBreakdown(p, 'calendar');
    expect(pick(b.rows[0])).toEqual([2030, 7, '12243.84', '1400.00', '356.72', '1043.28', '11200.56']);
    expect(pick(b.rows[1])).toEqual([2031, 12, '11200.56', '2400.00', '623.71', '1776.29', '9424.27']);
    expect(pick(b.rows.at(-1)!)).toEqual([2036, 6, '1153.89', '1173.84', '19.95', '1153.89', '0.00']);
    expect(b.totals.payments).toBe('14573.84');
    expect(p.totalInterestPaid).toBe('4573.84');
    // C11 totals identity: Σ interest + interest before P1 (owed at start − Σ principal + in-school paid) = total interest.
    expect(new Decimal(b.totals.interest).plus(p.owedAtVoluntaryStart).minus('10000.00').toFixed(2)).toBe(p.totalInterestPaid);
  });
});

describe('P1 yearly breakdown — repayment basis (12-payment blocks from the first payment)', () => {
  it('year 1 = Dec 2030 – Nov 2031; 8 full years then a 1-month partial final year', () => {
    const b = yearlyBreakdown(base400(), 'repayment');
    expect(b.rows).toHaveLength(9);
    expect(b.rows[0]).toMatchObject({ year: 1, firstDate: '2030-12-20', lastDate: '2031-11-20', months: 12 });
    expect(pick(b.rows[0])).toEqual([1, 12, '30000.00', '4800.00', '1863.55', '2936.45', '27063.55']);
    expect(pick(b.rows[7])).toEqual([8, 12, '4821.82', '4800.00', '177.32', '4622.68', '199.14']);
    expect(pick(b.rows[8])).toEqual([9, 1, '199.14', '200.22', '1.08', '199.14', '0.00']);
  });
  it('bonus is part of payments, shown once: year 2 payments 7,800.00 of which bonus 3,000.00', () => {
    const b = yearlyBreakdown(bonus(), 'repayment');
    expect(b.rows[1]).toMatchObject({ payments: '7800.00', bonus: '3000.00', interest: '1584.73', endBalance: '20848.28' });
    expect(pick(b.rows.at(-1)!)).toEqual([8, 2, '559.75', '563.66', '3.91', '559.75', '0.00']);
    expect(b.totals).toMatchObject({ payments: '37163.66', bonus: '3000.00', interest: '7163.66' });
  });
});

describe('P1 invariants on every row, both bases, several plans', () => {
  const plans = {
    base400, bonus, graceStart,
    raise: () => repayment(plan([loan('g', '30000.00', '0.065')], '400.00', [event('raise', 'income', '2033-01-01', '65000.00', '30')])),
    avalanche: () => repayment(plan([loan('A', '10000.00', '0.04'), loan('B', '5000.00', '0.07')], '400.00')),
    uncapitalized: () => repayment(plan([loan('m', '10000.00', '0.06', { disbursementDate: '2026-08-24', capitalizeInterest: false })], '200.00')),
  };
  for (const [name, make] of Object.entries(plans)) {
    for (const basis of ['calendar', 'repayment'] as const) {
      it(`${name} / ${basis}: end = start + newBorrowing + interest − payments; next start = previous end; Σ = projection totals`, () => {
        const p = make();
        const b = yearlyBreakdown(p, basis);
        expect(b.rows[0].startBalance).toBe(p.owedAtVoluntaryStart);
        for (const [i, r] of b.rows.entries()) {
          expect(new Decimal(r.startBalance).plus(r.newBorrowing).plus(r.interest).minus(r.payments).toFixed(2)).toBe(r.endBalance);
          expect(new Decimal(r.payments).minus(r.interest).toFixed(2)).toBe(r.principal);
          if (i) expect(r.startBalance).toBe(b.rows[i - 1].endBalance);
          expect(r.months).toBeLessThanOrEqual(12);
        }
        expect(b.totals.payments).toBe(p.totalRepaymentPayments);
        expect(b.rows.reduce((n, r) => n + r.months, 0)).toBe(p.amortizationSchedule.length);
        expect(b.rows.at(-1)!.endBalance).toBe('0.00');
      });
    }
  }
});

describe('P1 display count never changes results', () => {
  it('slicing N rows (1, 3, 5, 10, all) leaves every row, total and date identical', () => {
    const p = base400();
    const full = yearlyBreakdown(p, 'calendar');
    const snapshot = JSON.stringify({ full, debtFree: p.debtFreeDate, interest: p.totalInterestPaid });
    for (const n of [1, 3, 5, 10, full.rows.length, 99]) {
      const shown = full.rows.slice(0, n);
      expect(shown).toEqual(full.rows.slice(0, Math.min(n, full.rows.length)));
      expect(JSON.stringify({ full: yearlyBreakdown(p, 'calendar'), debtFree: p.debtFreeDate, interest: p.totalInterestPaid })).toBe(snapshot);
    }
  });
  it('calendar and repayment bases have the same totals', () => {
    const p = bonus();
    expect(yearlyBreakdown(p, 'calendar').totals).toEqual(yearlyBreakdown(p, 'repayment').totals);
  });
});

describe('P1 non-payoff', () => {
  it('budget 150 < interest: one row, not paid off, remaining 30,012.50, principal −12.50 (balance grew)', () => {
    const p = repayment(plan([loan('h', '30000.00', '0.065')], '150.00'));
    const b = yearlyBreakdown(p, 'calendar');
    expect(b.paidOff).toBe(false);
    expect(b.remainingBalance).toBe('30012.50');
    expect(pick(b.rows[0])).toEqual([2030, 1, '30000.00', '150.00', '162.50', '-12.50', '30012.50']);
  });
  it('no loans: no rows, nothing owed', () => {
    const b = yearlyBreakdown(repayment(plan([], '400.00')), 'calendar');
    expect(b.rows).toHaveLength(0);
    expect(new Decimal(b.remainingBalance).isZero()).toBe(true);
  });
});

describe('P2 headline inputs', () => {
  it('total debt = Σ principal (15,000) while owed when payments start includes in-school interest', () => {
    // A: 10,000 @ 6% from 2026-08-24 → 2,546.30 accrued to 2030-11-20; B: 5,000 subsidized → none.
    const p = repayment(plan([
      loan('A', '10000.00', '0.06', { disbursementDate: '2026-08-24' }),
      loan('B', '5000.00', '0.05', { type: 'subsidized', disbursementDate: '2026-08-24' }),
    ], '400.00'));
    expect(sumOf(p.loans.map(l => l.originalPrincipal))).toBe('15000.00');
    expect(p.owedAtVoluntaryStart).toBe('17546.30');
  });
  it('time until debt-free counts whole months from today', () => {
    expect(wholeMonthsBetween('2026-10-17', '2040-11-20')).toBe(169); // 14 y 1 m
    expect(wholeMonthsBetween('2026-10-17', '2030-12-10')).toBe(49); // day 10 < 17 → not a whole 50th month
    expect(wholeMonthsBetween('2026-10-17', '2026-10-17')).toBe(0);
    expect(wholeMonthsBetween('2040-11-20', '2026-10-17')).toBe(0);
  });
  it('bonus split (C4): 5,000 at 60% → 3,000.00 to debt, 2,000.00 kept; 33.335% of 100.01 rounds half-up', () => {
    expect(windfallSplit({ amount: '5000.00', allocationPercent: '60' })).toEqual({ toDebt: '3000.00', kept: '2000.00' });
    expect(windfallSplit({ amount: '100.01', allocationPercent: '50' })).toEqual({ toDebt: '50.01', kept: '50.00' }); // 50.005 → 50.01
  });
  it('raise visibility (D5): 55,000 → 65,000 @ 30% shows 400.00 → 650.00 from the 2033-01-20 payment', () => {
    const steps = budgetTimeline(plan([loan('g', '30000.00', '0.065')], '400.00', [event('raise', 'income', '2033-01-01', '65000.00', '30')]));
    expect(steps).toEqual([{ eventId: 'raise', from: '2033-01-20', before: '400.00', after: '650.00' }]);
  });
  it('pay cut to $0 floors the amount at 0.00 and is visible', () => {
    const steps = budgetTimeline(plan([loan('g', '30000.00', '0.065')], '400.00', [event('cut', 'income', '2032-01-01', '43000.00', '50')]));
    // (43,000 − 55,000) / 12 × 50% = −500 → 400 − 500 floored at 0.
    expect(steps[0]).toMatchObject({ before: '400.00', after: '0.00' });
  });
});

// ------------------------------------------------------------------------- Create loan from gap (implementer change, 2026-10-18)
describe('create loan from gap offers only what is still needed: max(0, gap × (1 + buffer) − loans for the year)', () => {
  function year1(buffer: string, loans: PlannerLoan[]): PlannerPlan {
    const p = plan(loans, '400.00');
    p.schoolYears = p.schoolYears.map((y, i) => i !== 0 ? y : {
      ...y, bufferPercent: buffer,
      costItems: [{ id: 'c', category: 'tuition', label: 'c', amount: '25000.00', semester: 'annual' }],
      resources: [{ id: 'g', type: 'grant', label: 'g', amount: '11600.00', incomeMode: 'fixed', hourlyWage: '0', hoursPerWeek: '0', weeksWorked: '0', unavailablePercent: '0' }],
    });
    return p;
  }
  const y1 = (id: string, principal: string) => loan(id, principal, '0.0639', { disbursementDate: '2026-08-24', academicYear: '2026-2027' });
  it('gap 13,400, loans 11,000, no buffer → 2,400.00', () => {
    const p = year1('0', [y1('a', '8000.00'), y1('b', '3000.00')]);
    expect(createLoanFromGap(p, p.schoolYears[0].id, 'n').principal).toBe('2400.00');
  });
  it('buffer 10%: 13,400 × 1.1 = 14,740 − 11,000 → 3,740.00; gapAtCreation records 14,740.00', () => {
    const p = year1('10', [y1('a', '8000.00'), y1('b', '3000.00')]);
    expect(createLoanFromGap(p, p.schoolYears[0].id, 'n')).toMatchObject({ principal: '3740.00', gapAtCreation: '14740.00', academicYear: '2026-2027' });
  });
  it('already fully funded → 0.00, never negative', () => {
    const p = year1('0', [y1('a', '20000.00')]);
    expect(createLoanFromGap(p, p.schoolYears[0].id, 'n').principal).toBe('0.00');
  });
});
