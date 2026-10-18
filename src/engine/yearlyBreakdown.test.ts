import { describe, expect, it } from 'vitest';
import { calculatePlannerOutputs, createDefaultPlan } from './planner';
import type { PlannerLoan, PlannerPlan } from './planner-contracts';
import type { Projection } from './contracts';
import { D } from './money';
import { yearlyBreakdown } from './yearlyBreakdown';

const loan = (id: string, principal: string, annualRate: string, extra: Partial<PlannerLoan> = {}): PlannerLoan => ({
  id, name: id, type: 'unsubsidized', principal, annualRate, disbursementDate: '2026-08-24', termMonths: 120, ...extra,
});
function projectionOf(edit: (p: PlannerPlan) => void): Projection {
  const p = createDefaultPlan();
  edit(p);
  const out = calculatePlannerOutputs(p);
  if (!out.ok || !out.value.repayment) throw new Error('plan must project');
  return out.value.repayment;
}

const plans: [string, (p: PlannerPlan) => void][] = [
  ['two loans, raise and yearly bonus', p => {
    p.loans = [loan('a', '10000.00', '0.05'), loan('b', '5000.00', '0.07', { capitalizeInterest: false })];
    p.postGradIncome.monthlyDebtBudget = '300.00';
    p.lifeEvents = [
      { id: 'raise', name: 'Raise', type: 'income', date: '2032-01-01', amount: '67000.00', allocationPercent: '50' },
      { id: 'bonus', name: 'Bonus', type: 'windfall', date: '2033-06-01', amount: '4000.00', allocationPercent: '50', recurrence: 'yearly' },
    ];
  }],
  ['payments start at graduation (grace months)', p => {
    p.loans = [loan('a', '10000.00', '0.06')];
    p.repayment.voluntaryStart = { kind: 'afterGraduation', months: 0 };
    p.postGradIncome.monthlyDebtBudget = '200.00';
  }],
  ['not paid off', p => { p.loans = [loan('a', '30000.00', '0.065')]; p.postGradIncome.monthlyDebtBudget = '50.00'; }],
];

describe('yearlyBreakdown (C11)', () => {
  for (const [name, edit] of plans) {
    for (const basis of ['calendar', 'repayment'] as const) {
      it(`${name}, ${basis} years: rows reconcile and sum to the projection`, () => {
        const projection = projectionOf(edit);
        const breakdown = yearlyBreakdown(projection, basis);
        expect(breakdown.rows.length).toBeGreaterThan(0);
        expect(breakdown.rows[0].startBalance).toBe(projection.owedAtVoluntaryStart);
        let months = 0;
        breakdown.rows.forEach((row, i) => {
          if (i > 0) expect(row.startBalance).toBe(breakdown.rows[i - 1].endBalance);
          expect(new D(row.startBalance).plus(row.newBorrowing).plus(row.interest).minus(row.payments).toFixed(2)).toBe(row.endBalance);
          expect(new D(row.bonus).lte(row.payments)).toBe(true);
          if (basis === 'repayment' && i < breakdown.rows.length - 1) expect(row.months).toBe(12);
          months += row.months;
        });
        expect(months).toBe(projection.amortizationSchedule.length);
        expect(breakdown.totals.payments).toBe(projection.totalRepaymentPayments);
        expect(breakdown.paidOff).toBe(projection.status === 'paidOff');
        if (breakdown.paidOff) expect(breakdown.remainingBalance).toBe('0.00');
        else expect(new D(breakdown.remainingBalance).gt(0)).toBe(true);
      });
    }
  }

  it('reports the bonus applied inside the payments of its year', () => {
    const projection = projectionOf(plans[0][1]);
    const breakdown = yearlyBreakdown(projection, 'calendar');
    const row2033 = breakdown.rows.find(row => row.year === 2033)!;
    expect(row2033.bonus).toBe('2000.00');
  });
});
