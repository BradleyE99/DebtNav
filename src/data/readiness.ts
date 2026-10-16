/**
 * Plan readiness: which results can be calculated, which inputs are still missing or invalid, and
 * which results rest on untouched defaults. Pure (no React, no DOM, no clock). Results, Overview and
 * the dashboard summaries all render from one getPlanReadiness() call so the rules live in one place.
 */
import type { FieldError, PlannerPlan, PlannerLoan } from '../engine/planner-contracts';
import type { PlannerOutputs, PlannerComparisonsDetailed } from '../engine/planner';
import { baseMonthlyBudget, createDefaultPlan, resourceGrossValue } from '../engine/planner';
import { D } from '../engine/money';

export type DashboardId = 'overview' | 'income' | 'setup' | 'school' | 'loans' | 'repayment'
  | 'events' | 'scenarios' | 'federal' | 'results' | 'data';

export type ResultKey =
  | 'borrowingGap'        // per-year costs/resources/gap + total gap
  | 'totalBorrowed'
  | 'loanDetails'         // balances at repayment, accrued/capitalized interest
  | 'minimumPayments'     // sum of minimums + shortfall
  | 'debtFreeDate'
  | 'totalInterest'
  | 'paymentSchedule'
  | 'balanceChart'
  | 'strategyComparison'
  | 'scenarioComparison'
  | 'eventImpacts'
  | 'timeline'
  | 'schoolEarnings'
  | 'federalLimits'
  | 'federalPlans';

export type ReadinessSeverity = 'missing' | 'invalid' | 'warning' | 'assumption';
export type ResultState = 'complete' | 'estimate' | 'incomplete' | 'invalid' | 'nonPayoff' | 'notApplicable';

export interface ReadinessTarget {
  dashboard: DashboardId;
  /** DOM id to focus: a contract field path ('loans.<id>.principal') or an action-button id ('loans-add'). */
  fieldId: string;
}

export interface ReadinessItem {
  /** Stable, e.g. 'loans.none', 'loan.<loanId>.zeroPrincipal', 'budget.zero'. */
  id: string;
  severity: ReadinessSeverity;
  /** Plain-language label, e.g. "Add at least one loan". */
  label: string;
  /** Which results it blocks or qualifies, e.g. "Needed for your debt-free date and total interest." */
  why: string;
  /** missing/invalid: results it blocks; warning/assumption: results it qualifies. */
  blocks: ResultKey[];
  target: ReadinessTarget;
  /** Button text, e.g. "Add a loan" / "Edit monthly budget". */
  actionLabel: string;
  /** Optional second way to resolve the item, e.g. lengthen the projection horizon. */
  secondaryAction?: { target: ReadinessTarget; actionLabel: string };
}

export interface ResultStatus {
  state: ResultState;
  /** ReadinessItem ids that explain the state (empty when complete). */
  itemIds: string[];
  /** Short placeholder text, e.g. "Needs a loan", "Not paid off within 360 months". */
  summary?: string;
}

export interface PlanReadiness {
  /** Sorted: invalid, missing, warning, assumption; then flow order. */
  items: ReadinessItem[];
  results: Record<ResultKey, ResultStatus>;
  counts: Record<ReadinessSeverity, number>;
  /** missing + invalid per dashboard (sidebar badges). */
  byDashboard: Partial<Record<DashboardId, number>>;
}

export interface ReadinessContext {
  /** usePlanner().projection */
  outputs?: PlannerOutputs | null;
  /** usePlanner().projectionErrors */
  projectionErrors?: readonly FieldError[];
  /** For scenario failures. */
  comparisons?: PlannerComparisonsDetailed | null;
  /**
   * Field ids whose typed text is not valid (drafts that were never saved), from the UI's draft registry.
   * Ids whose record no longer exists, or whose field already has an engine error, are ignored.
   */
  invalidFieldIds?: readonly string[];
  /** Defaults to createDefaultPlan(); used for 'assumption' items. */
  defaults?: PlannerPlan;
}

