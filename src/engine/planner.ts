import type Decimal from 'decimal.js';
import type {
  PlannerPlan, PlannerYear, PlannerLoan, PlannerResult, PlannerComparisons, Scenario, Comparison, YearSummary,
  TimelineEntry, FieldError, EventImpact, LifeEvent, Resource, Result, PlannerProjection, Money,
} from './planner-contracts';
import type { Plan, Projection } from './contracts';
import { SIMULATION_CAP_MONTHS } from './planner-contracts';
import { firstVoluntaryPaymentDate, missedObligationsFor, paymentTimingFor, voluntaryStartDate } from './paymentTiming';
import { D, cents, money, sum, decimalText, moneyText } from './money';
import { calculateProjection } from './projection';
import { schoolYearRanges, reconcileYears } from './plan';
import { applyOverrides } from './paths';
import { getStrategy, listStrategies } from './strategies/registry';
import { addMonths, addYears, monthKey, validDate } from './dates';
import { federalReference } from '../policy/reference';
import { UNASSIGNED_ACADEMIC_YEAR, academicYearOfSchoolYear, isAcademicYear } from './academicYear';

export function createDefaultPlan(): PlannerPlan {
  const plan: PlannerPlan = {
    settings: { startDate: '2026-08-24', graduationDate: '2030-05-20', currency: 'USD' },
    schoolYears: [],
    loans: [],
    repayment: {
      strategyId: 'avalanche', extraMonthlyPayment: '0.00', customOrder: [],
      payoffTarget: { mode: 'budget' },
      // Voluntary payments start with the federal default repayment period (graduation + 6 months).
      voluntaryStart: { kind: 'afterGraduation', months: 6 },
      mode: 'standard', federalPlan: 'rap', familySize: 1, annualAGI: '55000.00',
    },
    postGradIncome: { annualSalary: '55000.00', monthlyDebtBudget: '400.00', raiseAllocationPercent: '50' },
    lifeEvents: [],
    scenarios: [],
    borrower: { dependency: 'dependent', level: 'undergraduate', priorFederalDebt: '0.00' },
  };
  return reconcileSchoolYears(plan);
}

/**
 * US-101: recompute school-year dates from settings. Years are matched by ordinal position, so a
 * shifted start date keeps every year's id, costs, resources and buffer; extending graduation adds
 * empty trailing years and shortening drops trailing years. Invalid dates return the plan unchanged.
 */
export function reconcileSchoolYears(plan: PlannerPlan): PlannerPlan {
  const result = schoolYearRanges(plan.settings.startDate, plan.settings.graduationDate);
  if (!result.ok) return plan;
  const schoolYears = reconcileYears<PlannerYear>(plan.schoolYears, result.ranges, (id, range) => ({
    id, ...range, costItems: [], resources: [], bufferPercent: '0',
  }));
  return { ...plan, schoolYears };
}

/** US-801: scenario = base plan + overrides resolved by stable ids; dangling keys are ignored. */
export function applyScenario(plan: PlannerPlan, scenario: Scenario): PlannerPlan {
  return reconcileSchoolYears(applyOverrides(plan, scenario.overrides));
}

/** US-202: replace the target year's cost items with the source items × (1 + increase%). */
export function copyYearCosts(plan: PlannerPlan, fromId: string, toId: string, increasePercent: string): PlannerPlan {
  if (!decimalText(increasePercent) || new D(increasePercent).gt(1000)) return plan;
  const source = plan.schoolYears.find(year => year.id === fromId);
  if (!source || fromId === toId || !plan.schoolYears.some(year => year.id === toId)) return plan;
  const factor = new D(1).plus(new D(increasePercent).div(100));
  return {
    ...plan,
    schoolYears: plan.schoolYears.map(year => year.id !== toId ? year : {
      ...year,
      costItems: source.costItems.map((item, index) => ({ ...item, id: `${toId}-copy-${index}`, amount: money(new D(item.amount).times(factor)) })),
    }),
  };
}

