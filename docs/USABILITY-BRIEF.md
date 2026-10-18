# DebtNav usability brief: Results readiness and completion flow

Author: researcher (read-only review), 2026-10-16. Based on the working tree, including the user's uncommitted
changes (sidebar dashboards, `IncomeSection.tsx`, `navigation.ts`, compact records). Line numbers refer to that tree.

## 1. Relevant files and responsibilities

| Area | File | Responsibility |
|---|---|---|
| Contracts | `src/engine/contracts.ts`, `src/engine/planner-contracts.ts` | `Plan`, `Projection` (`status`, `debtFreeDate`, `totalInterestPaid`), `PlannerPlan`, `YearSummary`, `PlannerStore`. Field paths are also DOM ids (planner-contracts.ts:131-138). |
| Engine | `src/engine/planner.ts` | `createDefaultPlan` (:15-30), `summarizeYear` gap math (:93-114), `createLoanFromGap` (:123-135), `validatePlannerInputs` (:139-174), `budgetSchedule` (:203-252), `calculatePlannerOutputs` (:351-392), `calculatePlannerComparisons` (:409-479). |
| Engine | `src/engine/projection.ts` | Validation, accrual, minimums, repayment loop, `status`, `debtFreeDate` (:234). |
| Policy | `src/policy/federal.ts` | Loan-limit notices, RAP/IBR/Tiered estimates (use `repayment.annualAGI`, `familySize`, `borrower.*`). |
| Validation | `src/data/validation.ts` | `validatePlannerPlan`; every store update is validated, so the **stored plan is always valid** (usePlannerDocument.ts:145-165). |
| Parse | `src/data/parse.ts` | Text → value for fields; `formatCurrency(null)` → "Not available" (:121). |
| State | `src/state/usePlannerDocument.ts` | Store, debounced autosave, undo, import repair. |
| Context | `src/ui/PlannerContext.tsx` | `projection` (deferred, :41-42), `projectionErrors`, `repaymentUnavailable`, `comparisons`/`federal` from worker (:43-56). |
| Shell/nav | `src/ui/PlannerApp.tsx`, `src/ui/nav/{AppShell,Sidebar,navItems,navigation}.ts(x)` | One dashboard mounted at a time (PlannerApp.tsx:117-130). `navigateDashboard(dashboard, fieldId?)` (navigation.ts:2-6). Reveal routing by field-path scope (PlannerApp.tsx:63-70). Heading focus on navigation unless a field was requested (:67-74). |
| Reveal | `src/ui/reveal.ts` | `revealField(id)`: dispatches reveal event, retries focus 8×30 ms, opens ancestor `<details>`, skips `[hidden]` (:4-27). |
| Fields | `src/ui/fields/{fields,FieldShell,useDraftField,fieldStatus}.tsx` | Draft text kept locally; invalid text never reaches the store; `useFieldStatus` reports invalid drafts to a container. |
| Results | `src/ui/results/ResultsSection.tsx`, `KeyFigures.tsx`, `AmortizationSchedule.tsx`, `BalanceChart.tsx`, `comparison.ts` | Results views; "At a glance" card used on Overview. |
| Sections | `src/ui/sections/*.tsx` | Income (`IncomeSection`), Timeline (`SetupSection`), Costs (`SchoolYearsSection`), Loans, Repayment, Events, Scenarios, Federal, Data. |

Dashboard ids (navItems.ts:13-25): `overview`, `income`, `setup` (label "Timeline"), `school` (label "Costs"),
`loans`, `repayment`, `events`, `scenarios`, `federal`, `results`, `data`. Section heading ids are `<dashboard>-heading`
except Costs = `school-heading`, Timeline = `setup-heading`.

## 2. Results → required inputs

"Required" means the result is meaningless without it. Defaults come from `createDefaultPlan` (planner.ts:15-30):
start 2026-08-24, graduation 2030-05-20, grace 6, budget $400/mo, salary $55,000, raise share 50%, AGI $55,000,
family 1, strategy avalanche, horizon 360, no loans, no costs, one school year per academic year.

