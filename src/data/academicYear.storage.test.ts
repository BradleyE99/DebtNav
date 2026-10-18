/** Academic years survive export/import and storage; older plans gain them without losing data. */
import { describe, expect, it } from 'vitest';
import type { PlannerDocument, PlannerLoan, PlannerPlan } from '../engine/planner-contracts';
import { createDefaultPlan } from '../engine/planner';
import { exportDocument, importDocument, loadDocument, saveDocument } from './storage';
import { validatePlannerPlan as validatePlan } from './validation';

const loan = (id: string, extra: Partial<PlannerLoan> = {}): PlannerLoan => ({
  id, name: id, type: 'unsubsidized', principal: '5000.00', annualRate: '0.05', disbursementDate: '2026-08-24', termMonths: 120, ...extra,
});
function planWith(...loans: PlannerLoan[]): PlannerPlan {
  const plan = createDefaultPlan();
  return { ...plan, loans, repayment: { ...plan.repayment, customOrder: loans.map(item => item.id) } };
}
const doc = (plan: PlannerPlan): PlannerDocument => ({ plan, disclaimerDismissed: true });
function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

describe('academic year persistence', () => {
  it('round-trips through export/import and storage', () => {
    const plan = planWith(loan('a', { academicYear: '2027-2028' }), loan('b', { academicYear: '2024-2025' }), loan('c', { academicYear: 'unassigned' }));
    const imported = importDocument(exportDocument(doc(plan)));
    expect(imported.ok && imported.value.plan.loans).toEqual(plan.loans);
    const storage = memory();
    expect(saveDocument(doc(plan), storage).ok).toBe(true);
    expect(loadDocument(storage).document?.plan.loans).toEqual(plan.loans);
  });

  it('assigns older loans only from the school year they already counted toward, keeping every other field', () => {
    const base = createDefaultPlan();
    const legacy = planWith(
      loan('gap', { schoolYearId: base.schoolYears[1].id, gapAtCreation: '5000.00', disbursementDate: '2026-09-01' }),
      loan('dated', { disbursementDate: '2029-02-01', monthlyPayment: '75.00' }),
      loan('outside', { disbursementDate: '2025-06-01' }),
    );
    const imported = importDocument(exportDocument(doc(legacy)));
    if (!imported.ok) throw new Error(imported.errors[0].message);
    expect(imported.value.plan.loans).toEqual([
      { ...legacy.loans[0], academicYear: '2027-2028' },
      { ...legacy.loans[1], academicYear: '2028-2029' },
      { ...legacy.loans[2], academicYear: 'unassigned' },
    ]);
  });

  it('rejects malformed academic years at the field', () => {
    const result = validatePlan(planWith(loan('a', { academicYear: '2026-2028' })));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map(error => error.path)).toContain('loans.a.academicYear');
  });
});