// ------------------------------------------------------------------ Borrowing phase (years)

/** The school year a dated record falls in: [start, end), with the final year including graduation day. */
function yearIndexForDate(plan: PlannerPlan, date: string): number {
  const last = plan.schoolYears.length - 1;
  return plan.schoolYears.findIndex((year, index) =>
    date >= year.startDate && (date < year.endDate || (index === last && date === year.endDate)));
}
/** An explicit schoolYearId wins when it still exists; otherwise the date decides. */
function attributedYearIndex(plan: PlannerPlan, schoolYearId: string | undefined, date: string): number {
  const explicit = schoolYearId === undefined ? -1 : plan.schoolYears.findIndex(year => year.id === schoolYearId);
  return explicit >= 0 ? explicit : yearIndexForDate(plan, date);
}

/**
 * The academic year ('2026-2027') a loan is assigned to, or null when unassigned. A loan saved before
 * academic years existed keeps its earlier attribution: its explicit schoolYearId, else the school
 * year containing its disbursement date (assignLegacyAcademicYears stores that on load).
 */
export function loanAcademicYear(plan: PlannerPlan, loan: PlannerLoan): string | null {
  if (loan.academicYear !== undefined) return isAcademicYear(loan.academicYear) ? loan.academicYear : null;
  const index = attributedYearIndex(plan, loan.schoolYearId, loan.disbursementDate);
  return index >= 0 ? academicYearOfSchoolYear(plan.schoolYears[index]) : null;
}

/** Index of the plan school year matching a loan's academic year, or -1 (unassigned or outside the plan). */
export function loanYearIndex(plan: PlannerPlan, loan: PlannerLoan): number {
  const academicYear = loanAcademicYear(plan, loan);
  return academicYear === null ? -1 : plan.schoolYears.findIndex(year => academicYearOfSchoolYear(year) === academicYear);
}

/**
 * Stores the academic year of loans saved before academic years existed, so it no longer follows the
 * disbursement date. Uses only the attribution those loans already had; others become 'unassigned'.
 */
export function assignLegacyAcademicYears(plan: PlannerPlan): PlannerPlan {
  if (plan.loans.every(loan => loan.academicYear !== undefined)) return plan;
  return {
    ...plan,
    loans: plan.loans.map(loan => loan.academicYear !== undefined ? loan
      : { ...loan, academicYear: loanAcademicYear(plan, loan) ?? UNASSIGNED_ACADEMIC_YEAR }),
  };
}

/** US-302: gross annual value before the unavailable share: hourly jobs earn wage × hours × weeks,
 * every other resource (and fixed-income jobs) uses `amount`. Rounded to cents. */
export function resourceGrossValue(resource: Resource): Decimal {
  return cents(resource.type === 'job' && resource.incomeMode === 'hourly'
    ? new D(resource.hourlyWage).times(resource.hoursPerWeek).times(resource.weeksWorked)
    : new D(resource.amount));
}

/** US-302: the amount that counts toward a year's resources; the unavailable share never counts. */
export function resourceValue(resource: Resource): Decimal {
  const gross = resource.type === 'job' && resource.incomeMode === 'hourly'
    ? new D(resource.hourlyWage).times(resource.hoursPerWeek).times(resource.weeksWorked)
    : new D(resource.amount);
  return cents(gross.times(new D(1).minus(new D(resource.unavailablePercent).div(100))));
}

/**
 * Base monthly debt budget before life events: monthlyDebtBudget + repayment.extraMonthlyPayment
 * (the latter is a legacy field with no UI input; imported plans may carry it). Income events and
 * windfalls change the per-month budget inside the projection; paymentShortfall compares minimums
 * with this base value only.
 */
export function baseMonthlyBudget(plan: PlannerPlan): Decimal {
  return new D(plan.postGradIncome.monthlyDebtBudget).plus(plan.repayment.extraMonthlyPayment);
}