| Result (where shown) | Required | Optional / defaulted |
|---|---|---|
| Per-year cost, resources, gap, surplus, gap+buffer (Costs gap box SchoolYearsSection.tsx:117-127; Results "School years" view ResultsSection.tsx:143-172; Income "Borrowing gap" IncomeSection.tsx:70) | Timeline dates; ≥1 cost item (or expense event) in that year | Resources (none = all cost is gap), buffer (0%), aid/expense events |
| Total borrowing gap (KeyFigures.tsx:24) | Costs in at least one year | as above |
| Create loan from gap (SchoolYearsSection.tsx:128) | That year's gap + buffer > 0 | rate/term defaults (planner.ts:116-128) |
| Total borrowed (KeyFigures.tsx:25, Results Summary :120, Loans :102) | ≥1 loan with principal > 0 | — |
| Loan details: balance at repayment, accrued/capitalized interest, minimum payment (Results "Loan details" :174-207; loan card) | Loan principal, rate, disbursement date, term; Timeline (graduation + grace) | capitalize (default on), pay-in-school (off), fixed payment (blank) |
| Minimum payments total / shortfall (KeyFigures.tsx:26-27; Repayment :236-244) | Loans as above | Budget only for shortfall |
| Debt-free date, total interest, payment count (KeyFigures.tsx:18-19; Summary :101-141) | ≥1 loan with principal > 0 **and** a monthly loan budget > 0 (or later income/windfall events that make it positive) | Strategy (avalanche), horizon (360), life events, salary (only as the baseline for income events) |
| Payment schedule (AmortizationSchedule.tsx) | Same as debt-free date | — |
| Balance chart (BalanceChart.tsx) | Same + comparisons from worker | — |
| Strategy comparison (:209-239) | Same; ≥2 loans to be informative | — |
| Scenario comparison (:249-292) | Same + ≥1 scenario | — |
| Event impacts (EventsSection.tsx:14-30) | Same + ≥1 event | — |
| Timeline (:294-314) | Timeline dates only | Loan payoffs appear only when projected |
| Federal limit notices (FederalSection.tsx:35-70) | ≥1 federal (sub/unsub) loan | dependency, level, prior debt (defaults) |
| Federal plan comparison RAP/IBR/Tiered (FederalSection.tsx:72+) | ≥1 federal loan with principal > 0 | AGI ($55,000 default!), family size (1) |
| School earnings totals (IncomeSection.tsx:67-71) | A job resource in that year with wage×hours×weeks or fixed amount > 0 | available % (100) |
| Income allocation (budget vs salary) | Monthly budget (used by engine, planner.ts:207); salary is used **only** as the baseline for `income` events (planner.ts:210-216) | raise share (50%) seeds new income events only |

School costs are never needed for repayment; repayment never needs costs. The existing-loan-only path needs: loans +
budget + timeline (graduation/grace decide when repayment starts).

## 3. Current handling of missing / invalid / zero / default values

Missing and zero look the same in the data: every new record is created with `'0.00'` (add cost :89, add resource
:96-98, add earnings IncomeSection.tsx:46-48 with wage `0.00`, add loan LoansSection.tsx:86 principal `0.00`, windfall
EventsSection.tsx:45 amount `0.00`). Blank text in a field is rejected as a draft and never stored. So the only
"invalid" states that reach Results are engine-level (`repaymentUnavailable`, scenario failures). Invalid drafts live
in field-local state and are dropped when their dashboard unmounts (only one dashboard is mounted).

Misleading output (verified against code; engine behavior pinned by acceptance.test.ts:118-125):

1. **Empty plan (default document) shows a debt-free date.** No loans → loop never runs → `status: 'paidOff'`,
   `debtFreeDate = repaymentStartDate` (projection.ts:234). KeyFigures (on Overview) shows "Debt-free Nov 2030",
   "Total interest $0.00", "Total borrowing gap $0.00", "Total borrowed $0.00", "Minimum payments $0.00/mo".
   Results Summary shows the same date with detail "0 payments from Dec 2030"; strategy table says "Lowest modeled
   interest" for every strategy; Repayment dashboard metrics "$0.00"; Scenarios metric "Base debt-free date Nov 2030".
