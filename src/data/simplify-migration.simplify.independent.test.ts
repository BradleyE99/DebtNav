/**
 * Independent P3 (incomplete-input checklist) and P4 (saved plans survive the simplified app: load → edit → save →
 * export → import with no data loss) tests (tester).
 */
import { describe, it, expect } from 'vitest';
import { createDefaultPlan, calculatePlannerOutputs } from '../engine/planner';
import type { PlannerDocument, PlannerPlan, StorageLike } from '../engine/planner-contracts';
import { exportDocument, importDocument, loadDocument, saveDocument } from './storage';
import { getPlanReadiness } from './readiness';

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); } };
}

/** A plan using every hidden / secondary feature the simplified UI no longer shows in primary navigation. */
function richPlan(): PlannerPlan {
  const base = createDefaultPlan();
  const [y1, y2] = base.schoolYears;
  return {
    ...base,
    schoolYears: base.schoolYears.map((y, i) => i === 0 ? {
      ...y, bufferPercent: '5',
      costItems: [{ id: 'c1', category: 'tuition', label: 'Tuition', amount: '20000.00', semester: 'fall' }, { id: 'c2', category: 'housing', label: 'Rent', amount: '8100.00', semester: 'annual' }],
      resources: [
        { id: 'r1', type: 'grant', label: 'Pell', amount: '5403.00', incomeMode: 'fixed', hourlyWage: '0', hoursPerWeek: '0', weeksWorked: '0', unavailablePercent: '0' },
        { id: 'r2', type: 'job', label: 'Co-op', amount: '0.00', incomeMode: 'hourly', hourlyWage: '25.00', hoursPerWeek: '40', weeksWorked: '19', unavailablePercent: '20' },
      ],
    } : y),
    loans: [
      { id: 'L1', name: 'Unsub Y1', type: 'unsubsidized', principal: '5500.00', annualRate: '0.0639', disbursementDate: y1.startDate, termMonths: 120, academicYear: '2026-2027', schoolYearId: y1.id, gapAtCreation: '5500.00', capitalizeInterest: false },
      { id: 'L2', name: 'Private', type: 'private', principal: '12000.00', annualRate: '0.0907', disbursementDate: y2.startDate, termMonths: 180, academicYear: '2026-2027', requiredPayment: { graceMonths: 9 }, monthlyPayment: '150.00' },
      { id: 'L3', name: 'Unassigned', type: 'subsidized', principal: '3500.00', annualRate: '0.0653', disbursementDate: y2.startDate, termMonths: 120, academicYear: 'unassigned' },
    ],
    repayment: {
      ...base.repayment, strategyId: 'custom', customOrder: ['L2', 'L1', 'L3'], extraMonthlyPayment: '25.00',
      payoffTarget: { mode: 'target', kind: 'duration', months: 96 }, voluntaryStart: { kind: 'date', date: '2030-09-01' },
      mode: 'federal', federalPlan: 'ibr', familySize: 3, annualAGI: '61000.00',
    },
    postGradIncome: { annualSalary: '62000.00', monthlyDebtBudget: '650.00', raiseAllocationPercent: '40', monthlyTakeHome: '3900.00', monthlyExpenses: '2600.00' },
    lifeEvents: [
      { id: 'e-raise', name: 'Raise', date: '2032-07-01', type: 'income', amount: '70000.00', allocationPercent: '30' },
      { id: 'e-bonus', name: 'Bonus', date: '2033-03-15', type: 'windfall', amount: '4000.00', allocationPercent: '50', recurrence: 'yearly', recurrenceEndDate: '2036-03-15' },
      { id: 'e-exp', name: 'Laptop', date: '2027-01-05', type: 'expense', amount: '1500.00', allocationPercent: '0', schoolYearId: y1.id },
      { id: 'e-aid', name: 'Extra aid', date: '2028-02-01', type: 'aid', amount: '2000.00', allocationPercent: '0' },
    ],
    scenarios: [{ id: 's1', name: 'Higher salary', overrides: { 'postGradIncome.monthlyDebtBudget': '900.00', 'loans.L2.annualRate': '0.08' } }],
    borrower: { dependency: 'independent', level: 'graduate', priorFederalDebt: '4000.00' },
  };
}