function summarizeYear(plan: PlannerPlan, year: PlannerYear, index: number): YearSummary {
  const events = plan.lifeEvents.filter(event =>
    (event.type === 'expense' || event.type === 'aid') && attributedYearIndex(plan, event.schoolYearId, event.date) === index);
  const costs = sum(year.costItems.map(item => item.amount))
    .plus(sum(events.filter(event => event.type === 'expense').map(event => event.amount)));
  const resources = sum(year.resources.map(resourceValue))
    .plus(sum(events.filter(event => event.type === 'aid').map(event => event.amount)));
  const gap = D.max(0, costs.minus(resources));
  const bufferedGap = cents(gap.times(new D(1).plus(new D(year.bufferPercent).div(100))));
  const loans = plan.loans.filter(loan => loanYearIndex(plan, loan) === index);
  const borrowed = sum(loans.map(loan => loan.principal));
  return {
    yearId: year.id,
    costs: money(costs),
    resources: money(resources),
    gap: money(gap),
    surplus: money(D.max(0, resources.minus(costs))),
    bufferedGap: money(bufferedGap),
    borrowed: money(borrowed),
    // US-1006: the part of the gap (not gap + buffer) that no loan allocated to this year covers.
    remaining: money(D.max(0, gap.minus(borrowed))),
    // US-402: loans created from a gap never auto-update; flag them when the gap has moved.
    // A gap loan reassigned to another academic year no longer tracks this year's gap.
    mismatchLoanIds: loans.filter(loan => loan.gapAtCreation !== undefined && loan.schoolYearId === year.id && !new D(loan.gapAtCreation).eq(bufferedGap)).map(loan => loan.id),
  };
}

const DEFAULT_TERM_MONTHS = 120;

/**
 * US-402: a new loan pre-filled with the year's gap + buffer, dated at the year's start. The loan
 * records the year and the amount at creation and is never updated automatically afterwards.
 * Rate defaults to the current undergraduate Direct Loan rate from policy reference data.
 */
export function createLoanFromGap(plan: PlannerPlan, yearId: string, newId: string): PlannerLoan {
  const index = plan.schoolYears.findIndex(year => year.id === yearId);
  const year = plan.schoolYears[index];
  const base: PlannerLoan = {
    id: newId, name: year ? `Year ${index + 1} loan` : 'New loan', type: 'unsubsidized', principal: '0.00',
    annualRate: federalReference.interestRates.undergraduateDirect.rate, disbursementDate: year?.startDate ?? plan.settings.startDate,
    termMonths: DEFAULT_TERM_MONTHS,
  };
  if (!year) return base;
  let amount = '0.00';
  try { amount = summarizeYear(plan, year, index).bufferedGap; } catch { /* incomplete inputs: start from 0.00 */ }
  return { ...base, principal: amount, schoolYearId: year.id, academicYear: academicYearOfSchoolYear(year), gapAtCreation: amount };
}

// ------------------------------------------------------------------ Validation of planner-only fields

