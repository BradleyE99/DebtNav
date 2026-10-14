# DebtNav: Independent Review

Reviewer: independent review agent (I did not write this code). Date: 2026-10-13.
Scope: working tree as of 2026-10-13, after the lead reported that the UI agent had finished (src/ui/** and e2e/** reviewed in their final state).
Method: read docs/REQUIREMENTS.md in full, then read the source of src/engine, src/policy, src/data, src/state, src/integrations, src/App.tsx and src/ui. I recomputed the key figures independently (decimal.js script plus a throwaway vitest file, both in the session scratchpad, not in the repo), ran the allowed tooling, and checked two policy values against live sources. I did not rely on docs/FULL-REVIEW.md or docs/REQUIREMENTS-CHECKLIST.md.

## 1. Checks run (actual results)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, no output |
| `npx eslint .` | exit 0, no output |
| `node scripts/check-money.mjs` | "Money lint passed: decimal aliases and engine string arithmetic/coercion checks." exit 0. Covers `src/engine` only, not `src/policy` or `src/ui`. |
| `npx vitest run --coverage` | 22 files, 450 tests passed. Coverage (engine + policy only, per vite.config.ts:7): statements 98.35%, branches 94.46%, functions 100%, lines 98.81%. engine lines 99.61%, policy/federal.ts lines 96.68%. |
| `npx vitest bench --run src/engine/planner.bench.ts` | 2 passed. With `--silent=false`: calculatePlannerProjection mean 9.42 ms, p99 12.54, max 15.86. calculatePlannerComparisons mean 26.10 ms, p99 42.73, max 51.48 (reference plan: 4 years, 8 loans, 360 months). |
| Independent recomputation (scratch decimal.js script plus scratch vitest against the real engine) | All figures match. See section 3. |
| WebFetch policy spot-checks | 2026-27 Direct Loan rates 6.52% / 8.07% / 9.07% match reference.ts:40-42. 2026 HHS poverty guideline $15,960 + $5,680 matches reference.ts:116. |
| Network grep (fetch, XHR, sendBeacon, WebSocket, EventSource, navigator, http(s) URLs, img, dynamic import, analytics) across src, index.html, vite.config.ts | The only network call is `fetch` in src/integrations/scorecard.ts:95. Other URLs are source links (`<a target=_blank>`) or constants. index.html loads no external resources. |
| Engine purity grep (react, window, document, localStorage, Date.now, new Date()) in src/engine, src/policy | No hits. Engine imports only decimal.js, its own modules, and src/policy/reference.ts. |

Not run (as instructed): Playwright and dev servers. Every e2e claim (axe, 360 px, keyboard, print, typing responsiveness) is unverified by me.

## 2. Findings, ranked by severity

No blockers found.

### Major

**M1. A planning error in one loan removes every result, including the borrowing gaps, and the message does not say which field is wrong.**
- Where: src/data/validation.ts:7-10 deliberately lets a loan be disbursed after repayment starts. src/engine/projection.ts:62-63 then rejects the whole projection with an index-based path `loans.0.disbursementDate`, although planner-contracts.ts:12-15 requires record-ID paths. src/engine/planner.ts:321-324 builds the year summaries only after the repayment projection succeeds.
- Failure scenario (reproduced in scratch): default plan, add a $20,000 cost, add a loan disbursed 2031-06-01 (repayment starts 2030-11-20). `validatePlannerPlan` returns ok:true, but `calculatePlannerProjection` returns `{ok:false, errors:[{path:'loans.0.disbursementDate', ...}]}`. In the UI, every year card shows "Totals appear when every amount in your plan is valid" (SchoolYearsSection.tsx:217), KeyFigures shows "Complete the highlighted fields" (KeyFigures.tsx:13) but nothing is highlighted, and ResultsSection.tsx:27 lists "Disbursement must be on or before repayment starts." without naming the loan. The gap is a borrowing-phase result and has no dependency on repayment, yet it disappears.
- Fix: compute `years` independently of the repayment result. Have projection.ts emit `loans.<id>.<field>` paths, and have LoanCard show projection errors for its own fields (or validate the disbursement date in the store so the field rejects it).

**M2. "Share of future raises put toward debt" is a control that does nothing.**
- Where: src/ui/sections/RepaymentSection.tsx:23-25. Its hint says "Default for new income-change events", but `postGradIncome.raiseAllocationPercent` is never read by the engine or the UI. The only reads are validation and the default value (grep: planner.ts:24,149; validation.ts:319,516; storage.ts:68). EventsSection.tsx:146-151 creates every event as a windfall with `allocationPercent: '100'`, and switching it to "Income change" keeps 100%.
- Failure scenario: a user sets 50% and adds a raise event. The raise is applied at 100% of the event's own field. This breaks the "no placeholder controls" rule.
- Fix: seed `allocationPercent` from `raiseAllocationPercent` when an event is created as, or changed to, type `income`, or remove the field.

**M3. A contradictory "no debt-free date" alert appears when a debt-free date exists.**
- Where: src/ui/results/ResultsSection.tsx:53 treats any `NEGATIVE_AMORTIZATION` or `NON_AMORTIZING` warning as `negative`. Lines 68-72 then show a `role="alert"` box saying "...so there is no debt-free date". The engine also emits these warnings in the non-stopping case: with life events (projection.ts:183-193, `stopProjection` false before `budgetStableFrom`), the message is "balance grows until payments increase".
- Failure scenario (reproduced): budget $50 per month on $30,000 at 6.5%, plus a raise to $85,000 on 2032-01-01 at 50%. The engine returns status `paidOff` with debtFreeDate 2034-03-20 and one NEGATIVE_AMORTIZATION warning. The Summary shows "Debt-free date: Mar 2034" next to an alert claiming there is no debt-free date.
- Fix: base `negative` on `repayment.status === 'notAmortizing'`. Otherwise show the engine's own warning message, for example "temporarily not covering interest until <date>".

### Minor

- **m1. Scenarios that cannot be projected disappear silently.** src/engine/planner.ts:384-385 (`if (!result.ok) continue;`). Validation (validation.ts:412-443) checks only structure, so a scenario that moves graduation before a loan's disbursement passes validation, then vanishes from the comparison table, the chart, and the range sentence with no notice. Fix: return a per-scenario error entry and show "Not comparable: <reason>".
- **m2. US-605 "one file + one registry entry" holds only for the engine.** Strategy ids are also hard-coded in validation.ts:58 (`STRATEGIES`), planner-contracts.ts:67 (`StrategyId`), ui/format.ts:273-277 (`STRATEGY_LABELS`, the select options in RepaymentSection.tsx:9) and ScenariosSection.tsx:107. A new registry strategy would be rejected by validation and not offered in the UI. Fix: derive these lists from `listStrategies()`.
- **m3. Hard-coded, unsourced, stale rate in the UI.** LoansSection.tsx:40 defaults new loans to `annualRate: '0.0639'` (the 2025-26 rate). createLoanFromGap uses `federalReference.interestRates.undergraduateDirect.rate` (0.0652, planner.ts:128). Fix: use the reference value in both places.
- **m4. The year card "cost total" differs from the gap's "Cost of attendance".** SchoolYearsSection.tsx:133 and :193 sum cost items only. summary.costs (planner.ts:96-97, shown at :210) also includes expense events. Both appear in the same card with different values when an expense event exists. Fix: label the first "Cost items total" or include the events.
- **m5. The federal comparison "Standard" row mixes scopes.** FederalSection.tsx:70-72, 96-100: the payment column is federal loans only, but "Ends" and "Total paid" use all loans, including private. It is labeled "(your projection, all loans)", but the row is not comparable with the federal-only rows. "RAP comparison unavailable: its 360-month term would exceed the supported date range" (line 86) is shown for any modelRap exception (secondary.ts:89-90 swallows all errors).
- **m6. The Projection object is shared but not frozen.** The planner.ts:282-293 memo returns the same Projection to core results, strategy comparisons (planner.ts:364 reuses `base`) and scenario comparisons. This is pinned by acceptance.test.ts:109-110. The memo is keyed by `JSON.stringify(plan)`, which covers every input it depends on (the registry and policy are module constants), so I found no staleness. Comparison objects are mutated (planner.ts:376-377), but they are created fresh each call. No current UI code mutates projections: Timeline copies before sorting (ResultsSection.tsx:236). The risk is a future in-place `.sort()` or `.reverse()` corrupting cached results. Fix: deep-freeze memoized results in development, or document the immutability rule.
- **m7. Duplicate live regions.** SaveStatusBadge is rendered twice with `role="status"` (PlannerApp.tsx:46, DataSection.tsx:218), so screen readers announce every save state twice.
- **m8. The dialog does not make the page inert.** ConfirmDialog.tsx:318-336 traps Tab and Escape and restores focus, but the rest of the page is not `inert` or `aria-hidden`. A screen reader's virtual cursor can leave the dialog. Fix: set `inert` on the app root while it is open, or use `<dialog>.showModal()`.
- **m9. NFR-9 gaps.** The debt-to-earnings ratio (FederalSection.tsx:211-220) has no "How is this calculated?" note. The ratio uses Σ principal + prior federal debt (line 165), not the balance at repayment. That assumption is not stated.
- **m10. CheckboxField lacks `aria-invalid`.** fields.tsx:212-222: it shows an error but sets no `aria-invalid`, unlike the other fields.
- **m11. Dead API.** `projectionUpdating` (PlannerContext.tsx:21, 48) is computed but never used. Stale core results during a deferred render carry no visual cue (comparisons do have one).
- **m12. Coverage and money-lint scope is narrower than the NFR wording.** Coverage includes only engine and policy (vite.config.ts:7). The money lint scans only src/engine (check-money.mjs:4). UI money math uses decimal.js by inspection. The only `Number`/`parseFloat` calls on money are chart pixel coordinates (BalanceChart.tsx:32), which is acceptable.
- **m13. No CI.** There is no `.github/workflows`. NFR-4, NFR-6 and NFR-10 say "in CI". The checks exist as npm scripts (`npm run check`), but nothing runs them automatically.
- **m14. Module-level caches in the "pure" engine.** dates.ts:22-34 and planner.ts:282 are bounded memo caches. They are referentially transparent, so this is acceptable, but strictly the engine holds state.
- **m15. The disclaimer understates what is sent.** Disclaimer.tsx:350 says the Scorecard lookup "sends only a school name and year". It also sends the API key and a field list (scorecard.ts:89). FederalSection.tsx:183 states this correctly.

## 3. Calculation verification (independent recomputation)

All values were recomputed with a standalone decimal.js script (half-up to cents per transaction) and then compared with the real engine in a scratch vitest file.

| Case | Hand result | Engine result | Status |
|---|---|---|---|
| US-302: $15 × 15 h × 30 wk | 6750.00 | resourceValue → 6750.00 | match |
| US-305: $9,950 × 1.05 | 10447.50 | planner.ts:101 formula, same rounding | match |
| US-403: $5,000 @ 6%, 2025-07-01→2026-07-01 (365 d) | 300.00 | 300.00, balance 5300.00 (US-404) | match |
| US-403: 2027-07-01→2028-07-01 (366 d, leap) | 300.82 | 300.82 | match. Rule §8.2 is days/365, so a leap-year span gives $300.82, not $300.00. This is consistent with the SRS formula. |
| US-403: subsidized | 0.00 | 0.00 | match |
| US-502: $30,000 @ 6.5%, 120 mo | 340.643932 → 340.64 | 340.64 | match |
| US-503/504 | 120 payments, final 341.25, interest 10,877.41, principal 30,000.00 | 120, final 341.25, end balance 0.00, interest 10877.41, Σ principal = 3,000,000 cents | match |
| Avalanche, two loans (A $10k @ 7%, B $3k @ 4%, 120 mo each, $300 per month total) | mins 116.11/30.37. A paid month 42, B month 49, 49 months, interest 1,687.62 | identical | match (rollover verified) |
| Snowball, same plan | B paid month 17, A month 50, 50 months, interest 1,942.62 | identical | match. Avalanche ≤ snowball holds. |
| Windfall: $3,000 at 100% in month 12 on the US-503 loan | 105 months, interest 8,704.63 | 105 months, 8704.63, month-12 payment 3340.64. Event impact: 15 months and $2,172.78 saved (10877.41 − 8704.63) | match |
| US-702: raise $55k→$65k at 50% from 2031-01 | 340.64 + 416.67 = 757.31 | 340.64 in Dec 2030, 757.31 from Jan 2031 | match |
| Zero interest: $1,000 / 7 mo | 142.86 × 6 + 142.84 | identical, interest 0.00 | match (final payment absorbs the remainder) |
| Payment < interest ($100 on $30k) | no debt-free date | status notAmortizing, debtFreeDate null, totalInterest null, NEGATIVE_AMORTIZATION | correct (US-505) |
| Horizon exceeded (60 mo on a 120-mo loan) | no debt-free date | horizonExceeded, null, null, HORIZON_EXCEEDED | correct |
| RAP: AGI $55,000, 0 dependents / $9,000 / 3 dependents | 229.17 / 10.00 / 79.17 | identical | match |
| IBR: AGI $55,000, household 1, new borrower | (55000 − 1.5 × 15960) × 10% / 12 = 258.83 | 258.83 | match |

Rounding: interest is rounded half-up per month (projection.ts:136). The minimum is formatted half-up (money.ts:4, :13). The final installment absorbs a bounded rounding residue (projection.ts:170-175). Decimal-only money: the engine uses decimal.js for all money. `daysBetween` returns a day count (a number), which is multiplied into a Decimal; this is acceptable.

## 4. Integration review

- **Edit path.** Every UI edit I traced calls `update` or `remove` (PlannerContext.tsx:52-56). That calls `store.updatePlan` (usePlannerDocument.ts:116-140), which applies the edit, runs reconcileSchoolYears (if dates changed) and pruneDanglingReferences, then `validatePlannerPlan`. Only on success does it commit the change and schedule a debounced save. The projection is derived via `useMemo(calculatePlannerProjection(useDeferredValue(plan)))` (PlannerContext.tsx:37-38). Comparisons are computed in a worker (useSecondaryResults.ts) with stale-response discard (lines 134-142) and a main-thread fallback.
- **Can invalid values reach calculations?** Structurally, no: the store rejects them and fields keep their draft text plus an error (useDraftField.ts:232-240). Semantically, yes (M1): plans that pass validation but fail projection blank the results.
- **Can input crash rendering?** I found no path. The parsers reject malformed text (parse.ts). Display helpers swallow bad values (parse.ts:115-133). The engine entry points are wrapped in try/catch (planner.ts:320, 346, 355, 415). The fuzz tests exist (parse.fuzz.test.ts); I did not run a browser fuzz.
- **Is the Projection ever stored?** No. `toPersistedPlan` (validation.ts:498-527) whitelists input fields only, and both storage and export go through `validateDocument` (storage.ts:118-127).
- **Worker.** The plan is structured-cloned to the worker, so worker results cannot alias main-thread memo objects. Effect ordering under StrictMode is safe: the client is recreated and the request re-sent (useSecondaryResults.ts:158-170).

## 5. Policy review

- src/policy/reference.ts: every numeric value sits under a block with `source` or a source constant, and the whole object carries `asOf: '2026-10-13'`, `effectiveDate`, and `verified` flags. Limits, rates, RAP, IBR, Tiered Standard and poverty values all have sources. The UI shows source links and "as of" (FederalSection.tsx:57-59, 150).
- Federal rules and modeling assumptions are kept apart in data (reference.ts:118-139) and in the UI (FederalSection.tsx:146-149, headed "Federal rules used" and "DebtNav modeling assumptions"). The capitalization-at-repayment simplification is explicitly called a modeling assumption (reference.ts:131) and is a per-loan toggle (LoansSection.tsx:109-111).
- Spot-checks (WebFetch, 2026-10-13): fsapartners.ed.gov GENERAL announcement gives 6.52% / 8.07% / 9.07%, which match. aspe.hhs.gov 2026 guideline gives $15,960 and +$5,680, which match.
- Exception: LoansSection.tsx:40 hard-codes 0.0639 outside reference data (m3).
- Not verified against sources: loan-limit tables, RAP bands and the $50 match, IBR shares and forgiveness terms, Tiered Standard tiers. I checked these only for internal consistency between the code and its cited rules.

## 6. Privacy (NFR-5)

- The single network call is src/integrations/scorecard.ts:95-108. It is user-initiated (form submit, FederalSection.tsx:184), uses GET with `credentials: 'omit'`, `referrerPolicy: 'no-referrer'` and `cache: 'no-store'`, and has a 15 s timeout. The query is school name, data key, fixed field list, `per_page` and api_key (scorecard.ts:89). The key is `DEMO_KEY` (public) or a user-pasted key held only in component state (FederalSection.tsx:161), entered via a password input, and never persisted (the persisted whitelist excludes it). The program filter is applied locally (scorecard.ts:138-142). No secret is in client code. No analytics.
- Outbound `<a target="_blank" rel="noreferrer">` source links are user navigation, not data transfer.

## 7. Accessibility (source level)

- Labels: FieldShell ties `<label htmlFor>` to every input (FieldShell.tsx:21). Hints and errors are wired through `aria-describedby` (fields.tsx:52, 195, 217), and inputs get `aria-invalid` (except checkboxes, m10).
- Custom controls: drag reorder has Move up and Move down buttons with focus follow-up and a live announcement (RepaymentSection.tsx:62-73, 98-109). The import label shows a focus ring via `:focus-within` (planner.css:55). Scroll regions are focusable and labeled (common.tsx:15-20).
- Chart: an SVG with `role="img"`, title, and a desc summarizing each line (BalanceChart.tsx:90-92), plus a data table in `<details>` (lines 121-139). The hover tooltip is mouse-only but `aria-hidden`, and the table covers the same data.
- Dialogs: focus moves in, Tab is trapped, Escape cancels, focus is restored (ConfirmDialog.tsx:296-315). The background is not inert (m8).
- Focus management after add/remove moves focus to the new field or the section heading (for example LoansSection.tsx:45, 130). A skip link is present (PlannerApp.tsx:39).

## 8. Requirements coverage

Legend: Implemented / Partial / Missing. "Test" lists the verifying test file(s) found by requirement-ID grep or by reading.

| ID | Status | Implementation | Verifying test |
|---|---|---|---|
| US-101 | Implemented | plan.ts:204-247, planner.ts:37-44, validation.ts:210, SetupSection.tsx | plan.test.ts, planner.test.ts, validation.fields.test.ts, e2e |
| US-102 | Implemented | projection.ts:31, :59; SetupSection.tsx:40-48 (default 6, planner.ts:17) | acceptance.test.ts, validation.fields.test.ts |
| US-103 | Implemented | Disclaimer.tsx; footer button PlannerApp.tsx:83 | e2e |
| US-201 | Implemented | SchoolYearsSection.tsx:168-194; parse.ts | planner.test.ts, validation.fields.test.ts, e2e |
| US-202 | Implemented | planner.ts:52-64; CopyForward | planner.test.ts, e2e |
| US-203 | Implemented | CostPeriod semester + subtotals (SchoolYearsSection.tsx:129-132) | planner.test.ts, e2e |
| US-301 | Implemented | planner.ts:98-100 | acceptance.test.ts, planner.test.ts |
| US-302 | Implemented | planner.ts:86-91 (hourly, fixed, unavailable %) | planner.test.ts (recomputed: 6750.00) |
| US-303 | Implemented | resource types savings/family | acceptance.test.ts |
| US-304 | Implemented (see M1) | planner.ts:100-108; "a calculation, not a recommendation" label | planner.test.ts, e2e |
| US-305 | Implemented | planner.ts:101; label "Gap + your buffer" | e2e (recomputed: 10447.50) |
| US-401 | Implemented | LoansSection.tsx; RateField 0–30% | validation.fields.test.ts, e2e |
| US-402 | Implemented | planner.ts:123-135, :112 mismatch; LoansSection.tsx:84-88 | planner.test.ts, e2e |
| US-403 | Implemented | projection.ts:67-69 | planner.test.ts (recomputed) |
| US-404 | Implemented | projection.ts:71-83; LoansSection.tsx:103-107 | projection.test.ts / acceptance (no ID tag found) |
| US-405 | Implemented | policy/federal.ts:18-80; reference.ts:47-71 | federal.test.ts |
| US-501 | Implemented (salary used only as the base for income events) | planner.ts:325-341; RepaymentSection.tsx:37-42 | planner.test.ts, e2e |
| US-502 | Implemented | projection.ts:84-86 | golden.test.ts |
| US-503 | Implemented | projection.ts:227-230 | golden.test.ts |
| US-504 | Implemented | projection.ts:170-175; AmortizationSchedule.tsx (per loan + combined) | golden.test.ts, acceptance.test.ts, e2e |
| US-505 | Implemented (UI wording issue M3) | projection.ts:183-195, :222 | acceptance.test.ts, planner.test.ts |
| US-601 | Implemented | strategies/avalanche.ts | strategies.test.ts, acceptance.test.ts |
| US-602 | Implemented | strategies/snowball.ts | strategies.test.ts |
| US-603 | Implemented | strategies/custom.ts; RepaymentSection.tsx CustomOrder (drag + buttons) | strategies.test.ts |
| US-604 | Implemented | planner.ts:362-379; ResultsSection.tsx:154-184 | strategies.test.ts, acceptance.test.ts (invariant property), planner.test.ts |
| US-605 | Partial (m2) | registry.ts; interface contracts.ts:116-121 | strategies.test.ts |
| US-701 | Implemented | no Calculate button; derived memo + worker | bench (9.42 ms mean core), e2e |
| US-702 | Implemented (M2: default-share control dead) | planner.ts:209-216 | planner.test.ts, e2e (recomputed: 757.31) |
| US-703 | Implemented | planner.ts:218-226, :404-412; EventsSection.tsx:125-140 | planner.test.ts (recomputed) |
| US-704 | Implemented | planner.ts:94-99 | planner.test.ts, e2e |
| US-705 | Implemented | planner.ts:295-316; ResultsSection.tsx:233-253 | planner.test.ts (by reading; no ID tag) |
| US-801 | Implemented | paths.ts:96-117; planner.ts:47-49 | paths.test.ts, planner.test.ts, acceptance.test.ts, e2e |
| US-802 | Implemented (m1) | planner.ts:382-401; rangeSentence | planner.test.ts |
| US-901 | Implemented | BalanceChart.tsx (line per strategy or scenario + table) | e2e |
| US-902 | Implemented | ResultsSection.tsx:88-117 | PlannerApp.test.tsx (no ID tag) |
| US-1001 | Implemented | usePlannerDocument.ts; storage.ts:163-207 | storage.persistence.test.ts, usePlannerDocument.persistence.test.ts, e2e |
| US-1002 | Implemented | storage.ts:86-134 (v2 migration, never corrupts) | storage.persistence.test.ts, e2e |
| US-1003 | Implemented | storage.ts:210-227; DataSection.tsx:230-244 confirm | storage.persistence.test.ts, e2e |
| US-1101 | Implemented | scorecard.ts; FederalSection.tsx:156-231 (source + data year per row) | scorecard.test.ts |
| US-1102 | Implemented | federal.ts:121-394 (RAP, IBR, Tiered Standard); reference data with sources | federal.test.ts, FederalSection.test.tsx |
| NFR-1 | Implemented | decimal.js throughout; check-money.mjs (engine only) | money lint pass, unit tests |
| NFR-2 | Implemented | | golden.test.ts |
| NFR-3 | Implemented | fast-check properties | acceptance.test.ts, planner.test.ts |
| NFR-4 | Implemented locally, no CI (m13) | | planner.bench.ts (passes) |
| NFR-5 | Implemented | section 6 | privacy.test.ts; code review above |
| NFR-6 | Partial: axe in jsdom + e2e, keyboard e2e; no CI, no manual screen-reader check; m7, m8, m10 | | PlannerApp.test.tsx, e2e (not run by me) |
| NFR-7 | Not verifiable (needs a usability study with 5+ students) | | none |
| NFR-8 | Implemented per e2e (not run by me) | planner.css media queries | e2e @narrow |
| NFR-9 | Mostly implemented; m9 | Explain blocks in each section | review |
| NFR-10 | Implemented | engine pure (section 1); 99.61% engine lines | coverage run |
| NFR-11 | Implemented | parsers + validation + try/catch | parse.fuzz.test.ts, validation tests, e2e |

Placeholders and static samples: src/samples/m1.ts and src/engine/fixtures/standard.ts are imported only by src/engine/projection.test.ts (grep). Nothing in the UI uses sample or fixture results; all figures come from the engine. The only non-functional visible control I found is M2.

## 9. Items I could not verify

- Any browser behavior: axe results, 360 px layout, keyboard flows, print view, worker behavior in a real browser, real typing latency. Playwright was not run, per instructions.
- NFR-7 usability, and a manual screen-reader pass.
- Policy values other than the two spot-checks (loan limits, RAP bands, IBR terms, Tiered Standard tiers).
- The live College Scorecard API response shape. I reviewed only the code and its tests.
- Whether the avalanche ≤ other-strategies invariant holds for every plan with life events and shortfall allocation. I verified it on one hand case and saw that a property test exists; I did not prove it.

---

## Round 2 (re-review after fixes, 2026-10-13)

Same read-only rules as round 1. This time I also read e2e/. I re-read every changed file (40 files newer than the round-1 report), reran all allowed checks, and reran my scratch recomputation against the fixed engine.

### R2.1 Checks run

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx eslint .` | exit 0 |
| `node scripts/check-money.mjs` | "Money lint passed ... (engine, policy, data, integrations)". exit 0. One `money-lint-allow:` escape, at src/data/parse.ts:99 (an integer count, not money). |
| `npx vitest run --coverage` | First attempt failed: another Vitest process (pid 26900) held `coverage/`. Rerun with `--coverage.reportsDirectory=<scratchpad>`: 24 files, 487 tests passed. Statements 97.53%, branches 93.58%, functions 99.41%, lines 98.30%. Line coverage per area: data 97.15%, engine 99.62%, integrations 98.57%, policy 97.27%, state 98.44%. |
| Benchmark (`--silent=false`) | 2 passed. Core mean 10.80 ms (p99 13.80, max 13.81). Comparisons mean 31.49 ms (p99 49.56, max 51.58). Both slightly slower than round 1 (9.42 / 26.10), probably partly the new deepFreeze. Still well within the tests' own thresholds. |
| Scratch recomputation (same file as round 1) | Every figure unchanged: $340.64; 120 payments, final $341.25, interest $10,877.41, principal 3,000,000 cents; accrual $300.00 / $300.82; avalanche 49 mo / $1,687.62; snowball 50 mo / $1,942.62; windfall 105 mo / $8,704.63; raise payment $757.31; zero-interest final payment $142.84; RAP / IBR unchanged. The late-loan plan is now **rejected by validation** (`validatePlannerPlan` → ok:false) with the id path `loans.late.disbursementDate` and a named message. The temporary-shortfall plan still returns paidOff with debt-free date 2034-03-20, plus the engine's "until payments increase" warning. |
| Skipped or focused tests | None (`.skip`, `.only`, `fixme` grep over src and e2e). |

Not run (as instructed): Playwright, including the new e2e test "review fixes" (e2e/journey.spec.ts:532).

### R2.2 Status of round-1 findings

| ID | Status | Evidence |
|---|---|---|
| M1 | **CLOSED** | Fixed in three layers. (1) validation.ts:494-505 now rejects a loan disbursed after repayment starts, at `loans.<id>.disbursementDate`, with the start date in the message. usePlannerDocument.ts:64-82 moves the error to `settings.graduationDate` / `settings.graceMonths` when a date or grace edit caused it. (2) The engine uses id paths and names the loan (projection.ts:42-47, 62-63). (3) planner.ts:351-392 `calculatePlannerOutputs` returns year summaries and the timeline even when repayment fails (`repaymentUnavailable`). ResultsSection.tsx:33-40 keeps gaps visible and links each error to its field; LoansSection.tsx:74-103 highlights the loan's date. Older stored or imported plans are repaired with a notice (storage.ts:87-140). Tests: review-fixes.test.ts:19-46, reviewFixes.test.tsx:61, 142, 171, storage.persistence.test.ts:210-240. |
| M2 | **CLOSED** | EventsSection.tsx:32-44 adds income events seeded with `raiseAllocationPercent` and the current salary. Lines 83-86 apply it when the type is switched to income, and line 58 states the default. Test: reviewFixes.test.tsx:23. |
| M3 | **CLOSED** | ResultsSection.tsx:93 sets `negative = status === 'notAmortizing'`. Other amortization warnings show the engine's own message (lines 118-120). Test: reviewFixes.test.tsx:41. |
| m1 | **CLOSED** | planner.ts:436-462 adds `scenarioFailures` with a reason, and the range becomes open-ended when any scenario fails. ResultsSection.tsx:258-263 lists them as "Can't be projected: ...". Test: review-fixes.test.ts:54. |
| m2 | **CLOSED** | registry.ts:46-48 `isStrategyId`. validation.ts:62, 301 uses registry ids. planner-contracts.ts:68 `StrategyId = string`. format.ts:57, 78-79 and ScenariosSection.tsx:108 derive from `listStrategies()`. Test: review-fixes.test.ts:80, reviewFixes.test.tsx:87. |
| m3 | **CLOSED** | LoansSection.tsx:41 uses `federalReference.interestRates.undergraduateDirect.rate`. Test: reviewFixes.test.tsx:93. |
| m4 | **CLOSED** | SchoolYearsSection.tsx:71-73, 130-136: the year total now equals `summary.costs`, with a separate "Cost items" line when expense events exist. Test: reviewFixes.test.tsx:100. |
| m5 | **CLOSED** | FederalSection.tsx:73, 96-100 and 240-255 (`federalShare`): the projection row is now federal Direct loans only for all three columns. The RAP message shows the model's own reason (line 88; secondary.ts:29-39). Test: reviewFixes.test.tsx:110. |
| m6 | **CLOSED** | planner.ts:282-301 deep-freezes memoized results. Grep found no write or in-place mutation of projection data anywhere in src: the only `.sort` is on a copy (ResultsSection.tsx:286), and `interestDifference` is written on fresh Comparison objects (planner.ts:431-432). Worker results are structured clones. Test: review-fixes.test.ts:87. |
| m7 | **CLOSED** | DataSection.tsx:17, 63: the second badge is rendered with `live={false}`, so only the header badge is a live region. Test: reviewFixes.test.tsx:118. |
| m8 | **CLOSED** | ConfirmDialog.tsx:28-38, 56-76: portaled to body; every other body child gets `inert` and `aria-hidden`, which are restored on close. Test: reviewFixes.test.tsx:124. |
| m9 | **CLOSED** | FederalSection.tsx:231-233 adds a "How is the debt-to-earnings ratio calculated?" note that states the principal-only debt basis. |
| m10 | **CLOSED** | fields.tsx:221 adds `aria-invalid` on CheckboxField. |
| m11 | **CLOSED** | `projectionUpdating` drives `aria-busy` plus an `is-recalculating` style (KeyFigures.tsx:7-11, ResultsSection.tsx:24). |
| m12 | **CLOSED** | vite.config.ts:7 adds data, state and integrations to coverage. check-money.mjs:4-5 adds policy, data and integrations, with a line-level `money-lint-allow:` escape (lines 12-14), used once. UI remains outside both. That is acceptable: UI money math uses decimal.js, and the only `parseFloat` is the chart's pixel coordinates. |
| m13 | **CLOSED (locally)** | .github/workflows/ci.yml runs `npm ci`, `npm run check` (typecheck, ESLint, money lint, tests, bench, build), coverage, and Playwright e2e on push and PR. It is not pushed, so it has never run. See n3. |
| m14 | OPEN (accepted, not a defect) | Unchanged: bounded module-level caches (dates.ts:22, planner.ts:289). |
| m15 | **CLOSED** | Disclaimer.tsx:11 lists school name, data year, field list and API key. Test: reviewFixes.test.tsx:137. |

### R2.3 New findings (introduced or exposed by the fixes)

No blockers or majors.

- **n1 (minor): numeric loan ids are mis-mapped to array positions.** planUpdates.ts:78-85 `fieldIdForPath` treats any `loans.<digits>.<field>` path as a legacy array index. Loan ids may be all digits (validation.ts ID_PATTERN `^[A-Za-z0-9_-]{1,100}$`, for example in a hand-edited import), and the engine now emits id paths. A loan with id `"1"` therefore gets its error attributed to `plan.loans[1]`, a different loan, in LoansSection.tsx:74-103 and ResultsSection's ProjectionErrorItem. Impact is low: UI-created ids are UUIDs or `id-...`, and validation now blocks the main error that reaches these paths. Fix: prefer an exact id match before the index fallback, or drop the legacy index handling now that the engine emits id paths.
- **n2 (minor, UX): shortening graduation is now blocked, and the message offers only one way out.** Regression check requested by the lead: the rejection is correct (the engine cannot project those plans) and the message is actionable. It appears at the graduation (or grace) field, names each loan with its date, and gives the computed repayment start: "Repayment would start 2028-11-20, before loan "Year 4 loan" (2029-08-24) is disbursed. Change the disbursement date first." (usePlannerDocument.ts:80; covered by reviewFixes.test.tsx:171). Two gaps remain. (a) The common cause is shortening school by a year, where the natural action is to remove the dropped year's loan, but the message only says to change the date. (b) It takes one edit per loan, then a re-edit of graduation. Suggested fix: add "or remove the loan" to the message, and optionally offer a one-click "move these loans to the repayment start" or "remove them" action with undo.
- **n3 (minor): the CI benchmark may be flaky.** The benchmark gates `npm run check` (planner.bench.ts: core `max < 30 ms`, comparisons `max < 200 ms`). A max-latency assertion on shared GitHub runners can fail on a GC pause or a noisy neighbor. Local max was 13.81 ms, so there is headroom, but consider asserting p99 only, or retrying. CI also pins Node `22`; Vite 8 needs 22.12 or later, which setup-node satisfies by resolving the latest 22.x.
- **n4 (minor, design note): auto-repair edits financial inputs.** storage.ts:87-140 moves a loan's disbursement date to the repayment start on load or import, with a notice, which lowers its in-school interest. It is reported in the save status, persisted only after the next edit, and limited to plans from older dev builds, so I accept it. A confirm step on import would be more conservative.
- **n5 (nit): dead defensive branch.** ui/results/comparison.ts:3-13 handles Comparison entries carrying an `error` field, which the engine never produces (failures go to `scenarioFailures`). This is harmless.

### R2.4 Integration re-check

- Edits still all go through `store.updatePlan` → reconcile/prune → `validatePlannerPlan` → commit (usePlannerDocument.ts:144-169). Disbursement errors now stop at the field, so a plan that validates but cannot be projected is only reachable via load or import of old data, and that path is repaired.
- The Projection is still never stored: `toPersistedPlan` whitelists inputs only.
- Frozen memo: no mutation found (see m6). The planner's try/catch would turn any accidental write into a "Complete valid plan values" failure rather than a crash.

### R2.5 Still not verified by me

Browser behavior (Playwright, axe, 360 px, keyboard, inert behavior in real browsers, worker), NFR-7 usability, CI actually running on GitHub, and policy values beyond the two round-1 spot-checks.
