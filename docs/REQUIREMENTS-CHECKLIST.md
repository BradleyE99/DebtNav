# Requirements implementation and verification checklist

Implementation status and evidence are separate. Tests run locally; no merge/CI/deployment was performed. Browser surfaces are unavailable, so automated jsdom interaction is not a real browser pass.

| ID | Requirement | Implementation | Verification | Status / remaining limits |
|---|---|---|---|---|
| US-101 | Create a plan (Must) | src/ui/PlannerApp.tsx; src/engine/plan.ts; planner.ts | plan.test.ts; PlannerApp.test.tsx; App.test.tsx | Implemented; automated coverage plus source review. |
| US-102 | Set grace period (Must) | src/ui/PlannerApp.tsx; src/engine/plan.ts; planner.ts | plan.test.ts; PlannerApp.test.tsx; App.test.tsx | Implemented; automated coverage plus source review. |
| US-103 | Read the disclaimer (Must) | src/ui/PlannerApp.tsx; src/engine/plan.ts; planner.ts | plan.test.ts; PlannerApp.test.tsx; App.test.tsx | Implemented; automated coverage plus source review. |
| US-201 | Add cost items per year (Must) | src/ui/PlannerApp.tsx; src/engine/planner.ts | planner.test.ts; PlannerApp.test.tsx; App.test.tsx | Implemented; automated coverage plus source review. |
| US-202 | Copy a year forward (Should) | src/ui/PlannerApp.tsx; src/engine/planner.ts | planner.test.ts; PlannerApp.test.tsx; App.test.tsx | Implemented; automated coverage plus source review. |
| US-203 | Semester-level costs (Could) | src/ui/PlannerApp.tsx; src/engine/planner.ts | planner.test.ts; PlannerApp.test.tsx; App.test.tsx | Implemented; automated coverage plus source review. |
| US-301 | Add grants and scholarships (Must) | src/ui/PlannerApp.tsx; src/engine/planner.ts | planner.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-302 | Add part-time job income (Must) | src/ui/PlannerApp.tsx; src/engine/planner.ts | planner.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-303 | Add savings and family contributions (Must) | src/ui/PlannerApp.tsx; src/engine/planner.ts | planner.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-304 | See the borrowing gap (Must) | src/ui/PlannerApp.tsx; src/engine/planner.ts | planner.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-305 | Add a borrowing buffer (Could) | src/ui/PlannerApp.tsx; src/engine/planner.ts | planner.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-401 | Add a loan (Must) | src/ui/PlannerApp.tsx; src/engine/projection.ts; src/policy/reference.ts; federal.ts | projection.test.ts; planner.test.ts; federal.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-402 | Create loans from the borrowing gap (Should) | src/ui/PlannerApp.tsx; src/engine/projection.ts; src/policy/reference.ts; federal.ts | projection.test.ts; planner.test.ts; federal.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-403 | Model in-school interest (Must) | src/ui/PlannerApp.tsx; src/engine/projection.ts; src/policy/reference.ts; federal.ts | projection.test.ts; planner.test.ts; federal.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-404 | Capitalize interest at repayment (Must) | src/ui/PlannerApp.tsx; src/engine/projection.ts; src/policy/reference.ts; federal.ts | projection.test.ts; planner.test.ts; federal.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-405 | Federal loan limit warnings (Could) | src/ui/PlannerApp.tsx; src/engine/projection.ts; src/policy/reference.ts; federal.ts | projection.test.ts; planner.test.ts; federal.test.ts; App.test.tsx | Implemented undergraduate and graduate annual warning snapshot; graduate aggregate/transitional cases require aid-office eligibility determination. |
| US-501 | Enter post-graduation income (Must) | src/ui/PlannerApp.tsx; src/engine/projection.ts; planner.ts | projection.test.ts; planner.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-502 | See the monthly payment for each loan (Must) | src/ui/PlannerApp.tsx; src/engine/projection.ts; planner.ts | projection.test.ts; planner.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-503 | See the debt-free date and total interest (Must) | src/ui/PlannerApp.tsx; src/engine/projection.ts; planner.ts | projection.test.ts; planner.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-504 | View the amortization schedule (Must) | src/ui/PlannerApp.tsx; src/engine/projection.ts; planner.ts | projection.test.ts; planner.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-505 | Negative amortization warning (Must) | src/ui/PlannerApp.tsx; src/engine/projection.ts; planner.ts | projection.test.ts; planner.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-601 | Avalanche strategy (Must) | src/engine/strategies; planner.ts; src/ui/PlannerApp.tsx | planner.test.ts; projection.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-602 | Snowball strategy (Must) | src/engine/strategies; planner.ts; src/ui/PlannerApp.tsx | planner.test.ts; projection.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-603 | Custom payoff order (Should) | src/engine/strategies; planner.ts; src/ui/PlannerApp.tsx | planner.test.ts; projection.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-604 | Compare strategies (Should) | src/engine/strategies; planner.ts; src/ui/PlannerApp.tsx | planner.test.ts; projection.test.ts; App.test.tsx | Implemented actual comparisons; unconditional optimality guarantee not asserted for cent rounding/constraints. See discrepancies below. |
| US-605 | Pluggable strategy design (Must, technical) | src/engine/strategies; planner.ts; src/ui/PlannerApp.tsx | planner.test.ts; projection.test.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-701 | Instant recalculation (Must) | src/engine/planner.ts; src/ui/PlannerApp.tsx | planner.test.ts; planner.bench.ts; App.test.tsx | Implemented automatic updates; reference benchmark and DOM tests; real-browser latency pending. |
| US-702 | Add an income change event (Should) | src/engine/planner.ts; src/ui/PlannerApp.tsx | planner.test.ts; planner.bench.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-703 | Add a one-time windfall (Should) | src/engine/planner.ts; src/ui/PlannerApp.tsx | planner.test.ts; planner.bench.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-704 | Add a one-time expense or aid change (Should) | src/engine/planner.ts; src/ui/PlannerApp.tsx | planner.test.ts; planner.bench.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-705 | View the timeline (Should) | src/engine/planner.ts; src/ui/PlannerApp.tsx | planner.test.ts; planner.bench.ts; App.test.tsx | Implemented; automated coverage plus source review. |
| US-801 | Create a scenario (Should) | src/engine/planner.ts; src/data/validation.ts; src/ui/PlannerApp.tsx | planner.test.ts; storage.test.ts; PlannerApp.test.tsx; App.test.tsx | Implemented; automated coverage plus source review. |
| US-802 | Compare scenarios (Should) | src/engine/planner.ts; src/data/validation.ts; src/ui/PlannerApp.tsx | planner.test.ts; storage.test.ts; PlannerApp.test.tsx; App.test.tsx | Implemented; automated coverage plus source review. |
| US-901 | Balance over time chart (Should) | src/ui/PlannerApp.tsx; planner.css | PlannerApp.test.tsx axe; App.test.tsx; manual browser pending | Implemented; automated coverage plus source review. |
| US-902 | Year summary table (Must) | src/ui/PlannerApp.tsx; planner.css | PlannerApp.test.tsx axe; App.test.tsx; manual browser pending | Implemented; automated coverage plus source review. |
| US-1001 | Save automatically on this device (Must) | src/data/storage.ts; validation.ts; App.tsx; src/ui/PlannerApp.tsx | storage.test.ts; App.test.tsx; real browser download/upload pending | Implemented; automated coverage plus source review. |
| US-1002 | Export and import (Should) | src/data/storage.ts; validation.ts; App.tsx; src/ui/PlannerApp.tsx | storage.test.ts; App.test.tsx; real browser download/upload pending | Implemented; automated coverage plus source review. |
| US-1003 | Delete my data (Must) | src/data/storage.ts; validation.ts; App.tsx; src/ui/PlannerApp.tsx | storage.test.ts; App.test.tsx; real browser download/upload pending | Implemented; automated coverage plus source review. |
| US-1101 | Debt-to-earnings check (Could) | src/PolicyPanel.tsx; src/policy; src/integrations/scorecard.ts | federal.test.ts; scorecard.test.ts; live API pending | Adapter and unavailable state implemented; live response/CORS/schema not verified (official documentation fetch403, API tool inaccessible, no browser). |
| US-1102 | Federal repayment plan modeling (Could) | src/PolicyPanel.tsx; src/policy; src/integrations/scorecard.ts | federal.test.ts; scorecard.test.ts; live API pending | Implemented sourced simplified RAP comparison; standard projection remains distinct; no eligibility/tax guarantee or unsupported IBR simulation. |