export function validatePlannerInputs(plan: PlannerPlan): FieldError[] {
  const errors: FieldError[] = [];
  const checkMoney = (value: unknown, path: string) => {
    if (!moneyText(value)) errors.push({ path, code: 'INVALID_MONEY', message: 'Enter a nonnegative amount with at most two decimal places.' });
  };
  const checkPercent = (value: unknown, path: string) => {
    if (!decimalText(value) || new D(value).gt(100)) errors.push({ path, code: 'OUT_OF_RANGE', message: 'Enter a percentage from 0 to 100.' });
  };
  checkMoney(plan.postGradIncome.annualSalary, 'postGradIncome.annualSalary');
  checkMoney(plan.postGradIncome.monthlyDebtBudget, 'postGradIncome.monthlyDebtBudget');
  checkPercent(plan.postGradIncome.raiseAllocationPercent, 'postGradIncome.raiseAllocationPercent');
  for (const year of plan.schoolYears) {
    const yearPath = `schoolYears.${year.id}`;
    checkPercent(year.bufferPercent, `${yearPath}.bufferPercent`);
    for (const cost of year.costItems) checkMoney(cost.amount, `${yearPath}.costItems.${cost.id}.amount`);
    for (const resource of year.resources) {
      const path = `${yearPath}.resources.${resource.id}`;
      checkMoney(resource.amount, `${path}.amount`);
      checkMoney(resource.hourlyWage, `${path}.hourlyWage`);
      checkPercent(resource.unavailablePercent, `${path}.unavailablePercent`);
      for (const key of ['hoursPerWeek', 'weeksWorked'] as const) {
        if (!decimalText(resource[key])) errors.push({ path: `${path}.${key}`, code: 'OUT_OF_RANGE', message: 'Enter a nonnegative decimal value.' });
      }
    }
  }
  for (const event of plan.lifeEvents) {
    const path = `lifeEvents.${event.id}`;
    if (!validDate(event.date)) errors.push({ path: `${path}.date`, code: 'INVALID_DATE', message: 'Enter a valid YYYY-MM-DD date.' });
    if (event.recurrenceEndDate !== undefined && !validDate(event.recurrenceEndDate)) {
      errors.push({ path: `${path}.recurrenceEndDate`, code: 'INVALID_DATE', message: 'Enter a valid YYYY-MM-DD date.' });
    }
    checkMoney(event.amount, `${path}.amount`);
    checkPercent(event.allocationPercent, `${path}.allocationPercent`);
  }
  return errors;
}

// ------------------------------------------------------------------ Repayment phase

/** Dates of every occurrence of a windfall up to `lastDate` (inclusive). */
function windfallOccurrences(event: LifeEvent, lastDate: string): string[] {
  if (event.recurrence !== 'yearly') return event.date <= lastDate ? [event.date] : [];
  const end = event.recurrenceEndDate !== undefined && event.recurrenceEndDate < lastDate ? event.recurrenceEndDate : lastDate;
  const dates: string[] = [];
  for (let year = 0; ; year++) {
    const date = addYears(event.date, year);
    if (date > end || !validDate(date)) break;
    dates.push(date);
  }
  return dates;
}

/**
 * Monthly debt budget for each repayment month, precomputed once per projection.
 *  - Base: monthlyDebtBudget + extraMonthlyPayment.
 *  - Income events (US-702), in date order: from the event's month the budget changes by
 *    (new salary − previous salary) / 12 × allocation%. Amount 0 models "job ends". The running
 *    budget is floored at $0 (it never goes negative) and rounded to cents.
 *  - Windfalls (US-703): amount × allocation% is added in the repayment month with the same
 *    calendar month as the occurrence. ASSUMPTION: occurrences dated before the first repayment
 *    month are held and applied in repayment month 1. Yearly windfalls repeat on each anniversary
 *    until recurrenceEndDate, the horizon, or payoff.
 */
