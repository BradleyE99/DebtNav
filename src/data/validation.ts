/**
 * Schema v3 validation for persisted and edited plans.
 *
 * - Never throws, whatever the input (NFR-11): every check is defensive and the whole run is
 *   wrapped in a try/catch that converts unexpected failures into a field error.
 * - FieldError.path uses the contract's field-path format (record IDs, never array indexes), so the
 *   UI can show each message next to the input with the same id.
 * - Validation guarantees the engine can project the plan: besides structure it rejects a loan
 *   disbursed after repayment starts (graduation + grace), at 'loans.<id>.disbursementDate'.
 *   usePlannerDocument re-attributes that error to the settings field when a date/grace edit causes
 *   it; scenario checks attribute it to the responsible override. Softer planning problems are
 *   reported by the projection and never block an edit.
 */
import { D } from '../engine/money';
import { addMonths, validDate } from '../engine/dates';
import { applyScenario } from '../engine/planner';
import { isResolvablePath, overridablePaths } from '../engine/paths';
import { listStrategies } from '../engine/strategies/registry';
import type { FieldError, PlannerDocument, PlannerPlan, Result } from '../engine/planner-contracts';

type Code = FieldError['code'];
type Obj = Record<string, unknown>;

export const LIMITS = {
  money: '1000000000',
  hourlyWage: '10000',
  hoursPerWeek: '168',
  weeksWorked: '53',
  percent: '100',
  rate: '0.3',
  graceMonths: { min: 0, max: 12 },
  termMonths: { min: 1, max: 1200 },
  horizonMonths: { min: 1, max: 1200 },
  familySize: { min: 1, max: 20 },
  schoolYears: 50,
  schoolSpanYears: 50,
  costItemsPerYear: 100,
  resourcesPerYear: 100,
  loans: 50,
  lifeEvents: 100,
  scenarios: 20,
  overridesPerScenario: 200,
  textLength: 200,
  overrideDepth: 8,
  nestingDepth: 32,
  /** Every plan date (timeline, loans, events) must fall in this calendar window. */
  dates: { min: '1900-01-01', max: '2199-12-31' },
} as const;

/** Year window for every plan date, shared with parseDateInput so field and plan rules agree. */
export const DATE_RANGE_MESSAGE = 'Enter a date between 1900 and 2199.';
export const dateInRange = (value: string): boolean => value >= LIMITS.dates.min && value <= LIMITS.dates.max;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const COST_CATEGORIES = ['tuition', 'fees', 'housing', 'food', 'books', 'transportation', 'personal', 'other'];
const COST_PERIODS = ['annual', 'fall', 'spring', 'summer'];
const RESOURCE_TYPES = ['grant', 'scholarship', 'job', 'savings', 'family', 'other'];
const LOAN_TYPES = ['subsidized', 'unsubsidized', 'private', 'other'];
const EVENT_TYPES = ['income', 'windfall', 'expense', 'aid'];
/** US-605: user-selectable strategies come from the engine registry (internal ones are excluded). */
const strategyIds = (): string[] => listStrategies().map(entry => entry.id);

export const isPlainObject = (value: unknown): value is Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** True when a dot path is safe to use as a scenario override key / field path. */
export function isSafeFieldPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 500) return false;
  const parts = path.split('.');
  return parts.length <= LIMITS.overrideDepth && parts.every(part => ID_PATTERN.test(part) && !FORBIDDEN_KEYS.has(part));
}

class Checker {
  readonly errors: FieldError[] = [];

  fail(path: string, code: Code, message: string): void {
    this.errors.push({ path, code, message });
  }

  object(value: unknown, path: string): Obj {
    if (isPlainObject(value)) return value;
    this.fail(path, 'REQUIRED', 'This section is missing or malformed.');
    return {};
  }

  list(value: unknown, path: string, max: number, noun: string): unknown[] {
    if (!Array.isArray(value)) {
      this.fail(path, 'REQUIRED', `Expected a list of ${noun}.`);
      return [];
    }
    if (value.length > max) {
      this.fail(path, 'OUT_OF_RANGE', `Use at most ${max} ${noun}.`);
      return value.slice(0, max);
    }
    return value;
  }

