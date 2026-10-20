/**
 * Shared full-application contract, schema version 4 (v0.2 requirements, section 13).
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
import type { Plan, Loan, SchoolYear, Projection, Money, ISODate, Result, FieldError } from './contracts';
export type { Money, ISODate, FieldError, Result, Projection } from './contracts';

export const SCHEMA_VERSION = 4 as const;

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
  /** Set when created from a year's gap; records the year for mismatch notices. */
  schoolYearId?: string;
  /**
   * The academic year this loan pays for: 'YYYY-YYYY' or 'unassigned'. Decides which school year's
   * borrowing (and federal annual limit) the loan counts toward; never affects dates or interest.
   * Absent only on loans saved before academic years existed (see loanAcademicYear).
   */
  academicYear?: string;
  /** Gap + buffer at creation time; never auto-updated (US-402). */
  gapAtCreation?: Money;
  /** Modeling assumption; default true. False keeps accrued interest as separate unpaid interest. */
  capitalizeInterest?: boolean;
  /** US-507: when this loan's required payments start. Absent = default for the loan type (see RequiredPaymentTerms). */
  requiredPayment?: RequiredPaymentTerms;
}

/**
 * US-507 per-loan required-payment terms. Required payments are contractual; they never move because the
 * user chooses to start voluntary payments earlier or later.
 * Repayment-period start R (first required payment = R + 1 month, the existing month convention):
 *   firstDueDate set                       → R = firstDueDate − 1 month (actual due date from the servicer/lender)
 *   federal (subsidized | unsubsidized)    → R = graduation + FEDERAL_GRACE_MONTHS (labeled assumption)
 *   private/other, inSchoolPayments true   → payments required from the month after disbursement
 *   private/other, graceMonths set         → R = graduation + graceMonths
 *   private/other, nothing set             → 'notConfigured': no required date is estimated (readiness asks);
 *                                            never a universal 6-month default
 */
export interface RequiredPaymentTerms {
  /** Actual first due date; overrides every estimate. Must not precede disbursement. */
  firstDueDate?: ISODate;
  /** private/other only: months after graduation before the first required payment period starts (0–60). */
  graceMonths?: number;
  /** private/other only: the lender requires payments while in school. */
  inSchoolPayments?: boolean;
}
/** Labeled assumption for federal Direct loans: repayment period starts six months after graduation (34 CFR 685.207). */
export const FEDERAL_GRACE_MONTHS = 6 as const;
/** Internal simulation safety cap (not a user setting). Reaching it means "no payoff found within the modeled limit", never forgiveness. */
export const SIMULATION_CAP_MONTHS = 1200 as const;

/** US-506: choose a budget and see payoff, or choose a payoff target and see the required budget. */
export type PayoffTarget =
  | { mode: 'budget' }
  | { mode: 'target'; kind: 'date'; date: ISODate }
  /** Months counted from the first voluntary payment (1–1200); the UI shows years and months. */
  | { mode: 'target'; kind: 'duration'; months: number };
/** US-507: when voluntary payments start. 'afterGraduation' follows graduation edits (months 0–60). */
export type VoluntaryStart = { kind: 'afterGraduation'; months: number } | { kind: 'date'; date: ISODate };

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

/** Any id registered in src/engine/strategies/registry.ts (US-605: new strategies need no contract change). */
export type StrategyId = string;
/**
 * v4: settings.graceMonths and repayment.maxMonths are gone (per-loan RequiredPaymentTerms, voluntaryStart and
 * SIMULATION_CAP_MONTHS replace them; see the v3 → v4 migration in src/data/storage.ts).
 * postGradIncome keeps its v3 paths; the Repayment Plan dashboard is its only editor (US-501).
 */
