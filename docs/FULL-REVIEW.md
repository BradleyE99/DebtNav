# Independent full-application review

Reviewed the entire SRS, shared planner contracts, coordination plan, pure projection/planner modules, persistence/validation, editable form implementation, policy reference/model, Scorecard adapter, and integration entry point. Review is independent and code-read-only; this report is the only reviewer-owned file.

## Findings sent to owners

| Finding | Requirement | Owner | Status |
|---|---|---|---|
| Planner supplies monthly budget and previously bypassed final contractual rounding adjustment, producing a possible 121st reference payment | US-503, US-504, NFR-2 | Engine | Fixed; final source guard inspected; owner regression120 payments/$10,877.41 |
| Final graduation-day school events/loans excluded from year summary but included in federal warnings | US-304, US-704, US-902 | Engine | Fixed; final source includes graduation-day loan/event in final year |
| Generic numeric editor accepted excessive decimal precision, zero term/horizon and values outside persistence bounds | NFR-11, US-1001 | UI | Fixed; final source precision/min/max and retained drafts inspected |
| Blank names/labels entered stored Plan without field-local validation | NFR-11, US-1001 | UI | Fixed; blank/long text retained in drafts |
| Removing school years left linked loans/events referring to removed IDs | US-101, US-1001 | UI/lead | Fixed; removed year links reconciled and scenario year overrides removed |
| Additional scenario overrides always stored strings, including numeric-typed fields; invalid values could mutate Plan | US-801, NFR-11 | UI | Fixed; scalar type conversion and effective candidate validation inspected |
| RAP household editor accepted1–50 while persistence accepted1–20 | US-1102, US-1001 | Lead | Fixed; editor and persistence both1–20 |
| Inline deletion alertdialog lacked initial/return focus and modal keyboard handling | US-1003, NFR-6 | UI | Fixed in source; initial Cancel focus, Tab trap, Escape, focus return; browser verification outstanding |
| RAP payment-allocation residual could exceed individual loan debt and waste cash | US-1102 | Lead | Fixed; bounded shares/residual redistribution inspected; lead reports4 policy tests |

Principal-matching concern was resolved by lead's authoritative source check: RAP reduces principal by at least the borrower amount paid, capped at $50; the implementation's target is consistent with that rule. This report does not independently assert a blanket $50 reduction.

## Architectural/privacy assessment

Money is represented as decimal strings and calculated using decimal.js. Projection remains derived and pure. Storage serializes the valid Plan and unfinished editor drafts, never Projection. Invalid imports preserve the active plan; unreadable saved data pauses automatic overwrite. Deletion targets only DebtNav's storage key. Scorecard sends only an explicitly requested public institution name/data year, with public DEMO_KEY, omitted credentials and no referrer; financial inputs are used only for the local ratio. No account/server storage, bank sync, lender rankings, deployment or push is introduced.

Policy references carry version/as-of/source metadata. RAP is a separate simplified constant-AGI comparison, excludes private loans, and describes eligibility limitations. Graduate loan-limit warnings intentionally avoid applying undergraduate limits to graduate programs. Scorecard live API correctness remains unverified because endpoint/document access failed and no browser surface is available; implemented parser/adapter alone does not establish US-1101 complete.

## Verification limits and release checks

Reviewer process launching failed with helper setup errors; source inspection used the available Node filesystem API. Engine owner reported55 passing engine tests after reference rounding fix; aggregate build, integration tests, benchmark and coverage must be confirmed by lead against final integrated source. Legacy App tests observed during review targeted the replaced initial form and require replacement.

Browser surfaces are unavailable. Actual click/clear/type/recalculate/reload/import/export/delete journey, keyboard navigation, screen reader behavior, print appearance,360px visual responsiveness and network inspection are **not passed** by this review. Static layout inspection and jsdom checks cannot replace those checks. Color contrast is not established by axe tests with that rule disabled. NFR-7 still requires5+ students; NFR-6 manual screen reader and NFR-8 visual checks remain outstanding.

No assertion of complete acceptance is made until owner corrections and final lead verification are recorded. No push, merge or deploy was performed.

## Final integration re-review

Re-inspected owner corrections in final source. Prior findings above are closed at source-review level. UI owner reports12 combined UI/App tests passing, including draft clear/type, reload, delete, corrupt-storage preservation, numeric scenario overrides, and removed-school-year references. Lead reports4 policy and3 Scorecard tests; aggregate checks are still lead-owned.

Final additional finding CLOSED: source now prunes scenario override paths and drafts for removed loans, costs, resources and events before shared validation. Inspected cleanup logic; UI owner reports removal regression covering all four record types passes. Numeric/text/date fields now each have stable aria-labelledby associations. UI owner reports8 UI +5 App tests and typecheck passing after these final corrections. No identified blocking source defect remains from this independent review.

Remaining external/manual acceptance dependencies: US-1101 needs successful real API/browser verification (network/docs access unavailable); NFR-6 requires real keyboard/screen reader/contrast checks; NFR-7 requires5+ student usability sessions; NFR-8 requires360px visual check. Full browser editable-input journey and network privacy inspection are unavailable; this affects verification confidence for US-701, US-1001–1003 and NFR-5 without implying the implemented source is absent. NFR-4/NFR-10 final benchmark/coverage results belong to lead verification.

Lead-reported final aggregate verification before the final removal regression:93 tests passed,99.55% engine line coverage, typecheck/production build/money lint passed. UI owner subsequently reports13 combined UI/App tests passing after cleanup; lead must rerun final aggregate checks if reporting an updated total. Reviewer did not independently execute process tests.

NFR-4 final benchmark qualification: lead reports mean71ms but maximum115ms and p99103ms, exceeding the strict100ms criterion. NFR-4 remains partial pending engine optimization and repeated final benchmark; passing an average gate alone does not establish the stated requirement.

## Final lead verification update

After the final fixes, lead reports96 tests across9 files passing, plus typecheck, production build and money lint. Optimized reference-plan benchmark independently rerun by lead: mean45.28ms, p9962.02ms, maximum65.84ms across64 samples. All observed samples satisfy100ms, so NFR-4 local engine measurement passes; real browser end-to-end responsiveness and CI benchmark remain outstanding. Vitest notes export-getter overhead in benchmark measurement. This supersedes the earlier partial performance result. Coverage scope now includes policy computations; final report is lead-owned. No pending source defect remains identified by this review.

## Final bounded policy/copy-forward review

Inspected RAP calendar overflow guard and PolicyPanel unavailable handling: oversized supported-calendar comparisons safely become unavailable rather than throwing through React. Copy-forward now uses the shared mutation/validation/record cleanup path, removing obsolete copied cost drafts and override references. New graduate annual USD20,500 warning reads versioned reference data and explicitly leaves aggregate/professional eligibility to the aid office. Graduate final-boundary finding CLOSED: inspected the final inclusive graduation-day condition, now aligned with undergraduate/planner membership. Lead added an assertion to the graduate regression and reports final99 tests passing. No identified source issue remains open.

Latest lead verification supersedes prior totals:99 tests pass, typecheck and production build pass, engine plus policy line coverage99.64%. Browser/manual accessibility,360px visual, five-student usability, network inspection and live Scorecard limitations remain unchanged.
