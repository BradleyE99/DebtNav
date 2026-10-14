# Requirements implementation and verification checklist

Updated 2026-10-13 after the sidebar and loan-card continuation. Implementation status and verification are recorded separately. "E2E" means the real Chromium tests in `e2e/journey.spec.ts`, `e2e/sidebar.spec.ts` and `e2e/loans.spec.ts`. "Vitest" means unit, property or component tests. Latest local gate: 517/517 Vitest tests, 2/2 benchmarks, typecheck, ESLint, money lint and production build pass. Prior coverage was 98.3% across engine, policy, data, state and integrations; coverage was not rerun for this UI continuation. Nothing has been pushed, merged or run in CI.

## Sidebar and loan-card continuation

The continuation inherited HEAD `77006e6` and extensive uncommitted planner, engine, persistence, navigation and loan-card work. No Claude conversation history was available. Existing changes were preserved and checked rather than rebuilt.

- Sidebar: all nine original destinations, persistent collapse/icon rail, active tracking including direct hashes and Back/Forward, tooltips, mobile dismissal and focus management, reduced motion and content resizing.
- Loans: collapsed saved loans, automatically opened new/gap-created loans, principal/rate summaries, multiple and bulk expansion, mounted drafts, collapsed error indicators, useful unnamed labels and separate removal actions. Large summary amounts wrap at 360 px.
- Valid edits survive collapse, navigation and reload. Invalid drafts survive collapse/navigation; reload restores the last valid saved plan.
- Independent read-only review found no blocking regression. All 32 Chromium tests pass, covering keyboard interaction, projection updates, persistence, axe checks, desktop and 360 px overflow. Human screen-reader and usability checks remain outstanding below.

## Root cause of "I can't edit values"

The earlier committed app (`498c26a`) mounted `M1Preview`, which only rendered fixed sample fixtures. It offered a sample picker and a start/graduation date form, with no editors for costs, resources, loans, income, events or scenarios. The working tree replaces it with a connected planner: `src/App.tsx` → `usePlannerDocument` (validated store with autosave) → `PlannerApp`. Each field (`src/ui/fields/useDraftField.ts`) keeps its own text, so users can clear and retype it. Blank or invalid text is never committed. Valid values commit immediately, and results derive from the stored plan.

Verified in real Chromium by the lead, separately from the agents' tests:
- Clicked, cleared and typed into every field type.
- A blank field shows an error and does not become 0.
- The results panel updates live: debt-free date Oct 2033 → May 2040 when the budget changed.
- Values persist after reload.

## User stories