  text(value: unknown, path: string): void {
    if (typeof value !== 'string' || value.trim() === '') this.fail(path, 'REQUIRED', 'Enter a name.');
    else if (value.length > LIMITS.textLength) this.fail(path, 'OUT_OF_RANGE', `Use ${LIMITS.textLength} characters or fewer.`);
  }

  /** Nonnegative decimal text with at most `places` decimals and at most `max`. */
  decimal(value: unknown, path: string, options: { max: string; places: number; code?: Code; optional?: boolean }): void {
    if (value === undefined && options.optional) return;
    const code = options.code ?? 'INVALID_MONEY';
    const pattern = new RegExp(`^\\d{1,20}(\\.\\d{1,${options.places}})?$`);
    if (typeof value !== 'string' || !pattern.test(value)) {
      const what = options.places === 2 ? 'a dollar amount with at most 2 decimal places' : `a number with at most ${options.places} decimal places`;
      this.fail(path, value === undefined || value === '' ? 'REQUIRED' : code, `Enter ${what}.`);
      return;
    }
    if (new D(value).gt(options.max)) this.fail(path, 'OUT_OF_RANGE', `Enter ${new D(options.max).toFixed()} or less.`);
  }

  money(value: unknown, path: string, optional = false, max: string = LIMITS.money): void {
    this.decimal(value, path, { max, places: 2, optional });
  }

  percent(value: unknown, path: string): void {
    this.decimal(value, path, { max: LIMITS.percent, places: 8, code: 'OUT_OF_RANGE' });
  }

  rate(value: unknown, path: string): void {
    this.decimal(value, path, { max: LIMITS.rate, places: 12, code: 'INVALID_RATE' });
  }

  integer(value: unknown, path: string, range: { min: number; max: number }, optional = false): void {
    if (value === undefined && optional) return;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < range.min || value > range.max) {
      this.fail(path, value === undefined ? 'REQUIRED' : 'OUT_OF_RANGE', `Enter a whole number from ${range.min} to ${range.max}.`);
    }
  }

  date(value: unknown, path: string, optional = false): value is string {
    if (value === undefined && optional) return false;
    if (!validDate(value)) {
      this.fail(path, value === undefined || value === '' ? 'REQUIRED' : 'INVALID_DATE', 'Enter a complete, valid date (YYYY-MM-DD).');
      return false;
    }
    if (!dateInRange(value)) {
      this.fail(path, 'OUT_OF_RANGE', DATE_RANGE_MESSAGE);
      return false;
    }
    return true;
  }

  choice(value: unknown, path: string, options: readonly string[], code: Code = 'OUT_OF_RANGE'): void {
    if (typeof value !== 'string' || !options.includes(value)) this.fail(path, code, `Choose one of: ${options.join(', ')}.`);
  }

  bool(value: unknown, path: string, optional = false): void {
    if (value === undefined && optional) return;
    if (typeof value !== 'boolean') this.fail(path, 'REQUIRED', 'Expected yes or no.');
  }

  /**
   * Checks an array of records with IDs. Returns [id, record] pairs for records whose ID is valid and
   * unique, so later checks can build ID-based field paths. Malformed records are reported under
   * the collection path.
   */
  records(value: unknown, path: string, max: number, noun: string): Array<[string, Obj]> {
    const seen = new Set<string>();
    const out: Array<[string, Obj]> = [];
    for (const item of this.list(value, path, max, noun)) {
      if (!isPlainObject(item)) {
        this.fail(path, 'REQUIRED', `One of the ${noun} is malformed.`);
        continue;
      }
      const id = item.id;
      if (typeof id !== 'string' || !ID_PATTERN.test(id) || FORBIDDEN_KEYS.has(id)) {
        this.fail(path, 'REQUIRED', `One of the ${noun} has an invalid ID.`);
        continue;
      }
      if (seen.has(id)) {
        this.fail(`${path}.${id}`, 'DUPLICATE_ID', `Two ${noun} share the ID "${id}".`);
        continue;
      }
      seen.add(id);
      out.push([id, item]);
    }
    return out;
  }
}

/** Reject dangerous keys and runaway nesting anywhere in the input, before anything merges it. */
function scanUnsafe(value: unknown, check: Checker, depth = 0): void {
  if (value === null || typeof value !== 'object') return;
  if (depth > LIMITS.nestingDepth) {
    check.fail('plan', 'OUT_OF_RANGE', 'The data is nested too deeply.');
    return;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      check.fail('plan', 'OUT_OF_RANGE', 'The data contains an unsafe key.');
      return;
    }
    scanUnsafe((value as Obj)[key], check, depth + 1);
  }
}