describe('P4 saved plans survive the simplified app without loss', () => {
  it('rich plan is valid input (sanity)', () => {
    expect(calculatePlannerOutputs(richPlan()).ok).toBe(true);
  });
  it('save → load → edit budget → save → load keeps every other field exactly', () => {
    const storage = memoryStorage();
    const doc: PlannerDocument = { plan: richPlan(), disclaimerDismissed: true };
    expect(saveDocument(doc, storage).ok).toBe(true);
    const loaded = loadDocument(storage);
    expect(loaded.document).toEqual(doc);
    const edited: PlannerDocument = { ...loaded.document!, plan: { ...loaded.document!.plan, postGradIncome: { ...loaded.document!.plan.postGradIncome, monthlyDebtBudget: '700.00' } } };
    expect(saveDocument(edited, storage).ok).toBe(true);
    const again = loadDocument(storage).document!;
    expect(again.plan.postGradIncome.monthlyDebtBudget).toBe('700.00');
    expect({ ...again.plan, postGradIncome: { ...again.plan.postGradIncome, monthlyDebtBudget: '650.00' } }).toEqual(doc.plan);
  });
  it('JSON export → import round trip is lossless (scenarios, all four life-event types, federal, academic years, legacy extra)', () => {
    const doc: PlannerDocument = { plan: richPlan(), disclaimerDismissed: true };
    const back = importDocument(exportDocument(doc));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value).toEqual(doc);
    expect(back.value.plan.lifeEvents.map(e => e.type)).toEqual(['income', 'windfall', 'expense', 'aid']);
    expect(back.value.plan.loans.map(l => l.academicYear)).toEqual(['2026-2027', '2026-2027', 'unassigned']);
    expect(back.value.plan.repayment).toMatchObject({ mode: 'federal', federalPlan: 'ibr', familySize: 3, extraMonthlyPayment: '25.00' });
  });
  it('a loan saved before academic years existed keeps its year attribution on load', () => {
    const plan = richPlan();
    const { academicYear: _drop, ...legacy } = plan.loans[0];
    void _drop;
    const storage = memoryStorage();
    saveDocument({ plan: { ...plan, loans: [legacy, ...plan.loans.slice(1)] }, disclaimerDismissed: true }, storage);
    const loaded = loadDocument(storage).document!;
    const outputs = calculatePlannerOutputs(loaded.plan);
    expect(outputs.ok).toBe(true);
    if (!outputs.ok) return;
    // L1 (5,500, schoolYearId = year 1) + L2 (12,000) are year 1; L3 unassigned.
    expect(outputs.value.years[0].borrowed).toBe('17500.00');
  });
});

describe('P3 incomplete-input checklist: actionable, never fake numbers', () => {
  const readiness = (plan: PlannerPlan) => {
    const out = calculatePlannerOutputs(plan);
    return getPlanReadiness(plan, { outputs: out.ok ? out.value : null, projectionErrors: out.ok ? [] : out.errors });
  };
  it('no loans → "loans.none" missing item with a target, and debt-free date is not complete', () => {
    const plan = { ...createDefaultPlan(), loans: [] };
    const r = readiness(plan);
    const item = r.items.find(i => i.id === 'loans.none');
    expect(item?.severity).toBe('missing');
    expect(item?.target.fieldId).toBeTruthy();
    expect(r.results.debtFreeDate.state).not.toBe('complete');
  });
  it('budget 0 with a loan → "budget.zero" pointing at the monthly budget field; no debt-free date', () => {
    const base = createDefaultPlan();
    const plan: PlannerPlan = { ...base, loans: [{ id: 'a', name: 'A', type: 'unsubsidized', principal: '10000.00', annualRate: '0.06', disbursementDate: '2026-08-24', termMonths: 120, academicYear: '2026-2027' }], postGradIncome: { ...base.postGradIncome, monthlyDebtBudget: '0.00' } };
    const r = readiness(plan);
    const item = r.items.find(i => i.id === 'budget.zero');
    expect(item?.target.fieldId).toBe('postGradIncome.monthlyDebtBudget');
    expect(r.results.debtFreeDate.state).not.toBe('complete');
    expect(r.results.debtFreeDate.summary ?? '').not.toMatch(/\$0\.00|\d{4}-\d{2}-\d{2}/);
  });
  it('payment below interest → non-payoff state with a warning item, not a date', () => {
    const base = createDefaultPlan();
    const plan: PlannerPlan = { ...base, loans: [{ id: 'h', name: 'H', type: 'unsubsidized', principal: '30000.00', annualRate: '0.065', disbursementDate: '2030-11-20', termMonths: 120, academicYear: 'unassigned' }], postGradIncome: { ...base.postGradIncome, monthlyDebtBudget: '150.00' } };
    const r = readiness(plan);
    expect(r.results.debtFreeDate.state).toBe('nonPayoff');
    expect(r.items.some(i => i.id === 'repayment.nonPayoff' || i.id === 'budget.shortfall')).toBe(true);
  });
  it('every checklist item has a target field id and an action label', () => {
    const plan = { ...createDefaultPlan(), loans: [] };
    for (const item of readiness(plan).items) {
      expect(item.target.fieldId, item.id).toBeTruthy();
      expect(item.actionLabel, item.id).toBeTruthy();
    }
  });
});