2. **All loans at $0 principal** (e.g. just clicked "Add loan") → same as 1 (active list empty, projection.ts:126).
3. **No cost items** → every year gap `$0.00`, "Total borrowing gap $0.00", and "Create loan from gap" is enabled and
   creates a `$0.00` loan (SchoolYearsSection.tsx:128 only checks `summary`).
4. **A year with no costs while others have costs** → that year reads `$0.00` gap, indistinguishable from fully funded.
5. **Earnings added with wage $0.00** → "Annual earnings $0.00 / Available $0.00", no prompt to finish.
6. **Budget $0** with loans → `notAmortizing`; Summary shows "No debt-free date" + warning (OK), but KeyFigures shows
   only "No debt-free date" and "Total interest Not available" with no reason or link.
7. **Budget never entered** → the $400 default silently drives every repayment result; nothing marks it as an
   assumption. Same for AGI $55,000 in federal estimates and salary $55,000 as the raise baseline.
8. **Budget below minimums** → proportional underpayment; warning only on Repayment dashboard and KeyFigures; Results
   Summary does not mention the shortfall.
9. `repayment.extraMonthlyPayment` is still added to the budget (planner.ts:207, 372) but has no field anywhere in the
   UI after the user's RepaymentSection change (an imported/legacy plan can carry a hidden extra amount).
10. Fixed monthly payment per loan ("optional", LoansSection.tsx:208) is capped/scaled by the total budget; if
    budget < Σ fixed payments they are cut proportionally — not explained.

Valid zeros that must NOT be flagged: 0% rate, $0 resources/aid, 0% buffer, 0 grace, $0 prior federal debt, $0 AGI,
$0 amount on an `income` event ("job ends"), a year whose costs are fully covered (gap $0 with costs > 0).

## 4. Usability problems and root causes

| Problem | Root cause |
|---|---|
| Results never says what is missing; only engine errors are listed (ResultsSection.tsx:34-48) | No completeness model exists; only validity (store) and projectability (engine) are modeled |
| `$0` / dates on an empty plan | Engine correctly projects "nothing owed"; UI renders raw outputs without prerequisites |
| User cannot find where earnings vs. budget go | Budget moved to Income dashboard; Repayment shows a read-only copy (RepaymentSection.tsx:17-20); Overview hint only (PlannerApp.tsx:146) |
| Defaults look like user data | Defaults are written into the plan; no "confirmed" flag |
| Results views shrink to School/Timeline when repayment is unavailable (ResultsSection.tsx:26-29) | Unavailable views disappear instead of explaining why |
| "Go to the field" only for engine errors | `ProjectionErrorItem` (:80-99) is the only link mechanism; no "add a record" targets |
| Add-buttons hidden in collapsed `<details>` (Costs editor panels :139, :177) | Collapsed by default; empty years show no call to action outside them |
| Existing-borrower flow is indirect | Must enter school dates; repayment start = graduation + grace; disbursement must be ≤ repayment start |
| UI duplicates money logic | `resourceValue` in SchoolYearsSection.tsx:23-32 and `annualEarnings` in IncomeSection.tsx:14-18 duplicate engine `resourceValue` (planner.ts:86-91); KeyFigures/DashboardSummary sum gaps/principals in UI |

## 5. Proposed Results layout and completion flow

