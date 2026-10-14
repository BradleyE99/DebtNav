import { expect, it } from 'vitest';
import { createDefaultPlan } from '../engine/planner';
import { fieldIdForPath } from './planUpdates';

it('addresses an all-digit loan id by id, and legacy index paths by index (review n1)', () => {
  const plan = createDefaultPlan();
  const base = { name: 'L', type: 'unsubsidized' as const, principal: '1000', annualRate: '0.05', disbursementDate: plan.settings.startDate, termMonths: 120 };
  plan.loans = [{ ...base, id: 'abc' }, { ...base, id: '0' }];
  expect(fieldIdForPath(plan, 'loans.0.disbursementDate')).toBe('loans.0.disbursementDate');
  expect(fieldIdForPath(plan, 'loans.1.principal')).toBe('loans.0.principal');
  expect(fieldIdForPath(plan, 'loans.abc.principal')).toBe('loans.abc.principal');
});