| NFR | Implementation / evidence | Verification status |
|---|---|---|
| NFR-1 | Decimal string types, isolated decimal.js engine, half-up cent transactions, money lint | Passed unit/property/golden and money lint. SVG coordinates convert only display values to numbers. |
| NFR-2 | Independent BigInt golden full120 rows and planner reference | Passed to cent; final341.25, total interest10877.41. |
| NFR-3 | Conservation, nonnegative balance, extra-payment monotonicity properties; targeted rollover/long-term tests | Passed tested domains; no exhaustive all-input proof claimed. |
| NFR-4 | Dedicated four-year/eight-loan/360-month complete-comparison benchmark | After safe Decimal allocation optimizations, lead measured mean45.28ms, p9962.02ms, max65.84ms across64 samples. All observed reference samples pass100ms; browser paint/validation/save and CI latency are unmeasured. Vitest reports export-getter overhead. |
| NFR-5 | Local-only plan storage; no analytics; optional Scorecard query sends school/year only, omits credentials and referrer | Source review and request-contract tests pass; real browser network inspection unavailable. |
| NFR-6 | Semantic forms, labels/errors, keyboard reorder, focus-trapped deletion dialog, SVG text/table equivalents | Axe and keyboard component tests pass; contrast, screen reader, real browser keyboard and full WCAG audit outstanding. |
| NFR-7 | Connected workflow and editable defaults | Five-student under-five-minute usability sessions require human participants; not performed. |
| NFR-8 | Responsive grid, wrapping, local overflow tables at600px breakpoint | CSS review only; no available browser for360px visual/scroll inspection. |
| NFR-9 | Formula/assumption disclosures beside borrowing, repayments, comparisons, RAP | Source reviewed; manual explanation usability pending. |
| NFR-10 | Pure engine with no React imports; V8 enforced90% lines | Latest full run99.64% engine and policy lines. |
| NFR-11 | Validated candidate plan + persisted raw drafts, field errors, untrusted JSON validation, storage failure notices | Editing, malformed import, dates, precision, removal/reference and storage tests pass; no exhaustive arbitrary-input proof claimed. |