export const RESULT_KEYS: readonly ResultKey[] = [
  'borrowingGap', 'totalBorrowed', 'loanDetails', 'minimumPayments', 'debtFreeDate', 'totalInterest',
  'paymentSchedule', 'balanceChart', 'strategyComparison', 'scenarioComparison', 'eventImpacts', 'timeline',
  'schoolEarnings', 'federalLimits', 'federalPlans',
];


/** The headline results counted in the "N of M key results ready" status line. */
export const KEY_RESULTS: readonly ResultKey[] = ['borrowingGap', 'totalBorrowed', 'minimumPayments', 'debtFreeDate', 'totalInterest'];

/** Results that need a projected payoff (a loan balance + money to pay it). */
const PAYOFF_KEYS: ResultKey[] = ['debtFreeDate', 'totalInterest', 'paymentSchedule', 'balanceChart', 'strategyComparison', 'scenarioComparison', 'eventImpacts'];
/** Results that need the engine's repayment projection (blocked by engine errors). */
const PROJECTED_KEYS: ResultKey[] = ['loanDetails', 'minimumPayments', ...PAYOFF_KEYS];
/** Results that need at least one loan with a balance. */
const LOAN_KEYS: ResultKey[] = ['totalBorrowed', ...PROJECTED_KEYS, 'federalPlans'];
/** Results that become estimates when the monthly budget is the untouched default. */
const BUDGET_ESTIMATE_KEYS: ResultKey[] = ['debtFreeDate', 'totalInterest', 'paymentSchedule', 'balanceChart', 'strategyComparison', 'scenarioComparison', 'eventImpacts'];
/** Results shown as "not paid off" when the projection never reaches $0. */
const NON_PAYOFF_KEYS: ResultKey[] = ['debtFreeDate', 'totalInterest', 'paymentSchedule', 'balanceChart', 'strategyComparison', 'scenarioComparison', 'eventImpacts'];

const SEVERITY_ORDER: Record<ReadinessSeverity, number> = { invalid: 0, missing: 1, warning: 2, assumption: 3 };
const FLOW_ORDER: DashboardId[] = ['setup', 'school', 'income', 'loans', 'repayment', 'events', 'scenarios', 'federal', 'overview', 'results', 'data'];

const isDirectLoan = (loan: PlannerLoan) => loan.type === 'subsidized' || loan.type === 'unsubsidized';
/** "Is this decimal text > 0" — readiness does no money math of its own. */
const positive = (value: string | null | undefined): boolean => {
  try { return value !== null && value !== undefined && new D(value).gt(0); } catch { return false; }
};
const sameValue = (a: string, b: string): boolean => {
  try { return new D(a).eq(b); } catch { return a === b; }
};
const dollars = (value: string | { toFixed(digits: number): string }): string => {
  try { return `$${new D(typeof value === 'string' ? value : value.toFixed(2)).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`; } catch { return String(value); }
};

/**
 * Engine error paths may address loans by index ('loans.0.principal'); DOM ids use stable record ids.
 * A loan whose id is all digits is addressed by id, never by index.
 */
export function fieldIdForPath(plan: PlannerPlan, path: string): string {
  const match = /^loans\.(\d+)\.(.+)$/.exec(path);
  if (match && !plan.loans.some(loan => loan.id === match[1])) {
    const loan = plan.loans[Number(match[1])]; // money-lint-allow: array index, not money
    if (loan) return `loans.${loan.id}.${match[2]}`;
  }
  return path;
}

/**
 * False when a field id points into a record that no longer exists (e.g. a removed loan), so a
 * leftover draft for it is not reported. Only collection records are checked: 'loans.<id>.principal'
 * needs loan <id>; an optional leaf such as 'repayment.maxMonths' may be absent.
 */
export function fieldRecordExists(plan: PlannerPlan, fieldId: string): boolean {
  let current: unknown = plan;
  for (const segment of fieldId.split('.')) {
    if (Array.isArray(current)) {
      current = current.find(record => (record as { id?: unknown } | null)?.id === segment);
      if (current === undefined) return false;
    } else if (current !== null && typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return true;
    }
  }
  return true;
}