Top of Results (and a compact version in Overview's KeyFigures):

1. **Status line** (`role="status"`, polite): "3 of 5 key results ready · 2 items needed".
2. **"Your plan needs…" checklist** (only when there are `missing`/`invalid` items; `warning`/`assumption` in a
   collapsible "Check these assumptions" list below it). Each row: plain-language label, *why* ("Needed for your
   debt-free date and total interest"), and one button `actionLabel` ("Add a loan", "Enter your monthly loan budget",
   "Fix disbursement date"). Ordered: invalid → missing → warning → assumption, then by flow order
   (Timeline, Costs, Income, Loans, Repayment). Updates live from the plan (no Calculate button).
3. **Key figures grid**: every figure from §2 rendered from `results[key]`:
   - `complete` → value; `estimate` → value + "Estimate: uses default $400/mo budget" chip;
   - `incomplete` → muted placeholder "Needs a loan" + link (never `$0.00` or a date);
   - `invalid` → "Fix 1 value" + link; `nonPayoff` → "Not paid off" with reason (below interest / horizon) and
     "Increase budget" link; `notApplicable` → hidden or "No federal loans".
4. **Explore results** selector: keep all views listed; blocked views render a short "needs" card with the same
   actions instead of disappearing.

State taxonomy (per result):

| State | Meaning | Display |
|---|---|---|
| `complete` | All required inputs present, projection pays off | Value |
| `estimate` | Complete but depends on an `assumption` item (untouched default) | Value + estimate chip |
| `incomplete` | A `missing` item blocks it | Placeholder + action, never $0/date |
| `invalid` | An `invalid` item (engine error, scenario failure, or reported invalid draft) blocks it | Placeholder + fix link |
| `nonPayoff` | Inputs complete but `status` is `notAmortizing` or `horizonExceeded` | "No debt-free date" + reason + action |
| `notApplicable` | Not relevant to this plan (no scenarios, no federal loans, no events) | Hidden or neutral note |

Completion flow: action → `goToTarget(target)` → dashboard opens, container expands, field focused → user types →
store commits → readiness recomputes → user returns via sidebar "Results" (optionally a "Back to Results" link in the
dashboard summary when arriving from a readiness action).

## 6. Shared interface: `src/data/readiness.ts` (pure, no React, no DOM)

```ts
import type { FieldError, PlannerPlan } from '../engine/planner-contracts';
import type { PlannerOutputs, PlannerComparisonsDetailed } from '../engine/planner';

export type DashboardId = 'overview' | 'income' | 'setup' | 'school' | 'loans' | 'repayment'
  | 'events' | 'scenarios' | 'federal' | 'results' | 'data';

export type ResultKey =
  | 'borrowingGap'        // per-year costs/resources/gap + total gap
  | 'totalBorrowed'
  | 'loanDetails'         // balances at repayment, accrued/capitalized interest
  | 'minimumPayments'     // Σ minimums + shortfall
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
  id: string;                 // stable, e.g. 'loans.none', 'loan.<loanId>.zeroPrincipal', 'budget.zero'
  severity: ReadinessSeverity;
  label: string;              // "Add at least one loan"
  why: string;                // "Needed for your debt-free date, total interest and payment schedule."
  blocks: ResultKey[];        // missing/invalid: results it blocks; warning/assumption: results it qualifies
  target: ReadinessTarget;
  actionLabel: string;        // "Add a loan" / "Edit monthly budget"
}

export interface ResultStatus {
  state: ResultState;
  itemIds: string[];          // ReadinessItem ids that explain the state (empty when complete)
  summary?: string;           // short placeholder text, e.g. "Needs a loan", "Not paid off within 360 months"
}

export interface PlanReadiness {
  items: ReadinessItem[];     // sorted: invalid, missing, warning, assumption; then flow order
  results: Record<ResultKey, ResultStatus>;
  counts: Record<ReadinessSeverity, number>;
  byDashboard: Partial<Record<DashboardId, number>>; // missing+invalid per dashboard (optional sidebar badges)
}

export interface ReadinessContext {
  outputs?: PlannerOutputs | null;                    // usePlanner().projection
  projectionErrors?: readonly FieldError[];           // usePlanner().projectionErrors
  comparisons?: PlannerComparisonsDetailed | null;    // for scenario failures
  invalidFieldIds?: readonly string[];                // optional, from a FieldStatus registry
  defaults?: PlannerPlan;                             // defaults to createDefaultPlan(); used for 'assumption'
}

export function getPlanReadiness(plan: PlannerPlan, context?: ReadinessContext): PlanReadiness;
```

Notes: take `plan` (not the whole document) — the document only adds `disclaimerDismissed`. Use engine outputs for
`status`/`paymentShortfall` and engine `resourceValue`; do not recompute money in readiness except simple
"is this decimal > 0" checks with `D`. No `Date.now()` inside (pass `today` later if a "repayment in the past" rule is
wanted).

### Rules (initial set; math to confirm)

| id | Condition | Severity | Blocks / qualifies | Target |
|---|---|---|---|---|
| `loans.none` | `plan.loans.length === 0` | missing | totalBorrowed, loanDetails, minimumPayments, debtFreeDate, totalInterest, paymentSchedule, balanceChart, strategyComparison, scenarioComparison, eventImpacts, federalPlans | `loans` / `loans-add` ("Add a loan"); if any year's bufferedGap > 0 the label may say "or create one from your Year N gap" |
| `loans.allZero` | loans exist, every principal = 0 | missing | same as above | `loans` / `loans.<firstId>.principal` |
| `loan.<id>.zeroPrincipal` | some (not all) loans at 0 | warning | totalBorrowed | `loans.<id>.principal` |
| `budget.zero` | loans with principal > 0, `baseMonthlyBudget(plan) == 0` (engine export, planner.ts) **and** `outputs.repayment.status !== 'paidOff'` (math: do not infer from event amounts; an income event's delta can be ≤ 0) | missing | debtFreeDate, totalInterest, paymentSchedule, balanceChart, strategyComparison, scenarioComparison, eventImpacts | `income` / `postGradIncome.monthlyDebtBudget` |
| `budget.default` | budget equals the default ($400.00) and loans exist | assumption | debtFreeDate, totalInterest, paymentSchedule, … → `estimate` | same field ("Confirm your monthly budget") |
| `budget.legacyExtra` | `repayment.extraMonthlyPayment > 0` (no UI field; kept, not migrated — math decision) | warning | debtFreeDate, totalInterest | `income` / `postGradIncome.monthlyDebtBudget` ("Your budget includes a hidden extra $X/mo from an imported plan") |
| `budget.shortfall` | `outputs.paymentShortfall > 0` | warning | minimumPayments, debtFreeDate | same field |
| `repayment.nonPayoff` | `outputs.repayment.status !== 'paidOff'` (and not caused by a missing item) | warning | debtFreeDate, totalInterest, paymentSchedule → `nonPayoff` | budget field; for `horizonExceeded` alt `repayment` / `repayment.maxMonths` |
| `costs.none` | no cost items in any year and no expense events | missing | borrowingGap | `school` / `schoolYears.<firstYearId>.costItems-add` ("Add school costs") |
| `costs.year.<yearId>.empty` | other years have costs, this one has none | warning | borrowingGap (row shows "No costs entered") | `schoolYears.<yearId>.costItems-add` |
| `cost.<itemId>.zero` | cost amount 0 | warning | borrowingGap | `schoolYears.<y>.costItems.<c>.amount` |
| `earnings.<resId>.zero` | job resource contributes 0 (hourly wage or hours/weeks 0; fixed amount 0) | warning | schoolEarnings, borrowingGap | `income` / `…resources.<r>.hourlyWage` or `.amount` |
| `resource.<resId>.zero` | non-job resource amount 0 | warning | borrowingGap | `school` / `…resources.<r>.amount` |
| `salary.baseline` | an income event exists and salary is 0 or default | warning (0) / assumption (default) | eventImpacts, debtFreeDate | `income` / `postGradIncome.annualSalary` |
| `federal.agiDefault` | federal loans exist and AGI equals default | assumption | federalPlans | `federal` / `repayment.annualAGI` |
| `engine.<path>` | each `projectionErrors` entry | invalid | all repayment keys | `fieldIdForPath(plan, path)` mapped to dashboard via the same scope table as PlannerApp.tsx:63-70 |
| `scenario.<id>.failed` | `comparisons.scenarioFailures` | invalid | scenarioComparison | `scenarios` / `scenarios.<id>.name` |
| `draft.<fieldId>` | `invalidFieldIds` (optional) | invalid | keys owning that field | that field |

Not-applicable: `scenarioComparison` with no scenarios, `eventImpacts` unless there is an income or windfall event (expense/aid events only change the gap), `federalLimits`/`federalPlans`
with no federal loans. `timeline` is always `complete` (dates are always valid in a stored plan).

Salary is never required for repayment; costs never block repayment; loans never block `borrowingGap`.

### Navigation + focus (existing mechanisms)

- Add one helper in `src/ui/nav/navigation.ts`:
  `export function goToTarget({ dashboard, fieldId }: ReadinessTarget) { navigateDashboard(dashboard, fieldId); revealField(fieldId); }`
  `navigateDashboard` sets `requestedFieldId`, which suppresses heading focus (PlannerApp.tsx:67-69); `revealField`
  retries until the newly mounted field exists, opens ancestor `<details>` (Costs editor panels, Income raises, job
  `<details>`), and focuses it.
- Loans: `LoansSection` expands a card on any reveal id `loans.<loanId>.*` (LoansSection.tsx:76-79). Use a
  **non-dotted** id for the add button (`loans-add`) so it is not parsed as a loan id.
- Costs: `SchoolYearsSection` selects the year for any `schoolYears.<yearId>.*` reveal (:41) and on mount from
  `requestedFieldId` (:35-40). Give each year's "Add cost" button id `schoolYears.<yearId>.costItems-add` and the
  resource add button `schoolYears.<yearId>.resources-add`; PlannerApp's scope routing (:64-68) already maps
  `schoolYears.*` to `school`.
- Income: `postGradIncome.*` routes to `income`; job fields `schoolYears.<y>.resources.<jobId>.*` route to `income`
  (PlannerApp.tsx:68) and IncomeSection selects year + opens the job (:33-41). Add id `income-add-earnings` on
  "Add earnings" (:88); target dashboard `income` explicitly.
- Federal: `repayment.annualAGI` / `repayment.familySize` route to `federal` (PlannerApp.tsx:66); those fields are in a
  collapsed `<details>` (FederalSection.tsx:24-27) which `revealField` opens.
- Missing ids today: `loans-add`, `…costItems-add`, `…resources-add`, `income-add-earnings`. `repayment.extraMonthlyPayment`
  has no field (see §3.9) — readiness must not target it.

## 7. File ownership

Confirmed as in TEAM-TASK.md, with refinements:
- **ui**: `src/data/readiness.ts` (new), `src/ui/**` incl. `navigation.ts` `goToTarget`, button ids above, Results
  checklist, KeyFigures placeholders, DashboardSummary placeholders (PlannerApp.tsx:150-162), "Create loan from gap"
  disabled at gap 0, optional sidebar badges. Replace UI copies of `resourceValue`/`annualEarnings` with engine exports `resourceValue` and `resourceGrossValue` (planner.ts). `totalBorrowed` = Σ `plan.loans` principal (not Σ `years.borrowed`, which drops loans outside school years).
- **math**: reviews the `ResultKey`/rules table (§6), owns any engine change. Do **not** change no-loan behavior in
  projection.ts (pinned by acceptance.test.ts:118); gating belongs in readiness. Decide whether
  `extraMonthlyPayment` needs a field or migration to 0 (data/validation coordination with ui) and document fixed
  payment vs budget semantics.
- **tester**: `src/data/readiness.test.ts`, `src/ui/resultsGuidance.test.tsx`, `e2e/readiness.spec.ts`,
  `src/engine/reference-cases.test.ts`. Existing e2e specs were modified by the user — do not rewrite them.
- **researcher**: this file only.

## 8. Acceptance criteria (testable)

1. Default plan: Results and Overview show **no** debt-free date, no `$0.00` total interest/borrowed/gap/minimums;
   checklist lists "Add a loan" and "Add school costs"; `getPlanReadiness(createDefaultPlan())` returns `loans.none`
   and `costs.none` as `missing`, `debtFreeDate.state === 'incomplete'`, `timeline.state === 'complete'`.
2. Loan-only plan (loan $30,000 @ 6.5%, 120 mo, budget $340.64, no costs): debt-free date and interest shown
   (subsidized loan disbursed at repayment start → 120 payments, interest within $1 of $10,877.41); `borrowingGap` is
   `incomplete` but **no** checklist item blocks repayment results; `costs.none` does not appear in `blocks` of any
   repayment key.
3. School-only plan (costs, no loans): gap figures shown; repayment keys `incomplete` with action "Add a loan" or
   "Create loan from Year N gap".
4. Valid zeros: 0% rate loan, gap $0 with costs > resources-covered, $0 AGI, 0 grace produce no `missing` items.
5. Clicking each checklist action navigates to the correct dashboard, expands the containing loan card / year /
   `<details>`, and `document.activeElement.id === target.fieldId` (for every rule in §6).
6. Entering the value (e.g. principal 5000) removes the item without reload; checklist count in the `role="status"`
   line updates; navigating back to Results shows the value.
7. Budget $0 with loans: `budget.zero` missing; budget $10 below interest: `nonPayoff` with "Increase budget"
   action; budget below minimums: `budget.shortfall` warning visible on Results.
8. Untouched default budget with loans: debt-free date shown with "Estimate" chip (`state === 'estimate'`); editing
   the budget to another value removes the assumption.
9. Scenario that cannot be projected: `scenarioComparison` `invalid`, other results unaffected.
10. "Create loan from gap" disabled when the year's gap + buffer is $0.00.
11. Readiness module imports nothing from React/DOM; it is called by both Results and KeyFigures (no duplicated rules).
12. Keyboard: checklist actions are buttons reachable in order; status line is a polite live region; at 360 px and
    200% zoom nothing is clipped (existing e2e overflow checks extended).
13. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass.

## 9. Baseline (2026-10-16, before team changes)

- `npx vitest run`: **28 files, 520 tests, all passed** (≈10 s).
- `npx tsc --noEmit`: **pass** (no output).
- `npx eslint .`: **pass** (no output).
- Playwright e2e (`e2e/journey.spec.ts`, `loans.spec.ts`, `sidebar.spec.ts`, 30 tests): not run here (slow); all three
  specs carry uncommitted user edits. Last recorded: 32 Chromium tests passing (REQUIREMENTS-CHECKLIST.md).
- Known behavior to preserve: `acceptance.test.ts:118` (no-loan plan projects `paidOff` at repayment start),
  `dashboards.test.tsx` (one dashboard mounted; reveal across dashboards), loan-card collapse tests.

## 10. Reconciliation (2026-10-16, after implementation; read-only check)

I re-ran the checks on the final tree. `npx vitest run`: 32 files, **631 tests pass** (baseline was 520). `tsc --noEmit`
passes, `eslint .` passes, and `npm run build` passes. Playwright `e2e/readiness.spec.ts` (7 tests) exists; I did not
run it (the tester owns browser runs).

### §8 acceptance criteria

| # | Status | Evidence / gap |
|---|---|---|
| 1 Empty plan, no $0 or date | Met | readiness.ts:207-213 and :292-303; KeyFigures.tsx:21-26 `ResultFigure`; readiness.test "empty (default) plan"; resultsGuidance "Overview … no $0.00 totals"; e2e "empty plan" |
| 2 Loan-only plan | Met | readiness.test "existing-loan-only repayment"; resultsGuidance "loan-only plan" |
| 3 School-only plan | Met | readiness.test "school-only planning"; resultsGuidance "school-only plan". The `loans.none` text suggests creating a loan from the gap (readiness.ts:211) |
| 4 Valid zeros | Met | readiness.test "valid zeros are never missing"; resultsGuidance "valid zeros produce no needs rows" |
| 5 Actions land on target | Met | navigation.ts:16-19 `goToTarget`; button ids at LoansSection.tsx:124, SchoolYearsSection.tsx:176 and :197, IncomeSection.tsx:89; resultsGuidance "every checklist action lands on its target" |
| 6 Live update | Met | PlannerContext.tsx:50-54 (memoized from the deferred plan); resultsGuidance "completion flow"; e2e "completion journey" |
| 7 Budget states | Met, with one gap | readiness.ts:243-281; tests "budget $0", "$10 below interest", "below minimums". `horizonExceeded` offers only the budget action, not `repayment.maxMonths` (readiness.ts:279) |
| 8 Default budget = estimate | Met | readiness.ts:255-262; Readiness.tsx:92 chip; tests "untouched default $400 budget" |
| 9 Failed scenario | Met | readiness.ts:191-197; readiness.test "scenario that cannot be projected" |
| 10 Create loan from gap disabled at $0 | Met | SchoolYearsSection.tsx:136 (`!gapPositive`); resultsGuidance "Create loan from gap" |
| 11 Pure, shared readiness | Met | readiness.test "imports nothing from React or the DOM". Used by ResultsSection, KeyFigures, DashboardSummary (PlannerApp.tsx:154-162) and PlannerApp routing (:63). KeyFigures.tsx:14-15 and PlannerApp.tsx:157 still sum gaps and principals in the UI (small duplication) |
| 12 Keyboard, live region, 360 px / zoom | Met in unit tests; e2e not re-run here | Readiness.tsx:40 (`role=status`, polite); resultsGuidance "accessibility"; e2e "keyboard", "axe", "360 px and 200% zoom" |
| 13 typecheck, lint, test, build | Met | see above |

### TEAM-TASK.md Results-dashboard requirements

| Requirement | Status | Evidence / gap |
|---|---|---|
| Prominent "Your plan needs…" checklist with plain label, what it blocks, and an Add/Edit action; live updates | Met | Readiness.tsx:30-62; ResultsSection.tsx:52; Overview via KeyFigures.tsx:19 |
| Opens the correct dashboard, section and field, and focuses it | Met | goToTarget plus revealField (opens `<details>`, expands loan cards, selects the year) |
| Show available results when others are incomplete | Met | Per-figure `ResultFigure`; view selector suffixes and `NeedsCard` (ResultsSection.tsx:69-80) instead of hiding views |
| Distinguish incomplete / invalid / estimate / non-payoff | Met | 6 states, readiness.ts:32; Readiness.tsx:80-98; "Check your payment plan" group (:47-52) |
| No misleading $0 or date; a valid zero is not missing | Met | Criteria 1 and 4 |
| Irrelevant fields not required | Met | `costs.none` blocks only `borrowingGap`; salary is needed only with income events (readiness.ts:349) |
| Defaults and assumptions identified, not mandatory | Met | Assumption severity in a collapsible list (Readiness.tsx:53-59); budget, salary and AGI default items |
| Income & Earnings easy to find; salary vs budget explained | Met | Second sidebar item (navItems.ts); IncomeSection.tsx:96-102 hints and example |
| Labels, hierarchy, helper text, empty states | Mostly met | Empty states for Loans (:106) and Costs (`empty-cta` outside `<details>`, SchoolYearsSection.tsx:119-120) improved. Dashboards other than Income, Costs, Loans and Results were not reviewed in depth |
| Compact, accessible, scrolls on mobile and zoom, no clipping | Met (pending e2e run) | readiness.css; e2e narrow and zoom tests |
| Keep sidebar, dashboards, collapsible loans, editable inputs, saved plans | Met | Existing AppShell, LoansSection and persistence tests still pass (631/631) |
| Calculations only in the engine; one validation layer | Met | `resourceGrossValue` and `baseMonthlyBudget` exported (planner.ts); UI copies of `resourceValue`/`annualEarnings` removed. `fieldIdForPath` moved into readiness.ts and re-exported from planUpdates.ts:5-8 |

### Gaps that remain (none blocks the definition of done)

1. No per-dashboard sidebar badges. `byDashboard` is computed (readiness.ts:423-427) but nothing renders it.
2. No "Back to Results" link after following an action; users return through the sidebar.
3. Forms don't pass invalid drafts to readiness. `invalidFieldIds` is supported and tested (readiness.ts:198-204), but PlannerContext.tsx:50-54 never passes it. Drafts are also lost when their dashboard unmounts.
4. For `horizonExceeded`, the action only targets the budget; the text mentions the horizon but there is no link to `repayment.maxMonths`.
5. Capitalization default (on) is left for the user to decide; it is not flagged as an assumption.
6. Engine change: minimum payments now amortize separately accrued, uncapitalized interest (projection.ts, `owedAtStart`). This changes minimums only for loans with capitalization turned off; it is covered by math-review.test.ts.
