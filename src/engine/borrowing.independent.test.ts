/**
 * Independent US-1006 checks (tester): gap, surplus, allocated (borrowed) and remaining unfunded per academic year.
 * Expected values: team/tester-expected.md §7 (hand arithmetic).
 */
import { describe, it, expect } from 'vitest';
import { calculatePlannerOutputs } from './planner';
import type { CostItem, PlannerPlan, Resource, YearSummary } from './planner-contracts';
import type { PlannerLoan, PlannerPlan as Plan_, VoluntaryStart } from './planner-contracts';
import { createDefaultPlan } from './planner';

// Plan helpers (shared shape with team/tester-expected.md).
/** Default plan: graduation 2030-05-20; federal repayment period start R = 2030-11-20; first required payment 2030-12-20. */
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


const cost = (id: string, amount: string): CostItem => ({ id, category: 'tuition', label: id, amount, semester: 'annual' });
const grant = (id: string, amount: string): Resource => ({
  id, type: 'grant', label: id, amount, incomeMode: 'fixed', hourlyWage: '0', hoursPerWeek: '0', weeksWorked: '0', unavailablePercent: '0',
});

function year(plan: PlannerPlan, index: number): YearSummary {
  const out = calculatePlannerOutputs(plan);
  if (!out.ok) throw new Error(JSON.stringify(out.errors));
  return out.value.years[index];
}
/** Year 1 = 2026-2027 and year 2 = 2027-2028 in the default plan. */
function withYear1(costs: string, resources: string, loans: ReturnType<typeof loan>[], bufferPercent = '0'): PlannerPlan {
  const plan = planWith(loans, '400.00');
  plan.schoolYears = plan.schoolYears.map((y, i) => i === 0 ? { ...y, costItems: [cost('c', costs)], resources: [grant('g', resources)], bufferPercent } : y);
  return plan;
}
const y1 = (id: string, principal: string) => loan(id, principal, '0.05', { disbursementDate: '2026-08-24', academicYear: '2026-2027' });

describe('US-1006 annual borrowing clarity', () => {
  it('gap 12,000, allocated 8,000 → remaining 4,000', () => {
    expect(year(withYear1('20000.00', '8000.00', [y1('a', '5000.00'), y1('b', '3000.00')]), 0))
      .toMatchObject({ gap: '12000.00', surplus: '0.00', borrowed: '8000.00', remaining: '4000.00' });
  });
  it('over-allocation never makes remaining negative', () => {
    expect(year(withYear1('20000.00', '8000.00', [y1('a', '15000.00')]), 0)).toMatchObject({ gap: '12000.00', borrowed: '15000.00', remaining: '0.00' });
  });
  it('surplus is separate and loan money is never counted as a resource', () => {
    expect(year(withYear1('5000.00', '7000.00', [y1('a', '1000.00')]), 0))
      .toMatchObject({ costs: '5000.00', resources: '7000.00', gap: '0.00', surplus: '2000.00', borrowed: '1000.00', remaining: '0.00' });
  });
  it('remaining uses the gap, not gap + buffer', () => {
    expect(year(withYear1('20000.00', '8000.00', [y1('a', '12500.00')], '10'), 0))
      .toMatchObject({ gap: '12000.00', bufferedGap: '13200.00', borrowed: '12500.00', remaining: '0.00' });
    expect(year(withYear1('20000.00', '8000.00', [y1('a', '11000.00')], '10'), 0)).toMatchObject({ remaining: '1000.00' });
  });
  it('allocation follows the academic year, not the disbursement date; unassigned counts nowhere', () => {
    const plan = withYear1('20000.00', '8000.00', [
      loan('y2', '4000.00', '0.05', { disbursementDate: '2026-08-24', academicYear: '2027-2028' }),
      loan('u', '3000.00', '0.05', { disbursementDate: '2026-08-24', academicYear: 'unassigned' }),
    ]);
    expect(year(plan, 0)).toMatchObject({ borrowed: '0.00', remaining: '12000.00' });
    expect(year(plan, 1)).toMatchObject({ borrowed: '4000.00', gap: '0.00', remaining: '0.00' });
  });
  it('an explicit zero cost is a valid value (gap 0.00)', () => {
    expect(year(withYear1('0.00', '0.00', []), 0)).toMatchObject({ gap: '0.00', remaining: '0.00', borrowed: '0.00' });
  });
});