/** The dashboard that owns a field id (a contract field path or an action-button id). */
export function dashboardForFieldId(plan: PlannerPlan, fieldId: string): DashboardId | undefined {
  if (fieldId === 'loans-add') return 'loans';
  if (fieldId === 'income-add-earnings') return 'income';
  const [scope, second, collection, recordId] = fieldId.split('.');
  if (scope === 'repayment' && ['annualAGI', 'familySize', 'federalPlan', 'mode'].includes(second)) return 'federal';
  if (scope === 'schoolYears' && collection === 'resources'
    && plan.schoolYears.find(year => year.id === second)?.resources.some(resource => resource.id === recordId && resource.type === 'job')) return 'income';
  return ({
    postGradIncome: 'income', schoolYears: 'school', loans: 'loans', lifeEvents: 'events', settings: 'setup',
    repayment: 'repayment', borrower: 'federal', scenarios: 'scenarios',
  } as Record<string, DashboardId>)[scope];
}

function keysForField(fieldId: string): ResultKey[] {
  const scope = fieldId.split('.')[0];
  if (scope === 'loans') return LOAN_KEYS;
  if (scope === 'schoolYears') return ['borrowingGap', 'schoolEarnings'];
  if (scope === 'scenarios') return ['scenarioComparison'];
  if (scope === 'borrower') return ['federalLimits', 'federalPlans'];
  return PROJECTED_KEYS;
}

const RESULT_NAMES: Record<ResultKey, string> = {
  borrowingGap: 'borrowing gap', totalBorrowed: 'total borrowed', loanDetails: 'loan balances',
  minimumPayments: 'minimum payments', debtFreeDate: 'debt-free date', totalInterest: 'total interest',
  paymentSchedule: 'payment schedule', balanceChart: 'balance chart', strategyComparison: 'strategy comparison',
  scenarioComparison: 'scenario comparison', eventImpacts: 'life event impacts', timeline: 'timeline',
  schoolEarnings: 'school earnings', federalLimits: 'federal loan limits', federalPlans: 'federal plan estimates',
};