## Mathematical and modeling decisions

- A12-calendar-month interval spanning leap day has366 actual days. The explicit actual-days/365 rule takes precedence over a blanket300-dollar example; exactly365 days produces300.00 for5000 at6%.
- The SRS repayment reference is correct when the final installment is adjusted:119 payments340.64 plus final341.25 yields10877.41 interest. No forced incorrect expected value is used.
- Universal avalanche optimality is not treated as a proof over all cent-quantized plans, payment constraints and dated events. The app displays each actual computed result neutrally; comparisons identify the lowest computed completed interest. Tests validate ordering and representative outcomes rather than fabricate a universal result.
- Standard engine follows SRS capitalization by default and offers an explicit override; uncapitalized school interest remains payable, without interest on that interest. Federal eligibility/current servicer treatment is separate from those modeling assumptions.
- RAP is a separate constant-AGI, single-borrower Direct-loan comparison with on-time payments, current-interest subsidy and matching principal up to the amount paid (maximum50). It does not model spouse debt, past qualifying counts, tax liability or future eligibility changes.

## External and human dependencies

US-1101 live verification needs an available browser/network path to College Scorecard and publishable institution/program earnings. The public demo key is not secret but is rate limited; higher-volume private-key hosting would require infrastructure beyond this local-only app. No private key is accepted in client code.

NFR-6/8 and the complete real-browser journey need an available browser surface. NFR-7 needs five student participants. CI merge Definition of Done remains user-owned because push/merge/deploy were explicitly prohibited. Print CSS is implemented; actual print preview is unverified.
