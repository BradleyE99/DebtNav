/**
 * Readiness layer (tester). Expectations come from docs/USABILITY-BRIEF.md §2/§6/§8, the SRS and
 * math's state rules, not from the implementation. The context passed in mirrors what the UI has:
 * engine outputs, projection errors and worker comparisons.
 */
/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import readinessSource from './readiness.ts?raw';
import type { CostItem, LifeEvent, PlannerLoan, PlannerPlan, Resource, Scenario, TargetPaymentOutput } from '../engine/planner-contracts';
import { createDefaultPlan, calculatePlannerOutputs, calculatePlannerComparisons } from '../engine/planner';
import {
  getPlanReadiness, fieldRecordExists, dashboardForFieldId, RESULT_KEYS, type PlanReadiness, type ReadinessItem, type ResultKey, type ReadinessContext,
} from './readiness';

const REPAYMENT_KEYS: ResultKey[] = ['debtFreeDate', 'totalInterest', 'paymentSchedule', 'balanceChart', 'strategyComparison'];
const LOAN_KEYS: ResultKey[] = ['totalBorrowed', 'loanDetails', 'minimumPayments', ...REPAYMENT_KEYS];
const DASHBOARDS = ['overview', 'income', 'setup', 'school', 'loans', 'repayment', 'events', 'scenarios', 'federal', 'results', 'data'];
const SEVERITY_ORDER = ['invalid', 'missing', 'warning', 'assumption'];

const loan = (id: string, principal: string, extra: Partial<PlannerLoan> = {}): PlannerLoan => ({
  id, name: id, type: 'private', principal, annualRate: '0.065', disbursementDate: '2030-11-20', termMonths: 120, ...extra,
});
const cost = (id: string, amount: string): CostItem => ({ id, category: 'tuition', label: id, amount, semester: 'annual' });
const resource = (id: string, type: Resource['type'], amount: string, extra: Partial<Resource> = {}): Resource => ({
  id, type, label: id, amount, incomeMode: 'fixed', hourlyWage: '0.00', hoursPerWeek: '0', weeksWorked: '0', unavailablePercent: '0', ...extra,
});
const event = (id: string, type: LifeEvent['type'], amount: string, extra: Partial<LifeEvent> = {}): LifeEvent => ({
  id, name: id, date: '2031-06-01', type, amount, allocationPercent: '100', ...extra,
});

function plan(edit: (p: PlannerPlan) => void = () => {}): PlannerPlan {
  const p = createDefaultPlan();
  edit(p);
  return p;
}
/** Complete plan: costs in every year, one $30,000 private loan, budget confirmed at $340.64 (not the default). */
function completePlan(edit: (p: PlannerPlan) => void = () => {}): PlannerPlan {
  return plan(p => {
    p.schoolYears.forEach((year, i) => { year.costItems = [cost(`c${i}`, '10000.00')]; });
    p.loans = [loan('L1', '30000.00')];
    p.postGradIncome.monthlyDebtBudget = '340.64';
    edit(p);
  });
}
function contextFor(p: PlannerPlan, extra: Partial<ReadinessContext> = {}): ReadinessContext {
  const outputs = calculatePlannerOutputs(p);
  const comparisons = calculatePlannerComparisons(p);
  return {
    outputs: outputs.ok ? outputs.value : null,
    projectionErrors: outputs.ok ? outputs.value.repaymentUnavailable?.errors ?? [] : outputs.errors,
    comparisons: comparisons.ok ? comparisons.value : null,
    ...extra,
  };
}
const ready = (p: PlannerPlan, extra: Partial<ReadinessContext> = {}): PlanReadiness => getPlanReadiness(p, contextFor(p, extra));
const item = (r: PlanReadiness, id: string): ReadinessItem | undefined => r.items.find(i => i.id === id);
const ofSeverity = (r: PlanReadiness, severity: string) => r.items.filter(i => i.severity === severity);
const blockers = (r: PlanReadiness) => r.items.filter(i => i.severity === 'missing' || i.severity === 'invalid');