interface BudgetSchedule { budgetFor: (date: string) => Decimal; stableFrom: string }
function budgetSchedule(plan: PlannerPlan, firstPaymentDate: string, horizon: number): BudgetSchedule {
  const events = [...plan.lifeEvents].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const firstKey = monthKey(firstPaymentDate);
  const lastDate = addMonths(firstPaymentDate, horizon);
  const base = baseMonthlyBudget(plan);

  const incomeChanges: { key: string; delta: Decimal }[] = [];
  let salary = new D(plan.postGradIncome.annualSalary);
  for (const event of events) {
    if (event.type !== 'income') continue;
    const next = new D(event.amount);
    incomeChanges.push({ key: monthKey(event.date), delta: next.minus(salary).div(12).times(new D(event.allocationPercent).div(100)) });
    salary = next;
  }

  const windfalls = new Map<string, Decimal>();
  for (const event of events) {
    if (event.type !== 'windfall') continue;
    const amount = cents(new D(event.amount).times(new D(event.allocationPercent).div(100)));
    for (const date of windfallOccurrences(event, lastDate)) {
      const key = monthKey(date) < firstKey ? firstKey : monthKey(date);
      windfalls.set(key, (windfalls.get(key) ?? new D(0)).plus(amount));
    }
  }

  // The budget changes in each income-event month, each windfall month, and the month after a windfall.
  const changeKeys = [
    ...incomeChanges.map(change => change.key),
    ...[...windfalls.keys()].map(key => monthKey(addMonths(`${key}-01`, 1))),
  ];
  const lastChange = changeKeys.reduce((latest, key) => (key > latest ? key : latest), '0001-01');

  // Each month's budget is computed once; projections ask for consecutive months only.
  const byMonth = new Map<string, Decimal>();
  return {
    budgetFor: (date: string) => {
      const key = monthKey(date);
      const cached = byMonth.get(key);
      if (cached) return cached;
      let budget = base;
      for (const change of incomeChanges) if (change.key <= key) budget = budget.plus(change.delta);
      const regular = cents(D.max(0, budget));
      const windfall = windfalls.get(key);
      const total = windfall ? regular.plus(windfall) : regular;
      byMonth.set(key, total);
      return total;
    },
    stableFrom: `${lastChange}-01`,
  };
}

/**
 * The one call site of the simulation (also used by the US-506 target solver). US-507: the month grid
 * starts at the voluntary start; each loan's required payments start at its own repayment period.
 * Required payments the plan would miss are added to the warnings (MISSED_REQUIRED_PAYMENT).
 */
export function repaymentFor(plan: PlannerPlan, strategyId: string = plan.repayment.strategyId, limits: { maxMonths?: number } = {}): Result<Projection> {
  const start = voluntaryStartDate(plan);
  const schedule = validDate(start) && validDate(addMonths(start, SIMULATION_CAP_MONTHS + 1))
    ? budgetSchedule(plan, addMonths(start, 1), SIMULATION_CAP_MONTHS) : undefined;
  const timing = paymentTimingFor(plan);
  const firstRequired: Record<string, string> = {};
  const periodStarts: Record<string, string> = {};
  for (const entry of timing) {
    if (entry.firstRequiredPaymentDate !== null) firstRequired[entry.loanId] = entry.firstRequiredPaymentDate;
    if (entry.repaymentPeriodStart !== null) periodStarts[entry.loanId] = entry.repaymentPeriodStart;
  }
  // The M1 projection input: settings.graceMonths is ignored because voluntaryStartDate is given.
  const projectionPlan: Plan = {
    settings: { ...plan.settings, graceMonths: 0 },
    schoolYears: plan.schoolYears,
    loans: plan.loans,
    repayment: { strategyId, extraMonthlyPayment: plan.repayment.extraMonthlyPayment },
  };
  const result = calculateProjection(projectionPlan, {
    strategy: getStrategy(strategyId, { customOrder: plan.repayment.customOrder }),
    capitalizeInterestByLoan: Object.fromEntries(plan.loans.map(loan => [loan.id, loan.capitalizeInterest !== false])),
    monthlyBudget: schedule?.budgetFor,
    budgetStableFrom: schedule?.stableFrom,
    voluntaryStartDate: start,
    firstRequiredPaymentByLoan: firstRequired,
    repaymentPeriodStartByLoan: periodStarts,
    // The target solver stops a candidate at its target month (anything later cannot meet the target).
    maxMonths: Math.min(SIMULATION_CAP_MONTHS, limits.maxMonths ?? SIMULATION_CAP_MONTHS),
  });
  if (!result.ok) return result;
  const missed = missedObligationsFor(plan, timing);
  if (!missed.length) return result;
  return {
    ok: true,
    value: {
      ...result.value,
      warnings: [
        ...missed.map(warning => ({ code: warning.code, message: warning.message, loanId: warning.loanId, date: warning.firstMissedDate })),
        ...result.value.warnings,
      ],
    },
  };
}