export function getPlanReadiness(plan: PlannerPlan, context: ReadinessContext = {}): PlanReadiness {
  const defaults = context.defaults ?? createDefaultPlan();
  // undefined = caller did not pass engine outputs; null = the planner inputs could not be calculated.
  const outputs = context.outputs;
  const repayment = outputs?.repayment ?? null;
  const items: ReadinessItem[] = [];
  const add = (item: ReadinessItem) => { if (!items.some(existing => existing.id === item.id)) items.push(item); };

  const hasDebt = plan.loans.some(loan => positive(loan.principal));
  const years = plan.schoolYears;
  const yearName = (yearId: string) => `Year ${years.findIndex(year => year.id === yearId) + 1}`;
  let baseBudget = new D(0);
  try { baseBudget = baseMonthlyBudget(plan); } catch { /* invalid text is reported by the engine */ }

  // ---------------------------------------------------------------- Invalid values (engine)
  for (const error of context.projectionErrors ?? []) {
    const fieldId = fieldIdForPath(plan, error.path);
    add({
      id: `engine.${fieldId}`, severity: 'invalid', label: error.message,
      why: outputs === null
        ? 'Results can\'t be calculated until this is fixed.'
        : 'Repayment can\'t be projected until this is fixed. Borrowing gaps are still up to date.',
      blocks: outputs === null ? [...RESULT_KEYS] : PROJECTED_KEYS,
      target: { dashboard: dashboardForFieldId(plan, fieldId) ?? 'setup', fieldId }, actionLabel: 'Fix this value',
    });
  }
  for (const failure of context.comparisons?.scenarioFailures ?? []) {
    add({
      id: `scenario.${failure.id}.failed`, severity: 'invalid', label: `Scenario "${failure.name}" can't be projected`,
      why: failure.reason || 'One of its changed values makes the plan impossible to project.',
      blocks: ['scenarioComparison'], target: { dashboard: 'scenarios', fieldId: `scenarios.${failure.id}.name` }, actionLabel: 'Edit scenario',
    });
  }
  for (const fieldId of context.invalidFieldIds ?? []) {
    if (!fieldRecordExists(plan, fieldId) || items.some(item => item.id === `engine.${fieldId}`)) continue;
    add({
      id: `draft.${fieldId}`, severity: 'invalid', label: 'A value you typed is not valid yet',
      why: 'Results use its last valid value until it is fixed.',
      blocks: keysForField(fieldId), target: { dashboard: dashboardForFieldId(plan, fieldId) ?? 'setup', fieldId }, actionLabel: 'Fix this value',
    });
  }

  // ---------------------------------------------------------------- Loans
  if (plan.loans.length === 0) {
    const gapYear = outputs?.years.find(year => positive(year.bufferedGap));
    add({
      id: 'loans.none', severity: 'missing', label: 'Add at least one loan',
      why: `Needed for your debt-free date, total interest, minimum payments and payment schedule.${gapYear ? ` Tip: you can also create one from your ${yearName(gapYear.yearId)} borrowing gap under Costs.` : ''}`,
      blocks: LOAN_KEYS, target: { dashboard: 'loans', fieldId: 'loans-add' }, actionLabel: 'Add a loan',
    });
  } else if (!hasDebt) {
    const first = plan.loans[0];
    add({
      id: 'loans.allZero', severity: 'missing',
      label: plan.loans.length === 1 ? `Enter the amount borrowed for "${first.name.trim() || 'your loan'}"` : 'Enter the amount borrowed for your loans',
      why: 'Every loan is at $0.00, so there is nothing to repay yet. Needed for your debt-free date, total interest and minimum payments.',
      blocks: LOAN_KEYS, target: { dashboard: 'loans', fieldId: `loans.${first.id}.principal` }, actionLabel: 'Enter loan amount',
    });
  } else {
    for (const loan of plan.loans) {
      if (positive(loan.principal)) continue;
      add({
        id: `loan.${loan.id}.zeroPrincipal`, severity: 'warning', label: `"${loan.name.trim() || 'A loan'}" has a $0.00 balance`,
        why: 'It is left out of your totals and payoff plan. Enter the amount borrowed, or remove the loan.',
        blocks: ['totalBorrowed'], target: { dashboard: 'loans', fieldId: `loans.${loan.id}.principal` }, actionLabel: 'Edit loan amount',
      });
    }
  }

  // ---------------------------------------------------------------- Monthly loan budget
  const budgetTarget: ReadinessTarget = { dashboard: 'income', fieldId: 'postGradIncome.monthlyDebtBudget' };
  const extra = plan.repayment.extraMonthlyPayment;
  if (positive(extra)) {
    add({
      id: 'budget.legacyExtra', severity: 'warning', label: `Your saved plan adds an extra ${dollars(extra)}/mo to your budget`,
      why: `It came from an older or imported plan and is added to your monthly loan budget (total used: ${dollars(baseBudget)}/mo).`,
      blocks: PAYOFF_KEYS, target: budgetTarget, actionLabel: 'Review monthly budget',
    });
  }
  if (hasDebt) {
    // With engine outputs, events that make a $0 base budget pay off are the engine's call (status).
    // Without outputs, only a plan with no income/windfall events counts as having no budget.
    const noBudget = baseBudget.isZero() && (repayment
      ? repayment.status !== 'paidOff'
      : !plan.lifeEvents.some(event => event.type === 'income' || event.type === 'windfall'));
    if (noBudget) {
      add({
        id: 'budget.zero', severity: 'missing', label: 'Enter your monthly loan payment budget',
        why: 'Your budget is $0.00, so nothing pays your loans. Needed for your debt-free date, total interest and payment schedule.',
        blocks: PAYOFF_KEYS, target: budgetTarget, actionLabel: 'Enter monthly budget',
      });
    } else if (sameValue(plan.postGradIncome.monthlyDebtBudget, defaults.postGradIncome.monthlyDebtBudget)) {
      add({
        id: 'budget.default', severity: 'assumption',
        label: `Confirm your monthly loan payment budget (using the default ${dollars(defaults.postGradIncome.monthlyDebtBudget)})`,
        why: 'Your payoff results assume this amount. Enter what you can actually pay toward all loans each month.',
        blocks: BUDGET_ESTIMATE_KEYS, target: budgetTarget, actionLabel: 'Confirm monthly budget',
      });
    }
    if (outputs && positive(outputs.paymentShortfall)) {
      add({
        id: 'budget.shortfall', severity: 'warning', label: 'Your monthly budget is below your minimum payments',
        why: `It is ${dollars(outputs.paymentShortfall!)} a month short of the minimums (${dollars(outputs.minimumTotal ?? '0')}). The projection assumes you pay only your budget; lenders may charge late fees.`,
        blocks: ['minimumPayments', 'debtFreeDate'], target: budgetTarget, actionLabel: 'Increase monthly budget',
      });
    }
    if (repayment && repayment.status !== 'paidOff' && !items.some(item => item.id === 'budget.zero')) {
      const horizon = plan.repayment.maxMonths ?? 600;
      const below = repayment.status === 'notAmortizing';
      add({
        id: 'repayment.nonPayoff', severity: 'warning',
        label: below ? 'Your monthly budget doesn\'t cover the interest' : `Your loans aren't paid off within ${horizon} months`,
        why: below
          ? 'At least one balance stops shrinking, so there is no debt-free date. Increase your monthly budget or change the loan terms.'
          : 'A balance is still owed when the projection ends. Increase your monthly budget, or lengthen the projection horizon under Repayment.',
        blocks: NON_PAYOFF_KEYS, target: budgetTarget, actionLabel: 'Increase monthly budget',
        ...(below ? {} : { secondaryAction: { target: { dashboard: 'repayment', fieldId: 'repayment.maxMonths' }, actionLabel: 'Lengthen projection horizon' } }),
      });
    }
  }

  // ---------------------------------------------------------------- School costs and resources
  // YearSummary.costs already includes school expense events (engine). Without outputs, fall back to cost items.
  const yearCosts = (yearId: string): boolean => {
    const summary = outputs?.years.find(year => year.yearId === yearId);
    if (summary) return positive(summary.costs);
    return years.find(year => year.id === yearId)!.costItems.some(item => positive(item.amount));
  };
  const yearHasCostRecords = (yearId: string) => yearCosts(yearId) || years.find(year => year.id === yearId)!.costItems.length > 0;
  if (!years.some(year => yearCosts(year.id))) {
    const firstYear = years[0];
    const firstZero = years.flatMap(year => year.costItems.map(item => ({ year, item })))[0];
    add({
      id: 'costs.none', severity: 'missing', label: firstZero ? 'Enter your school cost amounts' : 'Add your school costs',
      why: 'Needed for your borrowing gap. Not needed if you are only planning repayment of loans you already have.',
      blocks: ['borrowingGap'],
      target: firstZero
        ? { dashboard: 'school', fieldId: `schoolYears.${firstZero.year.id}.costItems.${firstZero.item.id}.amount` }
        : firstYear ? { dashboard: 'school', fieldId: `schoolYears.${firstYear.id}.costItems-add` } : { dashboard: 'setup', fieldId: 'settings.graduationDate' },
      actionLabel: firstZero ? 'Enter cost amount' : 'Add school costs',
    });
  } else {
    for (const year of years) {
      if (!yearHasCostRecords(year.id)) {
        add({
          id: `costs.year.${year.id}.empty`, severity: 'warning', label: `${yearName(year.id)} has no costs entered`,
          why: 'Its borrowing gap shows $0.00 because no costs are entered, not because the year is covered.',
          blocks: ['borrowingGap'], target: { dashboard: 'school', fieldId: `schoolYears.${year.id}.costItems-add` }, actionLabel: `Add ${yearName(year.id)} costs`,
        });
      }
    }
  }
  for (const year of years) {
    for (const item of year.costItems) {
      if (positive(item.amount) || items.some(existing => existing.target.fieldId.endsWith(`${item.id}.amount`))) continue;
      add({
        id: `cost.${item.id}.zero`, severity: 'warning', label: `${yearName(year.id)}: "${item.label.trim() || 'Cost'}" is $0.00`,
        why: 'Enter the amount, or remove the cost if it does not apply.',
        blocks: ['borrowingGap'], target: { dashboard: 'school', fieldId: `schoolYears.${year.id}.costItems.${item.id}.amount` }, actionLabel: 'Edit amount',
      });
    }
    for (const resource of year.resources) {
      let gross = false;
      try { gross = resourceGrossValue(resource).gt(0); } catch { /* engine reports invalid text */ }
      if (gross) continue;
      const base = `schoolYears.${year.id}.resources.${resource.id}`;
      if (resource.type === 'job') {
        const hourly = resource.incomeMode === 'hourly';
        const field = !hourly ? 'amount' : !positive(resource.hourlyWage) ? 'hourlyWage' : !positive(resource.hoursPerWeek) ? 'hoursPerWeek' : 'weeksWorked';
        add({
          id: `earnings.${resource.id}.zero`, severity: 'warning', label: `${yearName(year.id)}: "${resource.label.trim() || 'Earnings'}" earns $0.00`,
          why: hourly ? 'Enter the hourly wage, hours and weeks, or remove these earnings.' : 'Enter the annual amount, or remove these earnings.',
          blocks: ['schoolEarnings', 'borrowingGap'], target: { dashboard: 'income', fieldId: `${base}.${field}` },
          actionLabel: field === 'hourlyWage' ? 'Enter hourly wage' : 'Edit earnings',
        });
      } else {
        add({
          id: `resource.${resource.id}.zero`, severity: 'warning', label: `${yearName(year.id)}: "${resource.label.trim() || 'Resource'}" is $0.00`,
          why: 'It adds nothing to your resources. Enter the amount, or remove it if it does not apply.',
          blocks: ['borrowingGap'], target: { dashboard: 'school', fieldId: `${base}.amount` }, actionLabel: 'Edit amount',
        });
      }
    }
  }

  // ---------------------------------------------------------------- Salary baseline (income events only) and federal AGI
  if (hasDebt && plan.lifeEvents.some(event => event.type === 'income')) {
    const salaryTarget: ReadinessTarget = { dashboard: 'income', fieldId: 'postGradIncome.annualSalary' };
    if (!positive(plan.postGradIncome.annualSalary)) {
      add({
        id: 'salary.baseline', severity: 'warning', label: 'Your starting salary is $0.00',
        why: 'Income-change events are measured from this salary, so the whole new salary counts as a raise. Enter your expected starting salary.',
        blocks: ['eventImpacts', 'debtFreeDate'], target: salaryTarget, actionLabel: 'Enter starting salary',
      });
    } else if (sameValue(plan.postGradIncome.annualSalary, defaults.postGradIncome.annualSalary)) {
      add({
        id: 'salary.baseline', severity: 'assumption',
        label: `Confirm your starting salary (using the default ${dollars(defaults.postGradIncome.annualSalary)})`,
        why: 'Your income-change events are measured from this salary.',
        blocks: ['eventImpacts', 'debtFreeDate'], target: salaryTarget, actionLabel: 'Confirm salary',
      });
    }
  }
  const fundedDirect = plan.loans.some(loan => isDirectLoan(loan) && positive(loan.principal));
  if (fundedDirect && sameValue(plan.repayment.annualAGI, defaults.repayment.annualAGI)) {
    add({
      id: 'federal.agiDefault', severity: 'assumption',
      label: `Confirm your income for federal plans (using the default ${dollars(defaults.repayment.annualAGI)} AGI)`,
      why: 'Income-driven federal plan estimates depend on your adjusted gross income.',
      blocks: ['federalPlans'], target: { dashboard: 'federal', fieldId: 'repayment.annualAGI' }, actionLabel: 'Confirm income',
    });
  }

  // ---------------------------------------------------------------- Sort, then derive result states
  items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || FLOW_ORDER.indexOf(a.target.dashboard) - FLOW_ORDER.indexOf(b.target.dashboard));

  const notApplicable: Partial<Record<ResultKey, string>> = {};
  if (!plan.scenarios.length) notApplicable.scenarioComparison = 'No scenarios yet';
  if (!plan.lifeEvents.some(event => event.type === 'income' || event.type === 'windfall')) notApplicable.eventImpacts = 'No income changes or windfalls';
  if (!plan.loans.some(isDirectLoan)) notApplicable.federalLimits = 'No federal loans';
  if (!fundedDirect) notApplicable.federalPlans = 'No federal loans with a balance';
  if (!years.some(year => year.resources.some(resource => resource.type === 'job'))) notApplicable.schoolEarnings = 'No earnings entered';

  const matching = (key: ResultKey, severity: ReadinessSeverity) =>
    items.filter(item => item.severity === severity && item.blocks.includes(key));
  const nonPayoff = items.find(item => item.id === 'repayment.nonPayoff');
  const results = {} as Record<ResultKey, ResultStatus>;
  for (const key of RESULT_KEYS) {
    const naReason = notApplicable[key];
    if (naReason) { results[key] = { state: 'notApplicable', itemIds: [], summary: naReason }; continue; }
    const invalid = matching(key, 'invalid');
    if (invalid.length) {
      results[key] = { state: 'invalid', itemIds: invalid.map(item => item.id), summary: invalid.length === 1 ? 'Fix 1 value' : `Fix ${invalid.length} values` };
      continue;
    }
    const missing = matching(key, 'missing');
    if (missing.length) { results[key] = { state: 'incomplete', itemIds: missing.map(item => item.id), summary: needsSummary(missing[0]) }; continue; }
    // Engine results that are not available (outputs passed but repayment missing) are never claimed.
    if (outputs !== undefined && ((PROJECTED_KEYS.includes(key) && !repayment) || (key === 'borrowingGap' && !outputs))) {
      results[key] = { state: 'incomplete', itemIds: [], summary: 'Not available yet' };
      continue;
    }
    if (nonPayoff && nonPayoff.blocks.includes(key)) {
      results[key] = {
        state: 'nonPayoff', itemIds: [nonPayoff.id],
        summary: repayment?.status === 'notAmortizing' ? 'Not paid off: payments don\'t cover interest' : `Not paid off within ${plan.repayment.maxMonths ?? 600} months`,
      };
      continue;
    }
    const assumptions = matching(key, 'assumption');
    if (assumptions.length) {
      results[key] = { state: 'estimate', itemIds: assumptions.map(item => item.id), summary: estimateSummary(assumptions[0]) };
      continue;
    }
    // Contract: itemIds is empty when complete; warnings remain discoverable through items[].blocks.
    results[key] = { state: 'complete', itemIds: [] };
  }

  const counts: Record<ReadinessSeverity, number> = { missing: 0, invalid: 0, warning: 0, assumption: 0 };
  const byDashboard: Partial<Record<DashboardId, number>> = {};
  for (const item of items) {
    counts[item.severity] += 1;
    if (item.severity === 'missing' || item.severity === 'invalid') byDashboard[item.target.dashboard] = (byDashboard[item.target.dashboard] ?? 0) + 1;
  }
  return { items, results, counts, byDashboard };
}

