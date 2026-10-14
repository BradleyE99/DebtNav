/**
 * Shared full-application contract, schema version 3.
 * Owner: lead. Agents request changes through the lead; do not edit directly.
 *
 * Conventions
 * - Money and decimal values are decimal text ('1234.56'), never JS numbers. Rates are annual
 *   fractions ('0.065' = 6.5%). Percent fields are percent text ('5' = 5%).
 * - Dates are strict ISO 'YYYY-MM-DD' (UTC calendar arithmetic) — see engine/dates.ts.
 * - Every record has a stable opaque `id` (/^[A-Za-z0-9_-]{1,100}$/). IDs never encode dates or
 *   positions. School years are matched by ordinal position when dates change, so editing the
 *   start/graduation date keeps the data of every year that still exists.
 * - A "field path" is a dot path through object keys, using record IDs (never array indexes) for
 *   arrays: 'settings.graceMonths', 'schoolYears.<yearId>.costItems.<itemId>.amount',
 *   'loans.<loanId>.annualRate', 'lifeEvents.<eventId>.date'. The same path format is used for
 *   (1) FieldError.path from validation, (2) scenario override keys, and (3) DOM input ids in the UI.
 */
import type { Plan, Loan, SchoolYear, Projection, Money, ISODate, Result } from './contracts';
export type { Money, ISODate, FieldError, Result, Projection } from './contracts';

export const SCHEMA_VERSION = 3 as const;

export type CostCategory = 'tuition' | 'fees' | 'housing' | 'food' | 'books' | 'transportation' | 'personal' | 'other';
/** 'annual' items count once for the year; fall/spring/summer are semester entries summed into the year. */
export type CostPeriod = 'annual' | 'fall' | 'spring' | 'summer';
export interface CostItem { id: string; category: CostCategory; label: string; amount: Money; semester: CostPeriod }

export type ResourceType = 'grant' | 'scholarship' | 'job' | 'savings' | 'family' | 'other';
/** Job resources with incomeMode 'hourly' use wage × hours × weeks; all others use `amount`.
 * unavailablePercent (0–100) is excluded from resources for every resource type. */
export interface Resource {
  id: string; type: ResourceType; label: string; amount: Money;
  incomeMode: 'fixed' | 'hourly'; hourlyWage: Money; hoursPerWeek: string; weeksWorked: string;
  unavailablePercent: string;
}
/** `id` is stable and opaque. startDate/endDate are derived by reconcileSchoolYears. */
export interface PlannerYear extends SchoolYear { costItems: CostItem[]; resources: Resource[]; bufferPercent: string }

export interface PlannerLoan extends Loan {
  /** Set when created from a year's gap; used for year attribution and mismatch notices. */
  schoolYearId?: string;
  /** Gap + buffer at creation time; never auto-updated (US-402). */
  gapAtCreation?: Money;
  /** Modeling assumption; default true. False keeps accrued interest as separate unpaid interest. */
  capitalizeInterest?: boolean;
}

/**
 * income:   new annual salary from `date`; budget changes by (new − previous salary)/12 × allocationPercent.
 *           Amount 0 models "job ends".
 * windfall: lump sum × allocationPercent applied to debt in the event month (or month 1 if before
 *           repayment). recurrence 'yearly' repeats each anniversary until recurrenceEndDate/payoff.
 * expense / aid: change the gap of `schoolYearId` (or the school year containing `date`).
 */
export type LifeEventType = 'income' | 'windfall' | 'expense' | 'aid';
export interface LifeEvent {
  id: string; name: string; date: ISODate; type: LifeEventType; amount: Money; allocationPercent: string;
  schoolYearId?: string;
  recurrence?: 'once' | 'yearly';
  recurrenceEndDate?: ISODate;
}

/** Overrides keyed by field path (see header). Only values that differ from the base are stored;
 * a key whose target no longer exists is pruned by the store on every edit (pruneDanglingReferences) and rejected by validation on import. */
export type OverrideValue = string | number | boolean;
export interface Scenario { id: string; name: string; overrides: Record<string, OverrideValue> }

export type StrategyId = 'avalanche' | 'snowball' | 'custom';
export interface PlannerPlan extends Plan {
  schoolYears: PlannerYear[];
  loans: PlannerLoan[];
  postGradIncome: { annualSalary: Money; monthlyDebtBudget: Money; raiseAllocationPercent: string };
  repayment: Plan['repayment'] & {
    strategyId: StrategyId;
    customOrder: string[];
    mode: 'standard' | 'federal';
    federalPlan: 'ibr' | 'rap';
    familySize: number;
    annualAGI: Money;
  };
  lifeEvents: LifeEvent[];
  scenarios: Scenario[];
  borrower: { dependency: 'dependent' | 'independent'; level: 'undergraduate' | 'graduate'; priorFederalDebt: Money };
}