function validateSettings(plan: Obj, check: Checker): { start?: string; graduation?: string } {
  const settings = check.object(plan.settings, 'settings');
  const startOk = check.date(settings.startDate, 'settings.startDate');
  const graduationOk = check.date(settings.graduationDate, 'settings.graduationDate');
  check.integer(settings.graceMonths, 'settings.graceMonths', LIMITS.graceMonths);
  check.choice(settings.currency, 'settings.currency', ['USD']);
  if (!startOk || !graduationOk) return {};
  const start = settings.startDate as string;
  const graduation = settings.graduationDate as string;
  // US-101: graduation must be strictly after the start. Equal dates would model a zero-day school
  // period (one empty, zero-length "year"), which cannot hold costs, aid or in-school interest.
  if (graduation <= start) {
    check.fail('settings.graduationDate', 'OUT_OF_RANGE', 'Graduation must be after your school start date.');
    return {};
  }
  if (graduation > addMonths(start, LIMITS.schoolSpanYears * 12)) {
    check.fail('settings.graduationDate', 'OUT_OF_RANGE', `Model a school timeline of ${LIMITS.schoolSpanYears} years or less.`);
    return {};
  }
  return { start, graduation };
}

function validateSchoolYears(plan: Obj, check: Checker, dates: { start?: string; graduation?: string }): Set<string> {
  const years = check.records(plan.schoolYears, 'schoolYears', LIMITS.schoolYears, 'school years');
  const ids = new Set<string>();
  let previousEnd: string | undefined;
  let structureOk = true;
  years.forEach(([id, year], index) => {
    ids.add(id);
    const base = `schoolYears.${id}`;
    const startOk = check.date(year.startDate, `${base}.startDate`);
    const endOk = check.date(year.endDate, `${base}.endDate`);
    check.percent(year.bufferPercent, `${base}.bufferPercent`);
    if (startOk && endOk) {
      const start = year.startDate as string;
      const end = year.endDate as string;
      if (end < start) check.fail(`${base}.endDate`, 'OUT_OF_RANGE', 'A school year must end on or after it starts.');
      if (index === 0 ? start !== dates.start : start !== previousEnd) structureOk = false;
      previousEnd = end;
    } else {
      structureOk = false;
    }

    for (const [itemId, item] of check.records(year.costItems, `${base}.costItems`, LIMITS.costItemsPerYear, 'cost items')) {
      const path = `${base}.costItems.${itemId}`;
      check.choice(item.category, `${path}.category`, COST_CATEGORIES);
      check.text(item.label, `${path}.label`);
      check.money(item.amount, `${path}.amount`);
      check.choice(item.semester, `${path}.semester`, COST_PERIODS);
    }

    for (const [resourceId, resource] of check.records(year.resources, `${base}.resources`, LIMITS.resourcesPerYear, 'resources')) {
      const path = `${base}.resources.${resourceId}`;
      check.choice(resource.type, `${path}.type`, RESOURCE_TYPES);
      check.text(resource.label, `${path}.label`);
      check.money(resource.amount, `${path}.amount`);
      check.choice(resource.incomeMode, `${path}.incomeMode`, ['fixed', 'hourly']);
      check.money(resource.hourlyWage, `${path}.hourlyWage`, false, LIMITS.hourlyWage);
      check.decimal(resource.hoursPerWeek, `${path}.hoursPerWeek`, { max: LIMITS.hoursPerWeek, places: 8, code: 'OUT_OF_RANGE' });
      check.decimal(resource.weeksWorked, `${path}.weeksWorked`, { max: LIMITS.weeksWorked, places: 8, code: 'OUT_OF_RANGE' });
      check.percent(resource.unavailablePercent, `${path}.unavailablePercent`);
    }
  });

  if (dates.start && dates.graduation) {
    const lastEnd = years.length ? (years.at(-1)![1].endDate as string) : undefined;
    if (years.length === 0 || !structureOk || lastEnd !== dates.graduation) {
      check.fail('schoolYears', 'OUT_OF_RANGE', 'School years must run back-to-back from the school start date to graduation.');
    }
  }
  return ids;
}