function needsSummary(item: ReadinessItem): string {
  if (item.id === 'loans.none') return 'Needs a loan';
  if (item.id === 'loans.allZero') return 'Needs a loan amount';
  if (item.id === 'budget.zero') return 'Needs a monthly budget';
  if (item.id === 'costs.none') return 'Needs school costs';
  return 'Needs more information';
}

function estimateSummary(item: ReadinessItem): string {
  if (item.id === 'budget.default') return 'Estimate: uses the default monthly budget';
  if (item.id === 'salary.baseline') return 'Estimate: uses the default starting salary';
  if (item.id === 'federal.agiDefault') return 'Estimate: uses the default AGI';
  return 'Estimate';
}

/** Ready = complete or estimate (a value is shown). */
export function isReady(status: ResultStatus): boolean {
  return status.state === 'complete' || status.state === 'estimate';
}

/** "3 of 5 key results ready · 2 items needed" */
export function readinessStatusText(readiness: PlanReadiness): string {
  const ready = KEY_RESULTS.filter(key => isReady(readiness.results[key])).length;
  const needed = readiness.counts.missing + readiness.counts.invalid;
  return `${ready} of ${KEY_RESULTS.length} key results ready · ${needed === 0 ? 'nothing needed' : `${needed} item${needed === 1 ? '' : 's'} needed`}`;
}

/** Readable list of result names, e.g. "debt-free date and total interest". */
export function resultNames(keys: readonly ResultKey[]): string {
  const names = keys.map(key => RESULT_NAMES[key]);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
