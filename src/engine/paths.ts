/**
 * Field-path helpers (see the planner-contracts.ts header). A path is a dot path through object
 * keys that uses record IDs, never array indexes, for arrays:
 *   'settings.graceMonths', 'loans.<loanId>.annualRate', 'schoolYears.<yearId>.costItems.<itemId>.amount'.
 * All functions are pure and never mutate their inputs.
 */
import type { OverrideValue, PlannerPlan, Scenario } from './planner-contracts';
import { D, decimalText } from './money';
import { listStrategies } from './strategies/registry';

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

/** Optional leaf keys that may be overridden even when the base record omits them. */
const OPTIONAL_KEYS: Record<string, readonly string[]> = {
  repayment: ['maxMonths'],
  'loans.*': ['monthlyPayment', 'payInterestWhileInSchool', 'accruesInterestInSchool', 'capitalizeInterest'],
  'lifeEvents.*': ['recurrence', 'recurrenceEndDate'],
};

/** Shape of a parent path with record ids replaced by '*', e.g. 'schoolYears.*.costItems.*'. */
function parentShape(parts: readonly string[]): string {
  return parts.map((part, index) => (index % 2 === 1 && isCollectionSegment(parts, index - 1) ? '*' : part)).join('.');
}
function isCollectionSegment(parts: readonly string[], index: number): boolean {
  const key = parts[index];
  if (index === 0) return key === 'schoolYears' || key === 'loans' || key === 'lifeEvents';
  return index === 2 && parts[0] === 'schoolYears' && (key === 'costItems' || key === 'resources');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isOverrideValue(value: unknown): value is OverrideValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

interface ResolvedPath { parent: Record<string, unknown>; key: string }

/**
 * Resolve the record that owns a path's leaf. Returns undefined for malformed or unsafe paths,
 * paths into scenarios, id fields, and records that no longer exist (dangling paths).
 */
function resolve(plan: PlannerPlan, path: string): ResolvedPath | undefined {
  if (typeof path !== 'string' || path.length === 0 || path.length > 500) return undefined;
  const parts = path.split('.');
  if (parts.some(part => part.length === 0 || FORBIDDEN_SEGMENTS.has(part))) return undefined;
  if (parts[0] === 'scenarios') return undefined;
  const key = parts[parts.length - 1];
  if (key === 'id') return undefined;
  let cursor: unknown = plan;
  for (const part of parts.slice(0, -1)) {
    if (Array.isArray(cursor)) cursor = cursor.find(item => isRecord(item) && item.id === part);
    else if (isRecord(cursor) && Object.hasOwn(cursor, part)) cursor = cursor[part];
    else return undefined;
  }
  if (!isRecord(cursor)) return undefined;
  if (Object.hasOwn(cursor, key)) return isOverrideValue(cursor[key]) ? { parent: cursor, key } : undefined;
  const optional = OPTIONAL_KEYS[parentShape(parts.slice(0, -1))] ?? [];
  return optional.includes(key) ? { parent: cursor, key } : undefined;
}

/** True when the path targets an existing, overridable leaf of `plan`. */
export function isResolvablePath(plan: PlannerPlan, path: string): boolean {
  return resolve(plan, path) !== undefined;
}

/** The primitive value at `path`, or undefined if the path is dangling, unsafe, or not a leaf. */
export function getPathValue(plan: PlannerPlan, path: string): OverrideValue | undefined {
  const resolved = resolve(plan, path);
  if (!resolved) return undefined;
  const value = resolved.parent[resolved.key];
  return isOverrideValue(value) ? value : undefined;
}

/** Decimal text compares numerically ('500' equals '500.00'); everything else strictly. */
function sameValue(a: OverrideValue | undefined, b: OverrideValue): boolean {
  if (a === b) return true;
  return decimalText(a) && decimalText(b) && new D(a).eq(b);
}

function updateScenario(plan: PlannerPlan, scenarioId: string, update: (scenario: Scenario) => Scenario): PlannerPlan {
  if (!plan.scenarios.some(scenario => scenario.id === scenarioId)) return plan;
  return { ...plan, scenarios: plan.scenarios.map(scenario => (scenario.id === scenarioId ? update(scenario) : scenario)) };
}

function withoutKey(overrides: Record<string, OverrideValue>, key: string): Record<string, OverrideValue> {
  // Object.fromEntries defines own properties, so a stray '__proto__' key can never touch a prototype.
  return Object.fromEntries(Object.entries(overrides).filter(([path]) => path !== key));
}

/**
 * US-801: store an override only when it differs from the base value; setting a value equal to
 * the base removes the key so later base edits flow into the scenario again. Unknown scenarios
 * and unresolvable or unsafe paths leave the plan unchanged.
 */
export function setScenarioOverride(plan: PlannerPlan, scenarioId: string, path: string, value: OverrideValue): PlannerPlan {
  if (!isOverrideValue(value) || !resolve(plan, path)) return plan;
  const base = getPathValue(plan, path);
  return updateScenario(plan, scenarioId, scenario => ({
    ...scenario,
    overrides: sameValue(base, value) ? withoutKey(scenario.overrides, path) : { ...withoutKey(scenario.overrides, path), [path]: value },
  }));
}

export function clearScenarioOverride(plan: PlannerPlan, scenarioId: string, path: string): PlannerPlan {
  return updateScenario(plan, scenarioId, scenario => ({ ...scenario, overrides: withoutKey(scenario.overrides, path) }));
}

/** Apply overrides to a deep copy; dangling and unsafe keys are ignored. */
export function applyOverrides(plan: PlannerPlan, overrides: Record<string, OverrideValue>): PlannerPlan {
  const copy = structuredClone(plan);
  for (const [path, value] of Object.entries(overrides)) {
    const resolved = resolve(copy, path);
    if (resolved && isOverrideValue(value)) resolved.parent[resolved.key] = value;
  }
  return copy;
}

export type OverrideKind = 'money' | 'percent' | 'rate' | 'integer' | 'date' | 'choice';
export interface OverridablePath { path: string; label: string; kind: OverrideKind; options?: string[] }

/** Every scenario-overridable field of the plan, with human labels, in form order. */
export function overridablePaths(plan: PlannerPlan): OverridablePath[] {
  const paths: OverridablePath[] = [
    { path: 'settings.startDate', label: 'School start date', kind: 'date' },
    { path: 'settings.graduationDate', label: 'Graduation date', kind: 'date' },
    { path: 'settings.graceMonths', label: 'Grace period (months)', kind: 'integer' },
    { path: 'postGradIncome.annualSalary', label: 'Starting annual salary', kind: 'money' },
    { path: 'postGradIncome.monthlyDebtBudget', label: 'Monthly debt budget', kind: 'money' },
    { path: 'repayment.extraMonthlyPayment', label: 'Extra monthly payment', kind: 'money' },
    { path: 'repayment.strategyId', label: 'Payoff strategy', kind: 'choice', options: listStrategies().map(entry => entry.id) },
  ];
  plan.schoolYears.forEach((year, index) => {
    const prefix = `schoolYears.${year.id}`;
    const yearLabel = `Year ${index + 1}`;
    paths.push({ path: `${prefix}.bufferPercent`, label: `${yearLabel}: borrowing buffer`, kind: 'percent' });
    for (const item of year.costItems) {
      paths.push({ path: `${prefix}.costItems.${item.id}.amount`, label: `${yearLabel}: ${item.label || item.category} cost`, kind: 'money' });
    }
    for (const resource of year.resources) {
      const base = `${prefix}.resources.${resource.id}`;
      const name = `${yearLabel}: ${resource.label || resource.type}`;
      if (resource.type === 'job' && resource.incomeMode === 'hourly') {
        paths.push({ path: `${base}.hourlyWage`, label: `${name} hourly wage`, kind: 'money' });
      } else {
        paths.push({ path: `${base}.amount`, label: `${name} amount`, kind: 'money' });
      }
      paths.push({ path: `${base}.unavailablePercent`, label: `${name} share unavailable for school`, kind: 'percent' });
    }
  });
  for (const loan of plan.loans) {
    const base = `loans.${loan.id}`;
    const name = `Loan: ${loan.name || loan.id}`;
    paths.push(
      { path: `${base}.principal`, label: `${name} amount`, kind: 'money' },
      { path: `${base}.annualRate`, label: `${name} interest rate`, kind: 'rate' },
      { path: `${base}.termMonths`, label: `${name} term (months)`, kind: 'integer' },
      { path: `${base}.disbursementDate`, label: `${name} disbursement date`, kind: 'date' },
    );
  }
  for (const event of plan.lifeEvents) {
    const base = `lifeEvents.${event.id}`;
    const name = `Event: ${event.name || event.id}`;
    paths.push(
      { path: `${base}.date`, label: `${name} date`, kind: 'date' },
      { path: `${base}.amount`, label: `${name} amount`, kind: 'money' },
    );
    if (event.type === 'income' || event.type === 'windfall') {
      paths.push({ path: `${base}.allocationPercent`, label: `${name} share applied to debt`, kind: 'percent' });
    }
  }
  return paths;
}

/**
 * Remove references to records that no longer exist: dangling scenario override keys, custom-order
 * entries for removed loans (and duplicates), and schoolYearId links to removed years.
 */
export function pruneDanglingReferences(plan: PlannerPlan): PlannerPlan {
  const loanIds = new Set(plan.loans.map(loan => loan.id));
  const yearIds = new Set(plan.schoolYears.map(year => year.id));
  const customOrder = [...new Set(plan.repayment.customOrder.filter(id => loanIds.has(id)))];
  const loans = plan.loans.map(loan => {
    if (loan.schoolYearId === undefined || yearIds.has(loan.schoolYearId)) return loan;
    const { schoolYearId: _removed, ...rest } = loan;
    return rest;
  });
  const lifeEvents = plan.lifeEvents.map(event => {
    if (event.schoolYearId === undefined || yearIds.has(event.schoolYearId)) return event;
    const { schoolYearId: _removed, ...rest } = event;
    return rest;
  });
  const pruned: PlannerPlan = { ...plan, loans, lifeEvents, repayment: { ...plan.repayment, customOrder } };
  return {
    ...pruned,
    scenarios: plan.scenarios.map(scenario => ({
      ...scenario,
      overrides: Object.fromEntries(Object.entries(scenario.overrides).filter(([path]) => resolve(pruned, path))),
    })),
  };
}