function validateLoans(plan: Obj, check: Checker, yearIds: Set<string>): Set<string> {
  const ids = new Set<string>();
  for (const [id, loan] of check.records(plan.loans, 'loans', LIMITS.loans, 'loans')) {
    ids.add(id);
    const path = `loans.${id}`;
    check.text(loan.name, `${path}.name`);
    check.choice(loan.type, `${path}.type`, LOAN_TYPES);
    check.money(loan.principal, `${path}.principal`);
    check.rate(loan.annualRate, `${path}.annualRate`);
    check.date(loan.disbursementDate, `${path}.disbursementDate`);
    check.integer(loan.termMonths, `${path}.termMonths`, LIMITS.termMonths);
    check.bool(loan.payInterestWhileInSchool, `${path}.payInterestWhileInSchool`, true);
    check.bool(loan.accruesInterestInSchool, `${path}.accruesInterestInSchool`, true);
    check.bool(loan.capitalizeInterest, `${path}.capitalizeInterest`, true);
    check.money(loan.monthlyPayment, `${path}.monthlyPayment`, true);
    check.money(loan.gapAtCreation, `${path}.gapAtCreation`, true);
    if (loan.schoolYearId !== undefined && (typeof loan.schoolYearId !== 'string' || !yearIds.has(loan.schoolYearId))) {
      check.fail(`${path}.schoolYearId`, 'OUT_OF_RANGE', 'This loan points to a school year that no longer exists.');
    }
  }
  return ids;
}

function validateRepayment(plan: Obj, check: Checker, loanIds: Set<string>): void {
  const repayment = check.object(plan.repayment, 'repayment');
  check.choice(repayment.strategyId, 'repayment.strategyId', strategyIds(), 'UNKNOWN_STRATEGY');
  check.money(repayment.extraMonthlyPayment, 'repayment.extraMonthlyPayment');
  check.integer(repayment.maxMonths, 'repayment.maxMonths', LIMITS.horizonMonths, true);
  check.choice(repayment.mode, 'repayment.mode', ['standard', 'federal']);
  check.choice(repayment.federalPlan, 'repayment.federalPlan', ['ibr', 'rap']);
  check.integer(repayment.familySize, 'repayment.familySize', LIMITS.familySize);
  check.money(repayment.annualAGI, 'repayment.annualAGI');
  const order = check.list(repayment.customOrder, 'repayment.customOrder', LIMITS.loans, 'loans');
  const seen = new Set<unknown>();
  for (const id of order) {
    if (typeof id !== 'string' || !loanIds.has(id) || seen.has(id)) {
      check.fail('repayment.customOrder', 'INVALID_STRATEGY', 'The custom order must list each existing loan at most once.');
      break;
    }
    seen.add(id);
  }
}

function validatePeople(plan: Obj, check: Checker): void {
  const income = check.object(plan.postGradIncome, 'postGradIncome');
  check.money(income.annualSalary, 'postGradIncome.annualSalary');
  check.money(income.monthlyDebtBudget, 'postGradIncome.monthlyDebtBudget');
  check.percent(income.raiseAllocationPercent, 'postGradIncome.raiseAllocationPercent');

  const borrower = check.object(plan.borrower, 'borrower');
  check.choice(borrower.dependency, 'borrower.dependency', ['dependent', 'independent']);
  check.choice(borrower.level, 'borrower.level', ['undergraduate', 'graduate']);
  check.money(borrower.priorFederalDebt, 'borrower.priorFederalDebt');
}

function validateLifeEvents(plan: Obj, check: Checker, yearIds: Set<string>): void {
  for (const [id, event] of check.records(plan.lifeEvents, 'lifeEvents', LIMITS.lifeEvents, 'life events')) {
    const path = `lifeEvents.${id}`;
    check.text(event.name, `${path}.name`);
    const dateOk = check.date(event.date, `${path}.date`);
    check.choice(event.type, `${path}.type`, EVENT_TYPES);
    check.money(event.amount, `${path}.amount`);
    check.percent(event.allocationPercent, `${path}.allocationPercent`);
    if (event.schoolYearId !== undefined && (typeof event.schoolYearId !== 'string' || !yearIds.has(event.schoolYearId))) {
      check.fail(`${path}.schoolYearId`, 'OUT_OF_RANGE', 'This event points to a school year that no longer exists.');
    }
    if (event.recurrence !== undefined) check.choice(event.recurrence, `${path}.recurrence`, ['once', 'yearly']);
    if (event.recurrenceEndDate !== undefined && check.date(event.recurrenceEndDate, `${path}.recurrenceEndDate`)) {
      if (dateOk && (event.recurrenceEndDate as string) < (event.date as string)) {
        check.fail(`${path}.recurrenceEndDate`, 'OUT_OF_RANGE', 'The repeat end date must be on or after the event date.');
      }
    }
  }
}