| ID | Requirement | Implementation | Verification | Status |
|---|---|---|---|---|
| US-101 | Create plan, date validation, year reconciliation | engine/plan.ts, planner.ts `reconcileSchoolYears`; data/validation.ts (graduation strictly after start, 1900–2199) | E2E dates step (5th year added/removed, error on early graduation); vitest | Done |
| US-102 | Grace 0–12, repayment start = graduation + grace | engine/planner.ts; SetupSection | acceptance.test.ts; E2E grace step | Done |
| US-103 | Disclaimer, re-open from footer | ui/sections/Disclaimer.tsx | E2E disclaimer step | Done |
| US-201 | Cost items, live total, invalid input rejected | SchoolYearsSection; planner.ts | E2E costs (blank, "abc", "-5" stay visible; $22,700.00) | Done |
| US-202 | Copy year forward with % | SchoolYearsSection; planner.ts | planner.test.ts ($20,600); E2E 3% copy | Done |
| US-203 | Semester costs | cost `semester` field | planner.test.ts; E2E Fall+Spring $20,500.00 | Done |
| US-301 | Grants and scholarships | resources | acceptance.test.ts; E2E | Done |
| US-302 | Hourly job income, fixed amount, unavailable % | resources (job) | planner.test.ts; E2E $6,750.00 / $4,050.00 | Done |
| US-303 | Savings and family | resources | acceptance.test.ts; E2E | Done |
| US-304 | Gap, surplus, "calculation, not a recommendation" label | planner.ts; SchoolYearsSection | E2E $9,950.00; vitest surplus | Done |
| US-305 | Borrowing buffer | year `bufferPercent` | planner.test.ts; E2E $10,447.50 | Done |
| US-401 | Loans: 4 types, rate 0–30% | LoansSection; validation.ts | E2E add/edit/remove, error above 30% | Done |
| US-402 | Loan from gap; mismatch notice | SchoolYearsSection, LoansSection | E2E pre-fill, mismatch, principal unchanged | Done |
| US-403 | In-school simple interest (actual days ÷ 365) | projection.ts | golden, planner, acceptance tests. See discrepancy D1. | Done |
| US-404 | Capitalization; pay interest in school shows monthly cost | projection.ts; LoansSection | golden.test.ts ($5,300); E2E checkbox and monthly cost | Done |
| US-405 | Federal limit warnings from versioned data | policy/reference.ts, federal.ts | federal.test.ts; E2E | Done. Values re-verified 2026-10-13. Graduate aggregate counts only graduate Sub/Unsub loans. |
| US-501 | Salary, budget, shortfall warning | RepaymentSection; planner.ts | planner.test.ts; E2E shortfall amount | Done |
| US-502 | Minimum payment formula | projection.ts | golden.test.ts ($340.64) | Done |
| US-503 | Debt-free date, total interest | projection.ts | golden.test.ts (120 payments, $10,877.41). See D2. | Done |
| US-504 | Amortization schedule, final payment adjusted, principal sum exact | projection.ts; AmortizationSchedule | golden.test.ts; properties; E2E paging and filter | Done |
| US-505 | Negative amortization: warning, no debt-free date | projection.ts; ResultsSection | acceptance.test.ts; E2E $50/month | Done (review M3 fixed) |
| US-601 | Avalanche, tie-break smallest balance, rollover | strategies/avalanche.ts | strategies.test.ts; planner.test.ts | Done |
| US-602 | Snowball, tie-break highest rate, rollover | strategies/snowball.ts | strategies.test.ts | Done |
| US-603 | Custom order (drag and keyboard) | strategies/custom.ts; RepaymentSection | strategies.test.ts; E2E keyboard and drag | Done |
| US-604 | Neutral comparison, deltas, months to first payoff | planner.ts comparisons; results/comparison.ts | acceptance.test.ts exact deltas; E2E (no "best") | Done. Invariant holds within rounding (see D3). |
| US-605 | One file + one registry entry | strategies/registry.ts; `StrategyId = string`; validation and UI read `listStrategies()` | strategies.test.ts; validation.fields.test.ts | Done (review m2 fixed) |
| US-701 | Instant recalculation, no Calculate button | PlannerContext (deferred core) + Web Worker for comparisons and federal estimates | bench: projection mean 11.6 / max 18.6 ms, comparisons mean 34 / max 62 ms; E2E keystroke → frame ≤ 17 ms, → results ≤ 43 ms | Done |
| US-702 | Income change, % of raise to debt | EventsSection; planner.ts; default share setting | planner.test.ts; E2E | Done (review M2 fixed: setting seeds new income events) |
| US-703 | Windfall and impact sentence | planner.ts event impact | planner.test.ts; E2E impact text | Done |
| US-704 | Expense or aid change adjusts gap | planner.ts | planner.test.ts; E2E Year 3 $20,500 → $19,000 | Done |
| US-705 | Timeline in date order | planner.ts timeline; ResultsSection | planner.test.ts; E2E order check | Done |
| US-801 | Scenario overrides inherit base | planner.ts applyScenario; ScenariosSection | acceptance.test.ts property; E2E inherited salary | Done |
| US-802 | Scenario comparison and range | planner.ts scenarioRange; ResultsSection | planner.test.ts; E2E "Debt-free between…" | Done. Scenarios that can't be projected are listed with a reason. |
| US-901 | Balance chart with table alternative | results/BalanceChart.tsx (SVG + table) | E2E lines, legend, table; axe | Done |
| US-902 | Year summary table | ResultsSection | E2E columns | Done |
| US-1001 | Autosave; storage-unavailable notice | state/usePlannerDocument.ts; data/storage.ts | persistence tests (pagehide flush, quota, SecurityError); E2E reload and storage-unavailable test | Done |
| US-1002 | Versioned JSON export/import, migration, never corrupts | data/storage.ts | round-trip property; v2 migration; invalid/future rejected; E2E export, import, bad file | Done |
| US-1003 | Confirmed deletion of all DebtNav keys | storage.ts; DataSection; ConfirmDialog | storage tests (other keys untouched); E2E confirm, delete, reload | Done |
| US-1101 | Debt-to-earnings via College Scorecard | integrations/scorecard.ts; FederalSection | scorecard.test.ts; lead's live browser lookup on 2026-10-13 (Purdue CS medians with source and "latest release" label) | Done. Uses DEMO_KEY (about 10 requests per IP) or a user's own key held in memory only. |
| US-1102 | Federal repayment modeling, versioned rules | policy/federal.ts (RAP, IBR, Tiered Standard) | federal.test.ts | Done as a simplified comparison. Rules verified against 34 CFR 685.208–.210. IBR is unavailable when any loan was made on or after 2026-07-01. |