/** Structural invariants every readiness result must satisfy. */
function expectWellFormed(r: PlanReadiness) {
  expect(Object.keys(r.results).sort()).toEqual([...RESULT_KEYS].sort());
  const ids = r.items.map(i => i.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const i of r.items) {
    expect(i.label.trim()).not.toBe('');
    expect(i.why.trim()).not.toBe('');
    expect(i.actionLabel.trim()).not.toBe('');
    expect(DASHBOARDS).toContain(i.target.dashboard);
    expect(i.target.fieldId.trim()).not.toBe('');
    expect(i.target.fieldId).not.toBe('repayment.extraMonthlyPayment'); // no UI field exists (brief §3.9)
    for (const key of i.blocks) expect(RESULT_KEYS).toContain(key);
  }
  // Sorted by severity first.
  const ranks = r.items.map(i => SEVERITY_ORDER.indexOf(i.severity));
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  // Counts agree with items.
  for (const s of SEVERITY_ORDER) expect(r.counts[s as keyof typeof r.counts]).toBe(ofSeverity(r, s).length);
  // byDashboard counts missing + invalid only.
  const expected: Record<string, number> = {};
  for (const i of blockers(r)) expected[i.target.dashboard] = (expected[i.target.dashboard] ?? 0) + 1;
  for (const d of DASHBOARDS) expect(r.byDashboard[d as keyof typeof r.byDashboard] ?? 0).toBe(expected[d] ?? 0);
  // Result states reference real items; complete results reference none.
  for (const key of RESULT_KEYS) {
    const status = r.results[key];
    for (const id of status.itemIds) expect(ids).toContain(id);
    if (status.state === 'complete') expect(status.itemIds, key).toEqual([]); // brief §6; warnings qualify via items[].blocks
    if (status.state === 'incomplete' || status.state === 'invalid') {
      expect(status.itemIds.length).toBeGreaterThan(0);
      const severities = status.itemIds.map(id => item(r, id)!.severity);
      expect(severities.some(s => s === (status.state === 'invalid' ? 'invalid' : 'missing'))).toBe(true);
    }
    if (status.state === 'estimate') expect(status.itemIds.some(id => item(r, id)!.severity === 'assumption')).toBe(true);
  }
}