function validateScenarioShapes(plan: Obj, check: Checker): void {
  for (const [id, scenario] of check.records(plan.scenarios, 'scenarios', LIMITS.scenarios, 'scenarios')) {
    const path = `scenarios.${id}`;
    check.text(scenario.name, `${path}.name`);
    const overrides = check.object(scenario.overrides, `${path}.overrides`);
    const entries = Object.entries(overrides);
    if (entries.length > LIMITS.overridesPerScenario) {
      check.fail(`${path}.overrides`, 'OUT_OF_RANGE', `Use at most ${LIMITS.overridesPerScenario} changed assumptions per scenario.`);
      continue;
    }
    for (const [key, value] of entries) {
      if (!isSafeFieldPath(key)) {
        check.fail(`${path}.overrides`, 'OUT_OF_RANGE', 'A scenario contains an invalid field reference.');
        continue;
      }
      const scalar = typeof value === 'boolean'
        || (typeof value === 'number' && Number.isFinite(value))
        || (typeof value === 'string' && value.length <= LIMITS.textLength);
      if (!scalar) check.fail(`${path}.overrides.${key}`, 'OUT_OF_RANGE', 'A changed assumption must be text, a number, or yes/no.');
    }
  }
}

/** Read a field path from a plan, resolving arrays by record ID. */
function lookup(plan: unknown, path: string): unknown {
  let cursor: unknown = plan;
  for (const part of path.split('.')) {
    if (Array.isArray(cursor)) cursor = cursor.find(item => isPlainObject(item) && item.id === part);
    else if (isPlainObject(cursor) && Object.hasOwn(cursor, part)) cursor = cursor[part];
    else return undefined;
  }
  return cursor;
}

/**
 * Field shapes (record IDs replaced by '*') that scenarios may override. This is the union of every
 * shape overridablePaths() can list for any record type, so changing a record's type (for example a
 * resource from fixed to hourly) does not invalidate an existing override.
 */
const OVERRIDABLE_SHAPES = new Set([
  'settings.startDate', 'settings.graduationDate', 'settings.graceMonths',
  'postGradIncome.annualSalary', 'postGradIncome.monthlyDebtBudget',
  'repayment.extraMonthlyPayment', 'repayment.strategyId',
  'schoolYears.*.bufferPercent', 'schoolYears.*.costItems.*.amount',
  'schoolYears.*.resources.*.amount', 'schoolYears.*.resources.*.hourlyWage', 'schoolYears.*.resources.*.unavailablePercent',
  'loans.*.principal', 'loans.*.annualRate', 'loans.*.termMonths', 'loans.*.disbursementDate',
  'lifeEvents.*.date', 'lifeEvents.*.amount', 'lifeEvents.*.allocationPercent',
]);

/** 'schoolYears.y1.costItems.c1.amount' → 'schoolYears.*.costItems.*.amount'. */
export function fieldShape(path: string): string {
  const parts = path.split('.');
  return parts.map((part, index) => {
    const isId = (index === 1 && ['schoolYears', 'loans', 'lifeEvents'].includes(parts[0]))
      || (index === 3 && parts[0] === 'schoolYears' && ['costItems', 'resources'].includes(parts[2]));
    return isId ? '*' : part;
  }).join('.');
}

/**
 * For a structurally valid plan, every override key must point at an existing, scenario-overridable
 * field, hold the same kind of value as that field, and produce a valid effective plan. Errors are
 * reported as 'scenarios.<id>.overrides.<path>'. (Editing through usePlannerDocument prunes keys of
 * removed records automatically, so this only rejects hand-edited or corrupted data.)
 */
