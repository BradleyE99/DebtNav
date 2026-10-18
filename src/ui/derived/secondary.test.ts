import { describe, it, expect } from 'vitest';
import { createDefaultPlan } from '../../engine/planner';
import { computeSecondary, computeTarget } from './secondary';

const TODAY = '2026-10-16';
function plan() {
  const p = createDefaultPlan();
  p.loans = [{ id: 'z', name: 'Loan', type: 'unsubsidized', principal: '12000.00', annualRate: '0', disbursementDate: '2030-11-20', termMonths: 120 }];
  return p;
}

describe('secondary results (worker computation)', () => {
  it('has no target result in budget mode and no federal models (US-905)', () => {
    const result = computeSecondary(plan(), TODAY);
    expect(result.target).toBeNull();
    expect(result.comparisons.ok).toBe(true);
    expect(Object.keys(result).sort()).toEqual(['comparisons', 'target']);
  });

  it('solves the payoff target off the main thread path (US-506)', () => {
    const p = plan();
    p.repayment.payoffTarget = { mode: 'target', kind: 'duration', months: 12 };
    expect(computeSecondary(p, TODAY).target).toMatchObject({ status: 'feasible', requiredMonthlyBudget: '1000.00' });
    p.repayment.payoffTarget = { mode: 'target', kind: 'date', date: '2026-01-01' };
    expect(computeTarget(p, TODAY)).toMatchObject({ status: 'invalid', reason: 'pastTarget' });
  });
});