function firstPayoffMonth(projection: Projection): number | null {
  for (const row of projection.amortizationSchedule) {
    if (row.loans.some(loan => new D(loan.remainingBalance).isZero())) return row.month;
  }
  return projection.loans.length ? null : 0;
}

const failure = (): { ok: false; errors: FieldError[] } =>
  ({ ok: false, errors: [{ path: 'plan', code: 'OUT_OF_RANGE', message: 'Complete valid plan values before projecting.' }] });

/**
 * Validated base projection, shared by both entry points. The UI computes the core projection and
 * then the comparisons for the same plan, so recent results are memoized by plan content (JSON),
 * never by object identity: a plan mutated in place gets a new key. Results are treated as
 * immutable by callers. The memo is small and bounded.
 */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
const baseMemo = new Map<string, Result<Projection>>();
const BASE_MEMO_SIZE = 8;
function baseRepayment(plan: PlannerPlan): Result<Projection> {
  const key = JSON.stringify(plan);
  const cached = baseMemo.get(key);
  if (cached) return cached;
  const errors = validatePlannerInputs(plan);
  // Cached results are shared between callers, so they are deep-frozen: an accidental in-place
  // .sort()/.reverse() by a caller throws instead of silently corrupting later results.
  const result: Result<Projection> = deepFreeze(errors.length ? { ok: false, errors } : repaymentFor(plan));
  if (baseMemo.size >= BASE_MEMO_SIZE) baseMemo.delete(baseMemo.keys().next().value!);
  baseMemo.set(key, result);
  return result;
}