## Non-functional requirements

| NFR | Evidence | Status |
|---|---|---|
| NFR-1 Decimal money | decimal.js and string Money. Money lint now covers engine, policy, data and integrations, with an explicit `money-lint-allow:` escape for integer counts. | Pass |
| NFR-2 Matches reference to $0.01 | golden.test.ts: full 120-row BigInt reference | Pass |
| NFR-3 Invariants | fast-check: non-negative balances, principal conservation, monotonic months for budget and extra payment, scenario identity, no throws or mutation | Pass for tested domains |
| NFR-4 < 100 ms | bench asserts mean and max. E2E latency in real Chromium. | Pass locally. CI not yet run. |
| NFR-5 Privacy | Lead's network capture: the only external request is the user-initiated Scorecard GET. privacy.test.ts scans data and state. | Pass |
| NFR-6 WCAG 2.1 AA | axe (wcag2a/aa, 21a/aa, color-contrast enabled) on a fully populated page with the dialog open. Keyboard-only E2E. Inert modal. Single live region. | Automated pass. Manual screen-reader check outstanding. |
| NFR-7 5-minute first use | Needs 5+ student participants | Outstanding (human study) |
| NFR-8 360 px | narrow-360 Playwright project; lead measured scrollWidth 360/360 | Pass |
| NFR-9 "How is this calculated?" | Explanations on key figures, years, loans, schedule, chart, comparisons, timeline, federal estimates and the debt-to-earnings ratio | Pass (review m9 fixed) |
| NFR-10 Pure engine, ≥ 90% coverage | ESLint restricts engine imports. Coverage 98.3% lines over engine, policy, data, state and integrations (engine 99.6%). | Pass |
| NFR-11 Invalid input never crashes | Field-level errors. Fuzz: parsers on 2000 strings, validator on `fc.anything`. A late loan disbursement keeps gaps visible and highlights the loan. | Pass |

## SRS discrepancies (mathematically justified behavior implemented)

- **D1 (US-403):** $300.00 holds for a 365-day span. A 12-month span that includes Feb 29 is 366 days, so §8.2 gives 5000 × 0.06 × 366/365 = $300.82.
- **D2 (US-503):** "120 payments of $340.64" can't reach zero. The 120th payment must be $341.25 (as US-504 requires), giving total interest of exactly $10,877.41.
- **D3 (US-604):** "Avalanche ≤ every strategy" holds only within cent rounding (observed ≤ $0.02). It fails when a loan has capitalization turned off, because uncapitalized interest accrues no interest itself. All strategies are identical when the budget is below the minimums.
- **D4 (US-702):** the SRS leaves X% unspecified. It is user-set per event, with a plan-level default.
- **D5 (US-101):** equal start and graduation dates are rejected, since they would produce a zero-length school year.
- **Policy:** the SRS glossary implies capitalization at repayment start. Current Direct Loan rules don't list entering repayment as a capitalization event (34 CFR 685.202(b)). DebtNav keeps the SRS default (§8.4), labels it a modeling assumption, and lets users turn it off per loan.

## Outstanding (not marked as passed)

- NFR-7 usability test with 5+ students.
- NFR-6 manual screen-reader pass (NVDA/VoiceOver).
- A real printed page. Only print-media emulation was tested.
- CI run on GitHub. The workflow file is added but has not run.
- The "repayment can't be projected" display can only be reached through a stub store, because the real store and loader prevent or repair that state.