// ---------------------------------------------------------------- Projection outputs (never stored)
export interface YearSummary { yearId: string; costs: Money; resources: Money; gap: Money; surplus: Money; bufferedGap: Money; borrowed: Money; mismatchLoanIds: string[] }
export interface TimelineEntry { id: string; date: ISODate; label: string; type: 'school' | 'graduation' | 'repayment' | 'event' | 'payoff' }
export interface Comparison { id: string; name: string; projection: Projection; firstPayoffMonth: number | null; interestDifference: Money | null; monthsDifference: number | null }
/** Positive monthsSaved/interestSaved mean the event shortens payoff / saves interest. */
export interface EventImpact { eventId: string; monthsSaved: number | null; interestSaved: Money | null }

/** Core outputs: must stay fast (< 100 ms for the US-701 reference plan) — computed on every edit. */
export interface PlannerProjection {
  repayment: Projection; years: YearSummary[]; minimumTotal: Money; paymentShortfall: Money;
  timeline: TimelineEntry[]; notices: string[];
}
/** Secondary outputs: may be computed from a deferred plan value so typing stays responsive. */
export interface PlannerComparisons { strategyComparisons: Comparison[]; scenarioComparisons: Comparison[]; eventImpacts: EventImpact[]; scenarioRange: { earliest: ISODate | null; latest: ISODate | null } }
export type PlannerResult = Result<PlannerProjection>;

/**
 * Engine API (src/engine/planner.ts, all pure, never mutate inputs):
 *   createDefaultPlan(): PlannerPlan
 *   reconcileSchoolYears(plan): PlannerPlan          — ordinal matching; keeps ids/data of surviving years
 *   calculatePlannerProjection(plan): PlannerResult  — core only
 *   calculatePlannerComparisons(plan): Result<PlannerComparisons>
 *   applyScenario(plan, scenario): PlannerPlan
 *   copyYearCosts(plan, fromYearId, toYearId, increasePercent): PlannerPlan
 *   createLoanFromGap(plan, yearId, newId): PlannerLoan   — pre-filled from gap + buffer and year start
 * Engine path helpers (src/engine/paths.ts):
 *   getPathValue(plan, path): OverrideValue | undefined
 *   setScenarioOverride(plan, scenarioId, path, value): PlannerPlan — removes the key if value equals base
 *   clearScenarioOverride(plan, scenarioId, path): PlannerPlan
 *   overridablePaths(plan): { path: string; label: string; kind: 'money'|'percent'|'rate'|'integer'|'date'|'choice'; options?: string[] }[]
 *   pruneDanglingReferences(plan): PlannerPlan — removes overrides/customOrder/schoolYearId pointing to removed records
 */

// ---------------------------------------------------------------- Persistence (src/data)
/** Persisted document. Unfinished field text is NOT persisted (it lives in field-local UI state). */
export interface PlannerDocument { plan: PlannerPlan; disclaimerDismissed: boolean }
export interface SavedEnvelope { app: 'debtnav'; schemaVersion: typeof SCHEMA_VERSION; savedAt: string; document: PlannerDocument }
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface LoadResult { document: PlannerDocument | null; notice: string | null; /** true when stored data exists but is unreadable; autosave must not overwrite it until the user imports, resets, or deletes. */ preservedUnreadable: boolean }
export interface SaveResult { ok: boolean; notice: string | null }
/**
 * src/data/validation.ts:  validatePlannerPlan(unknown): Result<PlannerPlan>  (FieldError.path uses field paths)
 *                          validateDocument(unknown): Result<PlannerDocument>
 * src/data/storage.ts:     STORAGE_KEY; loadDocument(storage?); saveDocument(doc, storage?); exportDocument(doc): string;
 *                          importDocument(text): Result<PlannerDocument> (migrates v2 → v3); deleteDocument(storage?)
 * src/data/parse.ts (data owner): parseMoneyInput / parsePercentInput / parseRatePercentInput / parseIntegerInput /
 *                          parseDateInput / parseTextInput — text → Result-like ParseResult (see file).
 */

/** State hook (src/state/usePlannerDocument.ts, data agent). The UI consumes only this. */
export type SaveStatus = { state: 'saved' | 'pending' | 'unavailable' | 'error' | 'paused'; message: string | null; savedAt: string | null };
export interface PlannerStore {
  document: PlannerDocument;
  /** Apply a pure update. The result is validated; invalid plans are rejected and the returned errors
   * are field-path errors (the stored plan is unchanged). Saving is debounced (≤ 300 ms) and flushed
   * on pagehide/visibilitychange. */
  updatePlan(update: (plan: PlannerPlan) => PlannerPlan): Result<PlannerPlan>;
  dismissDisclaimer(): void;
  saveStatus: SaveStatus;
  /** One-level undo for destructive edits (record removal, school-year removal, import). */
  undo: { label: string; apply(): void } | null;
  markUndoable(label: string): void;
  importText(text: string): Result<PlannerDocument>;
  exportJson(): Result<string>;
  /** Caller must have obtained explicit user confirmation. Removes only DebtNav's key. */
  deleteAllData(): SaveResult;
}