describe('readiness: module contract (§8.11)', () => {
  it('imports nothing from React or the DOM', () => {
    const source = readinessSource;
    expect(source).not.toMatch(/from ['"]react/);
    expect(source).not.toMatch(/\b(document|window|localStorage)\./);
    expect(source).not.toMatch(/Date\.now|new Date\(\)/);
  });

  it('works without a context and never mutates the plan', () => {
    const p = completePlan();
    const snapshot = JSON.stringify(p);
    const r = getPlanReadiness(Object.freeze(p));
    expect(JSON.stringify(p)).toBe(snapshot);
    expect(Object.keys(r.results).sort()).toEqual([...RESULT_KEYS].sort());
  });

  it('is deterministic', () => {
    const p = completePlan();
    expect(ready(p)).toEqual(ready(p));
  });
});

describe('readiness: empty (default) plan (§8.1)', () => {
  const r = ready(createDefaultPlan());

  it('is well formed', () => expectWellFormed(r));

  it('lists "loans.none" and "costs.none" as missing', () => {
    expect(item(r, 'loans.none')?.severity).toBe('missing');
    expect(item(r, 'costs.none')?.severity).toBe('missing');
  });

  it('loans.none targets the Loans add button; costs.none targets the first year add-cost button', () => {
    const p = createDefaultPlan();
    expect(item(r, 'loans.none')?.target).toEqual({ dashboard: 'loans', fieldId: 'loans-add' });
    expect(item(r, 'costs.none')?.target).toEqual({ dashboard: 'school', fieldId: `schoolYears.${p.schoolYears[0].id}.costItems-add` });
  });

  it('every loan-dependent result is incomplete (no $0 totals or debt-free date), the timeline is complete', () => {
    for (const key of LOAN_KEYS) expect(r.results[key].state, key).toBe('incomplete');
    expect(r.results.debtFreeDate.itemIds).toContain('loans.none');
    expect(r.results.borrowingGap.state).toBe('incomplete');
    expect(r.results.timeline.state).toBe('complete');
  });

  it('optional comparisons are not applicable rather than missing', () => {
    expect(r.results.scenarioComparison.state).toBe('notApplicable');
    expect(r.results.eventImpacts.state).toBe('notApplicable');
    expect(r.results.targetPayment.state).toBe('notApplicable'); // budget mode (the default)
  });

  it('does not flag the default budget, salary or AGI as assumptions while there are no loans', () => {
    expect(item(r, 'budget.default')).toBeUndefined();
    expect(item(r, 'federal.agiDefault')).toBeUndefined();
    expect(item(r, 'salary.baseline')).toBeUndefined();
  });

  it('flow order: costs (school) item comes before the loans item', () => {
    const ids = r.items.map(i => i.id);
    expect(ids.indexOf('costs.none')).toBeLessThan(ids.indexOf('loans.none'));
  });
});

describe('readiness: loans', () => {
  it('all loans at $0 → loans.allZero missing, targeting the first loan principal; repayment stays incomplete (§3.2)', () => {
    const r = ready(plan(p => { p.loans = [loan('A', '0.00'), loan('B', '0.00')]; }));
    expectWellFormed(r);
    expect(item(r, 'loans.none')).toBeUndefined();
    expect(item(r, 'loans.allZero')).toMatchObject({ severity: 'missing', target: { dashboard: 'loans', fieldId: 'loans.A.principal' } });
    for (const key of LOAN_KEYS) expect(r.results[key].state, key).toBe('incomplete');
  });

  it('one of two loans at $0 → per-loan warning only; results are available', () => {
    const r = ready(completePlan(p => { p.loans.push(loan('Z', '0.00')); }));
    expectWellFormed(r);
    expect(item(r, 'loan.Z.zeroPrincipal')).toMatchObject({ severity: 'warning', target: { dashboard: 'loans', fieldId: 'loans.Z.principal' } });
    expect(item(r, 'loans.allZero')).toBeUndefined();
    expect(r.results.debtFreeDate.state).toBe('complete');
    expect(r.results.totalBorrowed.state).not.toBe('incomplete');
  });
});

describe('readiness: existing-loan-only repayment (§8.2)', () => {
  // $30,000 @ 6.5%, 120 months, budget $340.64, no costs.
  const p = plan(p => { p.loans = [loan('L1', '30000.00', { type: 'subsidized' })]; p.postGradIncome.monthlyDebtBudget = '340.64'; });
  const r = ready(p);

  it('is well formed', () => expectWellFormed(r));

  it('repayment results are complete; borrowing gap alone is incomplete', () => {
    for (const key of LOAN_KEYS) expect(r.results[key].state, key).toBe('complete');
    expect(r.results.borrowingGap.state).toBe('incomplete');
  });

  it('no missing/invalid item blocks a repayment result; costs.none only blocks borrowingGap', () => {
    for (const i of blockers(r)) for (const key of LOAN_KEYS) expect(i.blocks, `${i.id} blocks ${key}`).not.toContain(key);
    if (item(r, 'costs.none')) expect(item(r, 'costs.none')!.blocks).toEqual(['borrowingGap']);
  });

  // US-905 (was: default AGI was an assumption for federal plans): federal tools are "Coming soon", so stored
  // federal settings never produce readiness items and nothing sends the user to the Federal dashboard.
  it('federal loans with stored federal settings produce no federal items (US-905)', () => {
    expect(item(r, 'federal.agiDefault')).toBeUndefined();
    expect(r.items.filter(i => i.target.dashboard === 'federal')).toEqual([]);
    expect(r.results.debtFreeDate.state).toBe('complete');
  });

  it('federal loans need no required-payment terms (labeled federal estimate)', () => {
    expect(r.items.filter(i => i.id.endsWith('.requiredPaymentUnset'))).toEqual([]);
  });
});

describe('readiness: school-only planning (§8.3)', () => {
  const r = ready(plan(p => { p.schoolYears.forEach((y, i) => { y.costItems = [cost(`c${i}`, '20000.00')]; }); }));

  it('gap is complete, repayment keys incomplete via loans.none', () => {
    expectWellFormed(r);
    expect(r.results.borrowingGap.state).toBe('complete');
    expect(item(r, 'costs.none')).toBeUndefined();
    for (const key of LOAN_KEYS) {
      expect(r.results[key].state, key).toBe('incomplete');
      expect(r.results[key].itemIds).toContain('loans.none');
    }
    expect(item(r, 'loans.none')?.actionLabel).toMatch(/add a loan|create .*loan/i);
  });

  it('a year with no costs while others have costs → costs.year.<id>.empty warning targeting that year', () => {
    const p = plan(p => { p.schoolYears[0].costItems = [cost('c0', '20000.00')]; });
    const r2 = ready(p);
    const y2 = p.schoolYears[1].id;
    expect(item(r2, `costs.year.${y2}.empty`)).toMatchObject({ severity: 'warning', target: { dashboard: 'school', fieldId: `schoolYears.${y2}.costItems-add` } });
    expect(item(r2, `costs.year.${p.schoolYears[0].id}.empty`)).toBeUndefined();
    expect(r2.results.borrowingGap.state).not.toBe('incomplete');
  });

  it('expense events alone count as costs', () => {
    const r2 = ready(plan(p => { p.lifeEvents = [event('e', 'expense', '5000.00', { date: '2027-01-15' })]; }));
    expect(item(r2, 'costs.none')).toBeUndefined();
  });

  it('cost item at $0 → cost.<id>.zero warning targeting its amount field', () => {
    const p = plan(p => { p.schoolYears[0].costItems = [cost('real', '9000.00'), cost('blank', '0.00')]; });
    expect(item(ready(p), 'cost.blank.zero')).toMatchObject({
      severity: 'warning', target: { dashboard: 'school', fieldId: `schoolYears.${p.schoolYears[0].id}.costItems.blank.amount` },
    });
  });

  it('hourly earnings with $0 wage → earnings.<id>.zero targeting the Income dashboard wage field', () => {
    const p = plan(p => { p.schoolYears[0].resources = [resource('job', 'job', '0.00', { incomeMode: 'hourly', hoursPerWeek: '15', weeksWorked: '30' })]; });
    const i = item(ready(p), 'earnings.job.zero');
    expect(i).toMatchObject({ severity: 'warning', target: { dashboard: 'income', fieldId: `schoolYears.${p.schoolYears[0].id}.resources.job.hourlyWage` } });
    expect(i?.blocks).toContain('schoolEarnings');
  });

  it('non-job resource at $0 → resource.<id>.zero warning on the Costs dashboard', () => {
    const p = plan(p => { p.schoolYears[0].costItems = [cost('c', '1.00')]; p.schoolYears[0].resources = [resource('g', 'grant', '0.00')]; });
    expect(item(ready(p), 'resource.g.zero')).toMatchObject({ severity: 'warning', target: { dashboard: 'school', fieldId: `schoolYears.${p.schoolYears[0].id}.resources.g.amount` } });
  });
});

describe('readiness: monthly budget (§8.7, §8.8)', () => {
  // US-501: the monthly budget is edited in Repayment Plan (was Income & Earnings).
  const budgetTarget = { dashboard: 'repayment', fieldId: 'postGradIncome.monthlyDebtBudget' };

  it('budget $0 with a loan → budget.zero missing; repayment keys incomplete (not nonPayoff); minimums still complete', () => {
    const r = ready(completePlan(p => { p.postGradIncome.monthlyDebtBudget = '0.00'; }));
    expectWellFormed(r);
    expect(item(r, 'budget.zero')).toMatchObject({ severity: 'missing', target: budgetTarget });
    for (const key of REPAYMENT_KEYS) expect(r.results[key].state, key).toBe('incomplete');
    expect(r.results.minimumPayments.state).not.toBe('incomplete');
    expect(r.results.loanDetails.state).toBe('complete');
    expect(r.results.totalBorrowed.state).toBe('complete');
  });

  it('budget $0 but a windfall pays everything off → no budget.zero, debt-free date available', () => {
    const r = ready(completePlan(p => {
      p.postGradIncome.monthlyDebtBudget = '0.00';
      p.lifeEvents = [event('bonus', 'windfall', '40000.00', { date: '2031-01-15' })];
    }));
    expect(item(r, 'budget.zero')).toBeUndefined();
    expect(['complete', 'estimate']).toContain(r.results.debtFreeDate.state);
  });

  it('budget $10 below interest → nonPayoff with a budget action; no misleading date', () => {
    const r = ready(completePlan(p => { p.postGradIncome.monthlyDebtBudget = '10.00'; }));
    expectWellFormed(r);
    expect(r.results.debtFreeDate.state).toBe('nonPayoff');
    expect(r.results.totalInterest.state).toBe('nonPayoff');
    const reason = item(r, 'repayment.nonPayoff');
    expect(reason?.target).toEqual(budgetTarget);
    expect(reason?.actionLabel).toMatch(/budget/i);
    expect(r.results.debtFreeDate.itemIds).toContain('repayment.nonPayoff');
    expect(item(r, 'budget.zero')).toBeUndefined();
  });

  it('budget below minimums but above interest → budget.shortfall warning; still pays off (complete)', () => {
    const r = ready(completePlan(p => { p.postGradIncome.monthlyDebtBudget = '200.00'; }));
    expectWellFormed(r);
    expect(item(r, 'budget.shortfall')).toMatchObject({ severity: 'warning', target: budgetTarget });
    expect(item(r, 'budget.shortfall')?.blocks).toContain('minimumPayments');
    expect(r.results.debtFreeDate.state).toBe('complete');
  });

  // US-506: the user-facing projection horizon is gone; only the internal 100-year safety cap remains.
  // A budget barely above the interest pays off after more than 1,200 months.
  const beyondCap = () => {
    const base = completePlan();
    const outputs = calculatePlannerOutputs(base);
    if (!outputs.ok || !outputs.value.repayment) throw new Error('precondition: base plan projects');
    const balance = Number(outputs.value.repayment.balanceAtRepaymentStart);
    const budget = (Math.ceil(balance * 0.065 / 12 * 100) / 100 + 0.05).toFixed(2);
    return completePlan(p => { p.postGradIncome.monthlyDebtBudget = budget; });
  };

  it('payoff beyond the modeled limit → nonPayoff', () => {
    const p = beyondCap();
    const outputs = calculatePlannerOutputs(p);
    expect(outputs.ok && outputs.value.repayment?.status).toBe('horizonExceeded'); // precondition
    const r = ready(p);
    expectWellFormed(r);
    expect(r.results.debtFreeDate.state).toBe('nonPayoff');
    expect(r.results.debtFreeDate.summary).toMatch(/modeled limit/);
    expect(item(r, 'repayment.nonPayoff')?.label).toMatch(/100 years/);
    expect(item(r, 'repayment.nonPayoff')?.why).toMatch(/not forgiveness/);
  });

  it('payoff beyond the modeled limit → budget action only; no projection-horizon action exists', () => {
    const r = ready(beyondCap());
    expect(item(r, 'repayment.nonPayoff')).toMatchObject({ target: budgetTarget });
    expect(item(r, 'repayment.nonPayoff')?.secondaryAction).toBeUndefined();
    expect(JSON.stringify(r.items)).not.toMatch(/maxMonths|horizon/i);
  });

  it('budget below interest (not amortizing) → no horizon action; a longer horizon would not help', () => {
    const r = ready(completePlan(p => { p.postGradIncome.monthlyDebtBudget = '10.00'; }));
    expect(item(r, 'repayment.nonPayoff')).toBeDefined();
    expect(item(r, 'repayment.nonPayoff')?.secondaryAction).toBeUndefined();
  });

  it('untouched default $400 budget with loans → budget.default assumption, debt-free date is an estimate', () => {
    const r = ready(completePlan(p => { p.postGradIncome.monthlyDebtBudget = '400.00'; }));
    expectWellFormed(r);
    expect(item(r, 'budget.default')).toMatchObject({ severity: 'assumption', target: budgetTarget });
    expect(r.results.debtFreeDate.state).toBe('estimate');
    expect(r.results.debtFreeDate.itemIds).toContain('budget.default');
    expect(blockers(r)).toEqual([]);
  });

  it('editing the budget to another value removes the assumption', () => {
    const r = ready(completePlan(p => { p.postGradIncome.monthlyDebtBudget = '401.00'; }));
    expect(item(r, 'budget.default')).toBeUndefined();
    expect(r.results.debtFreeDate.state).toBe('complete');
  });
});

describe('readiness: valid zeros are never missing (§8.4)', () => {
  const cases: [string, (p: PlannerPlan) => void][] = [
    ['0% interest rate', p => { p.loans[0].annualRate = '0'; }],
    ['gap $0 because resources cover costs', p => { p.schoolYears.forEach((y, i) => { y.resources = [resource(`g${i}`, 'grant', '10000.00')]; }); }],
    ['$0 AGI', p => { p.repayment.annualAGI = '0.00'; }],
    // v4: grace is per loan (US-507); was the global settings.graceMonths = 0.
    ['0 grace months on a private loan', p => { p.loans[0].requiredPayment = { graceMonths: 0 }; p.loans[0].disbursementDate = '2030-05-20'; }],
    ['payments start 0 months after graduation', p => { p.repayment.voluntaryStart = { kind: 'afterGraduation', months: 0 }; p.loans[0].disbursementDate = '2030-05-20'; }],
    ['$0 take-home pay and $0 expenses', p => { p.postGradIncome.monthlyTakeHome = '0.00'; p.postGradIncome.monthlyExpenses = '0.00'; }],
    ['0% buffer', p => { p.schoolYears.forEach(y => { y.bufferPercent = '0'; }); }],
    ['$0 prior federal debt', p => { p.borrower.priorFederalDebt = '0.00'; }],
    ['"job ends" income event ($0)', p => { p.lifeEvents = [event('jobEnds', 'income', '0.00', { date: '2035-01-01' })]; p.postGradIncome.annualSalary = '60000.00'; }],
  ];
  for (const [name, edit] of cases) {
    it(name, () => {
      const r = ready(completePlan(edit));
      expectWellFormed(r);
      expect(blockers(r).map(i => i.id)).toEqual([]);
    });
  }

  it('blank optional take-home pay and expenses are not missing either', () => {
    const r = ready(completePlan());
    expect(r.items.some(i => /takeHome|Expenses/.test(i.target.fieldId))).toBe(false);
  });
});

describe('readiness: salary baseline for income events', () => {
  it('income event with default salary → salary.baseline assumption on the Repayment Plan dashboard (US-501)', () => {
    const r = ready(completePlan(p => { p.lifeEvents = [event('raise', 'income', '65000.00', { date: '2031-01-01', allocationPercent: '50' })]; }));
    expect(item(r, 'salary.baseline')).toMatchObject({ severity: 'assumption', target: { dashboard: 'repayment', fieldId: 'postGradIncome.annualSalary' } });
    expect(r.results.eventImpacts.state).not.toBe('notApplicable');
  });

  it('income event with $0 salary → salary.baseline warning', () => {
    const r = ready(completePlan(p => { p.postGradIncome.annualSalary = '0.00'; p.lifeEvents = [event('raise', 'income', '65000.00')]; }));
    expect(item(r, 'salary.baseline')?.severity).toBe('warning');
  });

  it('salary is never required without income events', () => {
    const r = ready(completePlan(p => { p.postGradIncome.annualSalary = '0.00'; }));
    expect(item(r, 'salary.baseline')).toBeUndefined();
    expect(blockers(r)).toEqual([]);
  });
});

describe('readiness: invalid states', () => {
  it('engine error (loan disbursed after repayment starts) → engine.<path> invalid; repayment keys invalid; gap + timeline still available', () => {
    // v4: checked against the loan's own repayment-period start (US-507); grace 0 → graduation (2030-05-20).
    const p = completePlan(p => { p.loans[0].requiredPayment = { graceMonths: 0 }; p.loans[0].disbursementDate = '2031-06-01'; });
    const ctx = contextFor(p);
    expect(ctx.outputs?.repaymentUnavailable).not.toBeNull(); // precondition
    const r = getPlanReadiness(p, ctx);
    expectWellFormed(r);
    const i = item(r, 'engine.loans.L1.disbursementDate');
    expect(i).toMatchObject({ severity: 'invalid', target: { dashboard: 'loans', fieldId: 'loans.L1.disbursementDate' } });
    for (const key of REPAYMENT_KEYS) expect(r.results[key].state, key).toBe('invalid');
    expect(r.results.borrowingGap.state).toBe('complete');
    expect(r.results.timeline.state).toBe('complete');
  });

  it('planner inputs that cannot be calculated at all (outputs null) → every calculated result is invalid, none complete', () => {
    const p = completePlan();
    const r = getPlanReadiness(p, { outputs: null, projectionErrors: [{ path: 'postGradIncome.monthlyDebtBudget', code: 'INVALID_MONEY', message: 'Enter an amount.' }] });
    expectWellFormed(r);
    expect(item(r, 'engine.postGradIncome.monthlyDebtBudget')).toMatchObject({ severity: 'invalid', target: { dashboard: 'repayment', fieldId: 'postGradIncome.monthlyDebtBudget' } });
    for (const key of [...LOAN_KEYS, 'borrowingGap'] as ResultKey[]) expect(r.results[key].state, key).toBe('invalid');
  });

  it('a scenario that cannot be projected → scenarioComparison invalid; base results unaffected (§8.9)', () => {
    const scenario: Scenario = { id: 'late', name: 'Late loan', overrides: { 'loans.L1.disbursementDate': '2031-06-01' } };
    const p = completePlan(p => { p.loans[0].requiredPayment = { graceMonths: 6 }; p.scenarios = [scenario]; });
    const ctx = contextFor(p);
    expect(ctx.comparisons?.scenarioFailures).toHaveLength(1); // precondition
    const r = getPlanReadiness(p, ctx);
    expectWellFormed(r);
    expect(item(r, 'scenario.late.failed')).toMatchObject({ severity: 'invalid', target: { dashboard: 'scenarios', fieldId: 'scenarios.late.name' } });
    expect(r.results.scenarioComparison.state).toBe('invalid');
    expect(r.results.debtFreeDate.state).toBe('complete');
  });

  it('a working scenario makes scenarioComparison available', () => {
    const p = completePlan(p => { p.scenarios = [{ id: 'up', name: 'More', overrides: { 'postGradIncome.monthlyDebtBudget': '500.00' } }]; });
    expect(['complete', 'estimate']).toContain(ready(p).results.scenarioComparison.state);
  });

  it('an invalid draft reported by a field → draft.<fieldId> invalid targeting that field', () => {
    const p = completePlan();
    const fieldId = 'loans.L1.annualRate';
    const r = ready(p, { invalidFieldIds: [fieldId] });
    expectWellFormed(r);
    expect(item(r, `draft.${fieldId}`)).toMatchObject({ severity: 'invalid', target: { dashboard: 'loans', fieldId } });
    expect(r.items[0].severity).toBe('invalid');
  });

  it('drafts are counted per dashboard for the sidebar badges', () => {
    const p = completePlan();
    const before = ready(p).byDashboard.loans ?? 0;
    const r = ready(p, { invalidFieldIds: ['loans.L1.annualRate', 'postGradIncome.monthlyDebtBudget'] });
    expect(r.byDashboard.loans).toBe(before + 1);
    expect(r.byDashboard.repayment).toBe((ready(p).byDashboard.repayment ?? 0) + 1);
  });

  it('a leftover draft for a removed record is ignored', () => {
    const p = completePlan();
    const r = ready(p, { invalidFieldIds: ['loans.gone.principal', `schoolYears.${p.schoolYears[0].id}.costItems.gone.amount`] });
    expect(ofSeverity(r, 'invalid')).toEqual([]);
    expect(fieldRecordExists(p, 'loans.L1.principal')).toBe(true);
    expect(fieldRecordExists(p, 'postGradIncome.monthlyTakeHome')).toBe(true); // optional leaf, record exists
    expect(fieldRecordExists(p, 'loans.gone.principal')).toBe(false);
  });

  it('a draft on a field that already has an engine error is not listed twice', () => {
    const p = completePlan();
    const r = ready(p, {
      projectionErrors: [{ path: 'loans.L1.disbursementDate', code: 'OUT_OF_RANGE', message: 'Disbursement is after graduation.' }],
      invalidFieldIds: ['loans.L1.disbursementDate'],
    });
    expect(r.items.filter(i => i.target.fieldId === 'loans.L1.disbursementDate').map(i => i.id)).toEqual(['engine.loans.L1.disbursementDate']);
  });

  it('recovery: once the value is corrected the invalid item disappears', () => {
    const fixed = completePlan();
    const r = ready(fixed, { invalidFieldIds: [] });
    expect(ofSeverity(r, 'invalid')).toEqual([]);
    expect(r.results.debtFreeDate.state).toBe('complete');
  });
});

describe('readiness: fully complete plan', () => {
  it('has no blockers and every applicable result is complete', () => {
    const r = ready(completePlan());
    expectWellFormed(r);
    expect(blockers(r)).toEqual([]);
    for (const key of ['borrowingGap', 'timeline', ...LOAN_KEYS] as ResultKey[]) expect(r.results[key].state, key).toBe('complete');
  });

  it('live update: adding a loan to an empty plan removes loans.none and flips debtFreeDate out of incomplete', () => {
    const before = ready(createDefaultPlan());
    const after = ready(plan(p => { p.loans = [loan('L1', '5000.00')]; }));
    expect(item(before, 'loans.none')).toBeDefined();
    expect(item(after, 'loans.none')).toBeUndefined();
    expect(after.results.debtFreeDate.state).not.toBe('incomplete');
    expect(after.counts.missing).toBeLessThan(before.counts.missing);
  });
});

describe('readiness: field routing (US-501, US-905)', () => {
  it('post-graduation earnings route to Repayment Plan; in-school job earnings stay on Income', () => {
    const p = plan(p => { p.schoolYears[0].resources = [resource('job', 'job', '100.00')]; });
    for (const field of ['monthlyDebtBudget', 'annualSalary', 'raiseAllocationPercent', 'monthlyTakeHome', 'monthlyExpenses']) {
      expect(dashboardForFieldId(p, `postGradIncome.${field}`)).toBe('repayment');
    }
    expect(dashboardForFieldId(p, `schoolYears.${p.schoolYears[0].id}.resources.job.amount`)).toBe('income');
    expect(dashboardForFieldId(p, 'repayment.payoffTarget.date')).toBe('repayment');
    expect(dashboardForFieldId(p, 'repayment.voluntaryStart.months')).toBe('repayment');
  });

  it('stored federal settings have no dashboard to open', () => {
    const p = plan();
    for (const id of ['repayment.annualAGI', 'repayment.familySize', 'repayment.federalPlan', 'repayment.mode', 'borrower.level']) {
      expect(dashboardForFieldId(p, id)).toBeUndefined();
    }
  });
});

describe('readiness: payoff target (US-506)', () => {
  const withTarget = (edit: (p: PlannerPlan) => void = () => {}) => completePlan(p => {
    p.repayment.payoffTarget = { mode: 'target', kind: 'duration', months: 120 };
    edit(p);
  });
  const feasible: TargetPaymentOutput = {
    status: 'feasible', requiredMonthlyBudget: '340.64', chosenMonthlyBudget: '340.64', difference: '0.00',
    targetDate: '2041-01-01', verifiedDebtFreeDate: '2040-12-01', totalInterest: '10877.41', iterations: 30,
  };

  it('budget mode: the target result is not applicable and no target items appear', () => {
    const r = ready(completePlan(), { target: null });
    expect(r.results.targetPayment.state).toBe('notApplicable');
    expect(r.items.filter(i => i.id.startsWith('target.'))).toEqual([]);
  });

  it('a feasible target is complete', () => {
    const r = ready(withTarget(), { target: feasible });
    expectWellFormed(r);
    expect(r.results.targetPayment.state).toBe('complete');
  });

  it('a past target date is invalid and links to the target date field', () => {
    const p = withTarget(p => { p.repayment.payoffTarget = { mode: 'target', kind: 'date', date: '2020-01-01' }; });
    const r = ready(p, { target: { status: 'invalid', reason: 'pastTarget', errors: [], message: 'Choose a date in the future.' } });
    expectWellFormed(r);
    expect(item(r, 'target.invalid')).toMatchObject({ severity: 'invalid', why: 'Choose a date in the future.', target: { dashboard: 'repayment', fieldId: 'repayment.payoffTarget.date' } });
    expect(r.results.targetPayment.state).toBe('invalid');
    expect(r.results.debtFreeDate.state).toBe('complete'); // the chosen-budget projection is unaffected
  });

  it('an unreachable target is a warning that links to the duration field', () => {
    const r = ready(withTarget(), { target: { status: 'infeasible', reason: 'beyondSimulationCap', message: 'No payment reaches it.' } });
    expectWellFormed(r);
    expect(item(r, 'target.infeasible')).toMatchObject({ severity: 'warning', target: { dashboard: 'repayment', fieldId: 'repayment.payoffTarget.months' } });
  });

  it('missing inputs link to the field the solver names', () => {
    const r = ready(withTarget(), { target: { status: 'invalid', reason: 'missingInputs', message: 'Add a loan amount.', errors: [{ path: 'loans.L1.principal', code: 'REQUIRED', message: 'Enter an amount.' }] } });
    expectWellFormed(r);
    expect(item(r, 'target.missingInputs')).toMatchObject({ severity: 'missing', target: { dashboard: 'loans', fieldId: 'loans.L1.principal' } });
    expect(r.results.targetPayment.state).toBe('incomplete');
  });

  it('no target items while the result is still being calculated', () => {
    const r = ready(withTarget(), { target: undefined });
    expect(r.items.filter(i => i.id.startsWith('target.'))).toEqual([]);
  });
});

describe('readiness: required-payment timing (US-507)', () => {
  it('a private loan without lender terms gets a warning that opens its payment terms', () => {
    const r = ready(completePlan());
    expectWellFormed(r);
    expect(item(r, 'loan.L1.requiredPaymentUnset')).toMatchObject({ severity: 'warning', target: { dashboard: 'loans', fieldId: 'loans.L1.requiredPayment' } });
    expect(blockers(r)).toEqual([]); // never blocks results
  });

  it.each([
    ['a grace period (including 0)', { graceMonths: 0 }],
    ['in-school payments', { inSchoolPayments: true }],
    ['an actual first due date', { firstDueDate: '2030-12-20' }],
  ])('terms with %s clear the warning', (_name, terms) => {
    const r = ready(completePlan(p => { p.loans[0].requiredPayment = terms; }));
    expect(item(r, 'loan.L1.requiredPaymentUnset')).toBeUndefined();
  });

  it('$0 loans are not asked about', () => {
    const r = ready(completePlan(p => { p.loans.push(loan('Z', '0.00')); }));
    expect(item(r, 'loan.Z.requiredPaymentUnset')).toBeUndefined();
  });

  it('a late voluntary start with an earlier required payment → missed-payment warning with a link to the start', () => {
    const p = completePlan(p => {
      p.loans[0].requiredPayment = { graceMonths: 0 };
      p.repayment.voluntaryStart = { kind: 'afterGraduation', months: 12 };
    });
    const ctx = contextFor(p);
    expect(ctx.outputs?.missedObligations.length).toBeGreaterThan(0); // precondition
    const r = getPlanReadiness(p, ctx);
    expectWellFormed(r);
    expect(item(r, 'missed.L1')).toMatchObject({
      severity: 'warning', target: { dashboard: 'repayment', fieldId: 'repayment.voluntaryStart.months' },
      secondaryAction: { target: { dashboard: 'loans', fieldId: 'loans.L1.requiredPayment.firstDueDate' } },
    });
  });
});