export interface PlannerPlan extends Omit<Plan, 'settings' | 'repayment'> {
  settings: { startDate: ISODate; graduationDate: ISODate; currency: 'USD' };
  schoolYears: PlannerYear[];
  loans: PlannerLoan[];
  postGradIncome: {
    /** Gross annual salary. Never treated as money available for debt. */
    annualSalary: Money;
    /** The user's chosen monthly debt budget. Never changed by the target solver. */
    monthlyDebtBudget: Money;
    raiseAllocationPercent: string;
    /** Optional, user-entered (no tax inference). */
    monthlyTakeHome?: Money;
    /** Optional, user-entered monthly living expenses, for affordability context only. */
    monthlyExpenses?: Money;
  };
  repayment: {
    strategyId: StrategyId;
    /** Legacy field with no UI; imported plans may carry it. */
    extraMonthlyPayment: Money;
    customOrder: string[];
    payoffTarget: PayoffTarget;
    voluntaryStart: VoluntaryStart;
    /** Stored federal settings, kept but unused in this release (US-905). */
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
/** US-1006: borrowed = loan principal allocated to this academic year; remaining = max(0, gap − borrowed). */
export interface YearSummary { yearId: string; costs: Money; resources: Money; gap: Money; surplus: Money; bufferedGap: Money; borrowed: Money; remaining: Money; mismatchLoanIds: string[] }

/** US-507: estimated (or actual) required-payment timing for one loan. */
export interface LoanPaymentTiming {
  loanId: string;
  /** null when basis is 'notConfigured'. */
  repaymentPeriodStart: ISODate | null;
  firstRequiredPaymentDate: ISODate | null;
  basis: 'actualDueDate' | 'federalDefault' | 'loanGrace' | 'inSchool' | 'notConfigured';
  /** Plain-language assumption, e.g. "Estimated: federal Direct loans, 6 months after graduation". */
  assumption: string | null;
}
export interface MissedObligationWarning {
  code: 'MISSED_REQUIRED_PAYMENT'; loanId: string; firstMissedDate: ISODate; missedPayments: number; message: string;
}

/** US-506 target solver result (src/engine/targetPayment.ts, run off the main thread). */
export type TargetPaymentResult =
  | { status: 'feasible'; requiredMonthlyBudget: Money; chosenMonthlyBudget: Money; /** required − chosen */ difference: Money;
      targetDate: ISODate; verifiedDebtFreeDate: ISODate; totalInterest: Money;
      /** D1: true when the required minimums alone reach the target (the answer is their sum). */
      limitedByMinimum: boolean; iterations: number }
  | { status: 'infeasible'; reason: 'targetBeforeFirstPayment' | 'beyondSimulationCap' | 'noBudgetReachesTarget'; message: string }
  | { status: 'invalid'; reason: 'pastTarget' | 'missingInputs' | 'invalidTarget'; errors: FieldError[]; message: string };
export interface TimelineEntry { id: string; date: ISODate; label: string; type: 'school' | 'graduation' | 'repayment' | 'event' | 'payoff' }
export interface Comparison { id: string; name: string; projection: Projection; firstPayoffMonth: number | null; interestDifference: Money | null; monthsDifference: number | null }
/** Positive monthsSaved/interestSaved mean the event shortens payoff / saves interest. */
export interface EventImpact { eventId: string; monthsSaved: number | null; interestSaved: Money | null }

/** Core outputs: must stay fast (< 100 ms for the US-701 reference plan) — computed on every edit. */
export interface PlannerProjection {
  repayment: Projection; years: YearSummary[]; minimumTotal: Money; paymentShortfall: Money;
  timeline: TimelineEntry[]; notices: string[];
  /** US-507 */
  paymentTiming: LoanPaymentTiming[]; firstVoluntaryPaymentDate: ISODate; missedObligations: MissedObligationWarning[];
}
/** Secondary outputs: computed off the main thread (src/ui/derived Web Worker) so typing stays responsive; the core projection uses a deferred plan value. */
export interface PlannerComparisons { strategyComparisons: Comparison[]; scenarioComparisons: Comparison[]; eventImpacts: EventImpact[]; scenarioRange: { earliest: ISODate | null; latest: ISODate | null } }
/** Worker output for US-506: null when payoffTarget.mode is 'budget'. `today` is supplied by the caller (UTC date). */
export type TargetPaymentOutput = TargetPaymentResult | null;
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
export interface LoadResult { document: PlannerDocument | null; notice: string | null; /** true when stored data exists but is unreadable; autosave must not overwrite it until the user imports, resets, or deletes. */ preservedUnreadable: boolean; /** Automatic, user-visible repairs applied while loading older data (e.g. late disbursements). */ repairs?: string[] }
export interface SaveResult { ok: boolean; notice: string | null }
/**
 * src/data/validation.ts:  validatePlannerPlan(unknown): Result<PlannerPlan>  (FieldError.path uses field paths)
 *                          validateDocument(unknown): Result<PlannerDocument>
 * src/data/storage.ts:     STORAGE_KEY; loadDocument(storage?); saveDocument(doc, storage?); exportDocument(doc): string;
 *                          importDocument(text): Result<PlannerDocument> (migrates v2 → v3 → v4); deleteDocument(storage?)
 *                          migrateToCurrent(envelopeDocument, schemaVersion): unknown — pure, shared with server/ and the workbook
 * src/data/parse.ts (data owner): parseMoneyInput / parsePercentInput / parseRatePercentInput / parseIntegerInput /
 *                          parseDateInput / parseTextInput — text → Result-like ParseResult (see file).
 */

/**
 * State hook. The UI consumes only PlannerStore, so PlannerApp works with the local store (component tests,
 * src/state/usePlannerDocument.ts) and the server store (src/state/useServerPlannerDocument.ts, signed-in app).
 * 'saved' means saved to the server for the server store; a local cache is never reported as a server save.
 */
export type SaveState = 'saved' | 'pending' | 'saving' | 'offline' | 'conflict' | 'error' | 'paused' | 'unavailable';
export type SaveStatus = { state: SaveState; message: string | null; savedAt: string | null; revision?: number; scope?: 'browser' | 'account' };
export interface UndoEntry { id: string; label: string; at: string }
/** US-904: session-only undo history. Never expires on a timer or on later edits; LIFO; capped (50). */
export interface UndoHistory {
  /** Oldest first. */
  entries: readonly UndoEntry[];
  canUndo: boolean;
  /** Restores the newest entry's snapshot through the normal commit path (so it is saved like any edit). */
  undo(): void;
  clear(): void;
}
export interface PlannerStore {
  document: PlannerDocument;
  /** Apply a pure update. The result is validated; invalid plans are rejected and the returned errors
   * are field-path errors (the stored plan is unchanged). Every committed edit adds an undo entry
   * (label from options.undoLabel, a pending markUndoable label, or "Edit"). Unlabelled edits, and labelled
   * ones with options.coalesce, merge with the previous entry of the same label within a short burst
   * (typing in a field commits on each keystroke). */
  updatePlan(update: (plan: PlannerPlan) => PlannerPlan, options?: { undoLabel?: string; coalesce?: boolean }): Result<PlannerPlan>;
  dismissDisclaimer(): void;
  saveStatus: SaveStatus;
  history: UndoHistory;
  /** Compat: the newest undo entry, or null. */
  undo: { label: string; apply(): void } | null;
  /** Compat: label for the next committed edit's undo entry. */
  markUndoable(label: string): void;
  /** JSON import; replaces the plan and is undoable ("Import"). */
  importText(text: string): Result<PlannerDocument>;
  /** Replace the whole document (Excel import commit); undoable with `label`. */
  replaceDocument(document: PlannerDocument, label: string): void;
  exportJson(): Result<string>;
  /** Caller must have obtained explicit user confirmation. Not undoable. */
  deleteAllData(): SaveResult | Promise<SaveResult>;
  /** Server store only. */
  retrySave?(): void;
  resolveConflict?(choice: 'reloadServer' | 'keepMine'): void;
}