function validateScenarioEffects(plan: PlannerPlan, check: Checker): void {
  let listed: Set<string> | null = null;
  for (const scenario of plan.scenarios) {
    const prefix = `scenarios.${scenario.id}.overrides`;
    let mismatch = false;
    for (const [key, value] of Object.entries(scenario.overrides)) {
      const target = lookup(plan, key);
      listed ??= new Set(overridablePaths(plan).map(entry => fieldShape(entry.path)));
      const shape = fieldShape(key);
      if (!OVERRIDABLE_SHAPES.has(shape) && !listed.has(shape)) {
        check.fail(`${prefix}.${key}`, 'OUT_OF_RANGE', 'This scenario changes a field that scenarios cannot change.');
        mismatch = true;
      } else if (target === undefined || !isResolvablePath(plan, key)) {
        check.fail(`${prefix}.${key}`, 'OUT_OF_RANGE', 'This scenario changes a field that no longer exists.');
        mismatch = true;
      } else if (typeof target !== typeof value || typeof target === 'object') {
        check.fail(`${prefix}.${key}`, 'OUT_OF_RANGE', 'This changed assumption has the wrong kind of value.');
        mismatch = true;
      }
    }
    if (mismatch) continue;
    let effective: PlannerPlan;
    try {
      effective = { ...applyScenario({ ...plan, scenarios: [] }, scenario), scenarios: [] };
    } catch {
      check.fail(prefix, 'OUT_OF_RANGE', 'This scenario could not be applied.');
      continue;
    }
    const nested = runValidation(effective, false);
    for (const error of nested) {
      const loanId = DISBURSEMENT_PATH.exec(error.path)?.[1];
      if (loanId === undefined || Object.hasOwn(scenario.overrides, error.path)) {
        check.fail(`${prefix}.${error.path}`, error.code, error.message);
        continue;
      }
      // The loan's own date is not overridden, so a date or grace override caused this.
      const cause = ['settings.graduationDate', 'settings.graceMonths'].find(key => Object.hasOwn(scenario.overrides, key));
      const loan = plan.loans.find(entry => entry.id === loanId);
      const start = repaymentStartDate(effective.settings);
      check.fail(
        `${prefix}.${cause ?? error.path}`,
        error.code,
        cause ? `In this scenario repayment would start ${start}, before loan "${loan?.name ?? loanId}" is disbursed (${loan?.disbursementDate}).` : error.message,
      );
    }
  }
}

export const repaymentStartDate = (settings: PlannerPlan['settings']): string => addMonths(settings.graduationDate, settings.graceMonths);
const disbursementMessage = (start: string): string => `Disbursement must be on or before repayment start (${start}).`;
/** True for the disbursement-after-repayment-start rule (base loan field or scenario attribution). */
export function isDisbursementError(error: FieldError): boolean {
  return error.code === 'OUT_OF_RANGE'
    && (error.message.startsWith('Disbursement must be on or before repayment start') || error.message.startsWith('In this scenario repayment would start'));
}
export const DISBURSEMENT_PATH = /^loans\.([A-Za-z0-9_-]+)\.disbursementDate$/;

function runValidation(value: unknown, includeScenarios: boolean): FieldError[] {
  const check = new Checker();
  try {
    if (!isPlainObject(value)) {
      check.fail('plan', 'REQUIRED', 'Expected a plan.');
      return check.errors;
    }
    scanUnsafe(value, check);
    if (check.errors.length) return check.errors;

    const dates = validateSettings(value, check);
    const yearIds = validateSchoolYears(value, check, dates);
    const loanIds = validateLoans(value, check, yearIds);
    validateRepayment(value, check, loanIds);
    validatePeople(value, check);
    validateLifeEvents(value, check, yearIds);
    validateScenarioShapes(value, check);

    if (check.errors.length === 0 && dates.graduation) {
      // Keep every derived repayment date inside the supported calendar (years 0001–9999).
      const settings = value.settings as PlannerPlan['settings'];
      const horizon = (value.repayment as Obj).maxMonths;
      const start = addMonths(settings.graduationDate, settings.graceMonths);
      const end = validDate(start) ? addMonths(start, (typeof horizon === 'number' ? horizon : 600) + 1) : '';
      if (!validDate(start) || !validDate(end)) {
        check.fail('settings.graduationDate', 'OUT_OF_RANGE', 'Repayment would extend past the year 9999. Choose an earlier date.');
      } else {
        // The engine cannot project a loan disbursed after repayment starts.
        for (const loan of value.loans as PlannerPlan['loans']) {
          if (loan.disbursementDate > start) {
            check.fail(`loans.${loan.id}.disbursementDate`, 'OUT_OF_RANGE', disbursementMessage(start));
          }
        }
      }
    }

    if (includeScenarios && check.errors.length === 0) validateScenarioEffects(value as unknown as PlannerPlan, check);
  } catch {
    check.fail('plan', 'OUT_OF_RANGE', 'The plan could not be checked.');
  }
  return check.errors;
}