function buildTimeline(plan: PlannerPlan, repayment: Projection | null): TimelineEntry[] {
  const repaymentStart = repayment?.repaymentStartDate ?? voluntaryStartDate(plan);
  const timeline: TimelineEntry[] = [
    ...plan.schoolYears.map((year, index) => ({ id: year.id, date: year.startDate, label: `School year ${index + 1}`, type: 'school' as const })),
    { id: 'graduation', date: plan.settings.graduationDate, label: 'Graduation', type: 'graduation' },
    ...(validDate(repaymentStart) ? [{ id: 'repayment', date: repaymentStart, label: 'Repayment begins', type: 'repayment' as const }] : []),
    ...plan.lifeEvents.map(event => ({
      id: event.id, date: event.date, label: event.recurrence === 'yearly' ? `${event.name} (yearly)` : event.name, type: 'event' as const,
    })),
  ];
  const names = new Map(plan.loans.map(loan => [loan.id, loan.name]));
  const paid = new Set<string>();
  for (const row of repayment?.amortizationSchedule ?? []) {
    for (const loan of row.loans) {
      if (paid.has(loan.loanId) || !new D(loan.remainingBalance).isZero()) continue;
      paid.add(loan.loanId);
      timeline.push({ id: `payoff-${loan.loanId}`, date: row.date, label: `${names.get(loan.loanId) ?? loan.loanId} paid off`, type: 'payoff' });
    }
  }
  if (repayment?.debtFreeDate) timeline.push({ id: 'debt-free', date: repayment.debtFreeDate, label: 'Debt free', type: 'payoff' });
  // Array.prototype.sort is stable, so same-day entries keep the order above.
  return timeline.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Additive extensions to the shared contract (proposed for planner-contracts.ts; all existing
 * shapes are unchanged). When the plan is valid but repayment cannot be projected (for example a
 * loan disbursed after repayment starts), borrowing-phase results are still available.
 */
export interface RepaymentUnavailable { errors: FieldError[]; reason: string }
export interface PlannerOutputs extends Omit<PlannerProjection, 'repayment' | 'minimumTotal' | 'paymentShortfall'> {
  /* paymentTiming, firstVoluntaryPaymentDate and missedObligations (US-507) are always present. */
  /** Null when repayment cannot be projected; see repaymentUnavailable. */
  repayment: Projection | null;
  minimumTotal: Money | null;
  paymentShortfall: Money | null;
  repaymentUnavailable: RepaymentUnavailable | null;
}
/** A scenario whose plan cannot be projected; listed instead of silently dropped (US-802). */
export interface ScenarioFailure { id: string; name: string; errors: FieldError[]; reason: string }
export interface PlannerComparisonsDetailed extends PlannerComparisons { scenarioFailures: ScenarioFailure[] }

const reasonOf = (errors: readonly FieldError[]) => errors.map(error => error.message).join(' ');

/**
 * Core outputs with partial results (US-304, US-701, US-902). Fails only when planner inputs are
 * invalid; a repayment problem still returns the year summaries and timeline, with repayment null.
 */
export function calculatePlannerOutputs(plan: PlannerPlan): Result<PlannerOutputs> {
  try {
    const plannerErrors = validatePlannerInputs(plan);
    if (plannerErrors.length) return { ok: false, errors: plannerErrors };
    const years = plan.schoolYears.map((year, index) => summarizeYear(plan, year, index));
    const base = baseRepayment(plan);
    const paymentTiming = paymentTimingFor(plan);
    const timing = { paymentTiming, firstVoluntaryPaymentDate: firstVoluntaryPaymentDate(plan), missedObligations: missedObligationsFor(plan, paymentTiming) };
    const notices: string[] = [];
    if (plan.repayment.mode === 'federal') {
      notices.push('The amortization schedule below is the standard repayment model. Federal repayment estimates are shown separately.');
    }
    if (!base.ok) {
      return {
        ok: true,
        value: {
          repayment: null, years, minimumTotal: null, paymentShortfall: null, timeline: buildTimeline(plan, null), notices, ...timing,
          repaymentUnavailable: { errors: [...base.errors], reason: reasonOf(base.errors) },
        },
      };
    }
    const repayment = base.value;
    const minimumTotal = sum(repayment.loans.map(loan => loan.minimumMonthlyPayment));
    const budget = baseMonthlyBudget(plan);
    if (plan.lifeEvents.some(event => event.type === 'windfall' && monthKey(event.date) < monthKey(repayment.firstPaymentDate))) {
      notices.push('Windfalls dated before repayment starts are assumed to be saved and applied in the first repayment month.');
    }
    notices.push('Interest uses simple daily school accrual and monthly repayment accrual; results are estimates.');
    return {
      ok: true,
      value: {
        repayment,
        years,
        minimumTotal: money(minimumTotal),
        paymentShortfall: money(D.max(0, minimumTotal.minus(budget))),
        timeline: buildTimeline(plan, repayment),
        notices,
        ...timing,
        repaymentUnavailable: null,
      },
    };
  } catch {
    return failure();
  }
}

/**
 * Core outputs in the contract shape (US-701: recomputed on every edit). Fails when repayment
 * cannot be projected; use calculatePlannerOutputs to keep the borrowing-phase results.
 */
export function calculatePlannerProjection(plan: PlannerPlan): PlannerResult {
  const result = calculatePlannerOutputs(plan);
  if (!result.ok) return result;
  const { repayment, years, minimumTotal, paymentShortfall, timeline, notices, repaymentUnavailable, paymentTiming, firstVoluntaryPaymentDate: firstPayment, missedObligations } = result.value;
  if (!repayment || minimumTotal === null || paymentShortfall === null) return { ok: false, errors: repaymentUnavailable?.errors ?? failure().errors };
  return { ok: true, value: { repayment, years, minimumTotal, paymentShortfall, timeline, notices, paymentTiming, firstVoluntaryPaymentDate: firstPayment, missedObligations } };
}

const monthsOf = (projection: Projection) => projection.amortizationSchedule.length;

/** Secondary outputs: strategy and scenario comparisons, life-event impacts, and the scenario range. */
export function calculatePlannerComparisons(plan: PlannerPlan): Result<PlannerComparisonsDetailed> {
  try {
    const base = baseRepayment(plan);
    if (!base.ok) return base;
    const baseProjection = base.value;

    // US-604/605: every user-facing registry strategy, compared to the lowest-interest result.
    // Neutral language: the differences are facts, no strategy is labeled as preferred.
    const strategyComparisons: Comparison[] = [];
    for (const entry of listStrategies()) {
      const result = entry.id === plan.repayment.strategyId ? base : repaymentFor(plan, entry.id);
      if (!result.ok) continue;
      strategyComparisons.push({
        id: entry.id, name: entry.name, projection: result.value, firstPayoffMonth: firstPayoffMonth(result.value),
        interestDifference: null, monthsDifference: null,
      });
    }
    const completed = strategyComparisons.filter(item => item.projection.totalInterestPaid !== null);
    const lowest = completed.reduce<Comparison | undefined>((best, item) =>
      !best || new D(item.projection.totalInterestPaid!).lt(best.projection.totalInterestPaid!) ? item : best, undefined);
    if (lowest) {
      for (const item of completed) {
        item.interestDifference = money(new D(item.projection.totalInterestPaid!).minus(lowest.projection.totalInterestPaid!));
        item.monthsDifference = monthsOf(item.projection) - monthsOf(lowest.projection);
      }
    }

    // US-802: scenarios relative to the base plan. Scenarios that cannot be projected are reported
    // in scenarioFailures, with the reason, instead of disappearing.
    const scenarioComparisons: Comparison[] = [];
    const scenarioFailures: ScenarioFailure[] = [];
    for (const scenario of plan.scenarios) {
      const result = baseRepayment(applyScenario(plan, scenario));
      if (!result.ok) {
        scenarioFailures.push({ id: scenario.id, name: scenario.name, errors: [...result.errors], reason: reasonOf(result.errors) });
        continue;
      }
      const projection = result.value;
      const bothPaid = projection.totalInterestPaid !== null && baseProjection.totalInterestPaid !== null;
      scenarioComparisons.push({
        id: scenario.id, name: scenario.name, projection, firstPayoffMonth: firstPayoffMonth(projection),
        interestDifference: bothPaid ? money(new D(projection.totalInterestPaid!).minus(baseProjection.totalInterestPaid!)) : null,
        monthsDifference: bothPaid ? monthsOf(projection) - monthsOf(baseProjection) : null,
      });
    }

    // Range over base + scenarios. `latest` is null when any of them has no projected debt-free date
    // or cannot be projected at all (a bounded range would understate the uncertainty).
    const projections = [baseProjection, ...scenarioComparisons.map(item => item.projection)];
    const dates = projections.map(item => item.debtFreeDate).filter((date): date is string => date !== null).sort();
    const scenarioRange = {
      earliest: dates[0] ?? null,
      latest: dates.length === projections.length && !scenarioFailures.length ? dates[dates.length - 1] : null,
    };

    // US-703: impact = base plan without the event minus base plan (positive = event helps).
    const eventImpacts: EventImpact[] = plan.lifeEvents.map(event => {
      const without = repaymentFor({ ...plan, lifeEvents: plan.lifeEvents.filter(item => item.id !== event.id) });
      const comparable = without.ok && without.value.totalInterestPaid !== null && baseProjection.totalInterestPaid !== null;
      return {
        eventId: event.id,
        monthsSaved: comparable ? monthsOf(without.value) - monthsOf(baseProjection) : null,
        interestSaved: comparable ? money(new D(without.value.totalInterestPaid!).minus(baseProjection.totalInterestPaid!)) : null,
      };
    });

    return { ok: true, value: { strategyComparisons, scenarioComparisons, scenarioFailures, eventImpacts, scenarioRange } };
  } catch {
    return failure();
  }
}