export function validatePlannerPlan(value: unknown): Result<PlannerPlan> {
  const errors = runValidation(value, true);
  return errors.length ? { ok: false, errors } : { ok: true, value: value as PlannerPlan };
}

/** Copy only the listed keys whose value is defined (optional fields stay absent, never `undefined`). */
function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

/**
 * A deep copy of a validated plan containing only plan inputs defined by schema v3. Anything else
 * (derived projections, UI drafts, unknown keys from other tools) is dropped, so storage and export
 * hold exactly the user's inputs.
 */
export function toPersistedPlan(plan: PlannerPlan): PlannerPlan {
  return {
    settings: pick(plan.settings, ['startDate', 'graduationDate', 'graceMonths', 'currency']),
    schoolYears: plan.schoolYears.map(year => ({
      ...pick(year, ['id', 'startDate', 'endDate', 'bufferPercent']),
      costItems: year.costItems.map(item => pick(item, ['id', 'category', 'label', 'amount', 'semester'])),
      resources: year.resources.map(resource => pick(resource, [
        'id', 'type', 'label', 'amount', 'incomeMode', 'hourlyWage', 'hoursPerWeek', 'weeksWorked', 'unavailablePercent',
      ])),
    })),
    loans: plan.loans.map(loan => pick(loan, [
      'id', 'name', 'type', 'principal', 'annualRate', 'disbursementDate', 'termMonths', 'payInterestWhileInSchool',
      'accruesInterestInSchool', 'monthlyPayment', 'schoolYearId', 'gapAtCreation', 'capitalizeInterest',
    ])),
    repayment: {
      ...pick(plan.repayment, ['strategyId', 'extraMonthlyPayment', 'maxMonths', 'mode', 'federalPlan', 'familySize', 'annualAGI']),
      customOrder: [...plan.repayment.customOrder],
    },
    postGradIncome: pick(plan.postGradIncome, ['annualSalary', 'monthlyDebtBudget', 'raiseAllocationPercent']),
    lifeEvents: plan.lifeEvents.map(event => pick(event, [
      'id', 'name', 'date', 'type', 'amount', 'allocationPercent', 'schoolYearId', 'recurrence', 'recurrenceEndDate',
    ])),
    scenarios: plan.scenarios.map(scenario => ({
      ...pick(scenario, ['id', 'name']),
      // Object.fromEntries defines own properties only, so no key can reach a prototype.
      overrides: Object.fromEntries(Object.entries(scenario.overrides)),
    })),
    borrower: pick(plan.borrower, ['dependency', 'level', 'priorFederalDebt']),
  } as PlannerPlan;
}

/** Validates a v3 document and returns a normalized copy containing only persisted fields. */
export function validateDocument(value: unknown): Result<PlannerDocument> {
  try {
    if (!isPlainObject(value)) return { ok: false, errors: [{ path: 'document', code: 'REQUIRED', message: 'Expected a DebtNav plan document.' }] };
    const plan = validatePlannerPlan(value.plan);
    if (!plan.ok) return plan;
    if (typeof value.disclaimerDismissed !== 'boolean') {
      return { ok: false, errors: [{ path: 'disclaimerDismissed', code: 'REQUIRED', message: 'Expected the disclaimer preference to be yes or no.' }] };
    }
    return { ok: true, value: { plan: toPersistedPlan(plan.value), disclaimerDismissed: value.disclaimerDismissed } };
  } catch {
    return { ok: false, errors: [{ path: 'document', code: 'OUT_OF_RANGE', message: 'The plan document could not be checked.' }] };
  }
}
