# Software Requirements Specification — DebtNav: Student Debt Planner

Author: Bradley J. Elder · Version 0.2 (Draft) · Date October 16, 2026 · Status: Draft for review

> Saved verbatim in substance from the requirements the user supplied on 2026-10-16. Section 13 (October 16
> scope update) supersedes conflicting earlier assumptions (local-only/account-free storage, automatically
> expiring undo, calendar-year grouping, federal-tool implementation). Section 15 (October 19, optional Google
> sign-in) supersedes every requirement that Google sign-in is needed to create, edit or calculate a plan.
> `docs/REQUIREMENTS.md` is v0.1.

## 1. Purpose
### 1.1 Problem statement
Self-funded students can't easily see how today's borrowing, income, and aid decisions affect when they'll be debt-free. Existing tools split "how much to borrow" and "how fast can I repay" into separate calculators and force users to recalculate from scratch whenever their situation changes.
### 1.2 Product vision
DebtNav answers two questions: (1) how much do I need to borrow for college? (2) when will I be debt-free given my loans, earnings and chosen payments? It has four primary destinations: Introduction, College Costs, Loan Amounts and Results. Results is the single place to understand and adjust repayment (see §14, which supersedes earlier navigation requirements).
### 1.3 Goals
- G1: Easily calculate annual school costs minus non-loan resources, loan funding already allocated, and additional funding still needed.
- G2: Easily calculate repayment duration, debt-free date, and interest from loans and the chosen monthly payment.
- G3: Calculate the monthly payment needed to meet a user-selected payoff date or duration.
- G4: Clearly identify missing information and link directly to its input.
- G5: Let anyone plan without an account (saved on their browser when possible); save signed-in users' plans securely across sessions and devices (§15).
### 1.4 Non-goals
- Recommending, ranking, or linking to specific lenders.
- Telling users how much they should borrow. The app calculates; the user decides.
- Connecting to bank accounts or loan servicers.

## 2. Scope (MoSCoW summary)
| Priority | Included |
|---|---|
| Must | Plan setup, per-year costs, aid and income, borrowing gap, loans (federal subsidized/unsubsidized, private), in-school interest accrual, repayment projection, avalanche and snowball strategies, instant recalculation, guest planning without an account, optional Google sign-in, authenticated server persistence, Excel template/import/export, target-payoff payment calculation, academic-year loan assignment, persistent undo |
| Should | Life events, custom payoff order, strategy comparison, scenarios (conservative vs. expected), balance-over-time chart, export/import |
| Could | Debt-to-earnings check via College Scorecard API, print view |
| Won't (v1) | Lender rankings, bank syncing, mobile native app; federal tools deferred behind Coming soon |

## 3. Glossary
- Cost of attendance: total yearly cost of school: tuition, fees, housing, food, books, transportation, personal.
- Resources: money available to pay costs without borrowing: grants, scholarships, job income, savings, family help.
- Borrowing gap: max(0, cost of attendance − resources) for a given year.
- Subsidized loan: federal loan where interest does not accrue while the student is enrolled at least half-time or during grace.
- Unsubsidized loan: loan where interest accrues from disbursement, including while in school.
- Grace period: time after leaving school before repayment begins (6 months for federal Direct Loans).
- Capitalization: unpaid accrued interest is added to the principal, so future interest is charged on it.
- Amortization schedule: month-by-month table of payment, interest, principal, and remaining balance.
- Avalanche: extra money to the highest-interest loan first. Minimizes total interest.
- Snowball: extra money to the smallest-balance loan first. Faster early wins; usually costs more interest.
- Life event: a dated change to the plan, such as a new job, raise, bonus, or new grant.
- Scenario: a copy of the plan with different assumptions, used for comparison.
- Projection: all calculated outputs for a plan. Always derived from inputs, never stored.

## 4. Personas
- Alex, the self-funded student (primary): sophomore paying alone, part-time work with changing hours, grants that change yearly. Needs to know how much to borrow this year and what it means after graduation, without spreadsheets. Frustration: redoing the math whenever hours, aid, or tuition change.
- Jordan, the recent graduate: federal and private loans; salary known, raises/bonuses uncertain. Needs a realistic debt-free date and "what if I put my bonus toward loans?". Frustration: servicer sites show one loan at a time.
- Sam, the method-driven planner: follows a specific philosophy (e.g. debt snowball). Needs to use their method while seeing the trade-off. Frustration: tools that pick one method and hide the trade-off.

## 5. Domain Model
```
Plan
 ├── settings        (start date, graduation date, grace months, currency)
 ├── schoolYears[]   → costItems[], resources[]
 ├── loans[]         (name, type, principal, rate, disbursement date)
 ├── postGradIncome  (salary, monthly amount available for debt)
 ├── lifeEvents[]    (date, type, amount, recurring?)
 ├── strategy        (avalanche | snowball | custom order)
 └── scenarios[]     (overrides applied on top of the base plan)

calculateProjection(plan) → Projection
 ├── borrowingGapByYear[]
 ├── balanceAtRepaymentStart
 ├── amortizationSchedule[]  (per loan, per month)
 ├── debtFreeDate
 └── totalInterestPaid
```
Design principle: derived state. Store inputs, compute outputs. Never store a computed result.

## 6. Functional Requirements: User Stories
Each story has an ID, priority, and acceptance criteria. Labels: epic:<name>, priority:must|should|could, type:story.

### Epic 1: Plan Setup
- **US-101 Create a plan (Must).** Start and graduation dates create one school year per academic year in range. Graduation before start → validation error, plan not created. Changing graduation adds/removes years and keeps data in remaining years.
- **US-102 Distinguish chosen payments and required payments (Must).** Users choose a voluntary payment start date independently of graduation and grace. Show the estimated first required payment date per loan. Default applicable federal Direct loan modeling to six months after graduation, clearly identifying assumptions and allowing actual due-date overrides. Private/other loans use their own configured terms; no universal six-month assumption. Starting voluntarily early does not alter grace, subsidy, capitalization, or contractual due dates. Late starts show missed-obligation warnings; the projection never implies permission to skip required payments. Dates cannot precede disbursement. Retain date-based accrual and apply early payments using the documented engine rules.
- **US-103 Read the disclaimer (Must).** First open shows a notice that results are estimates, not financial advice; after dismissing it remains accessible from the footer.

### Epic 2: Cost of Attendance
- **US-201 Add cost items per year (Must).** Categories tuition, fees, housing, food, books, transportation, personal, other; label; amount. Total updates immediately. Negative/non-numeric → field error, total unchanged. $12,000 + $9,500 + $1,200 → $22,700.00.
- **US-202 Copy a year forward (Should).** Year 1 total $20,000 copied to Year 2 with 3% → items × 1.03, total $20,600.00.
- **US-203 Semester-level costs (Could).** Fall $10,000 + Spring $10,500 → $20,500.00.

### Epic 3: Aid, Income, and Borrowing Gap
- **US-301 Grants and scholarships (Must).** $4,000 grant in Year 1 → resources +$4,000.00, gap −$4,000.00 (not below $0).
- **US-302 Part-time job income (Must).** $15.00 × 15 h × 30 weeks → $6,750.00; fixed yearly amount alternative; percentage unavailable for school reduces the counted share.
- **US-303 Savings and family contributions (Must).** $2,000 savings in Year 1 → resources +$2,000.00.
- **US-304 See the borrowing gap (Must).** Cost $22,700, resources $12,750 → gap $9,950.00. Resources > cost → gap $0.00 and surplus shown separately. Gap labeled as a calculation, not a recommendation.
- **US-305 Borrowing buffer (Could).** $9,950 gap + 5% → $10,447.50, labeled "gap + your buffer."

### Epic 4: Loans
- **US-401 Add a loan (Must).** Types Federal Direct Subsidized, Federal Direct Unsubsidized, Private, Other. Rate outside 0–30% → error. Valid loan appears and total debt updates immediately.
- **US-402 Create loans from the borrowing gap (Should).** Year 2 gap $9,950 → loan form pre-filled with $9,950 and Year 2 disbursement date. Later gap changes don't change the loan; a mismatch notice shows.
- **US-403 Model in-school interest (Must).** $5,000 unsubsidized at 6% disbursed 12 months before repayment → $300.00 accrued (simple). Subsidized → $0.00 during school and grace. Private accrues from disbursement unless set otherwise.
- **US-404 Capitalize interest at repayment (Must).** $5,000 + $300 → $5,300.00 balance. "I pay interest while in school" → nothing capitalizes; payments shown as a monthly cost.
- **US-405 Federal loan limit warnings (Deferred; not current release).**

### Epic 5: Repayment Projection
- **US-501 Repayment Plan earnings and payment budget (Must).** Repayment Plan owns stored post-graduation salary, optional take-home income and expenses, and monthly debt budget. Earnings links elsewhere open this same source of truth; do not duplicate stored fields. Clearly distinguish gross salary, take-home income, and chosen debt payment. Do not infer taxes or spend the entire salary. Show minimum-payment shortfalls and affordability comparisons only when sufficient budget information exists.
- **US-502 Monthly payment per loan (Must).** $30,000 at 6.5% over 120 months → $340.64. M = P × r / (1 − (1 + r)^−n), r = annual rate / 12.
- **US-503 Debt-free date and total interest (Must).** $30,000 at 6.5% at $340.64/month → 120 payments, total interest within $1.00 of $10,877.41. Updates without reload.
- **US-504 Amortization schedule (Must).** Month, payment, interest, principal, remaining balance (per loan and combined). Final payment adjusted to end at $0.00. Principal paid = starting balance to the cent.
- **US-505 Negative amortization warning (Must).** Payment < one month's interest → warning, no debt-free date.

### Epic 6: Payoff Strategies
- **US-601 Avalanche (Must).** Highest rate first; ties by smallest balance; paid-off minimums roll forward.
- **US-602 Snowball (Must).** Smallest balance first; ties by highest rate; roll forward.
- **US-603 Custom payoff order (Should).** Extra payments follow the custom order exactly.
- **US-604 Compare strategies (Should).** Debt-free date, total interest, months until first payoff; difference from the lowest-interest strategy; neutral language; invariant avalanche interest ≤ others.
- **US-605 Pluggable strategy design (Must, technical).** orderLoans(loans, month) → Loan[]; a new strategy = one file + one registry entry.

### Epic 7: Life Events and Dynamic Updates
- **US-701 Instant recalculation (Must).** < 100 ms for 4 years, 8 loans, 30-year horizon. No Calculate button.
- **US-702 Income change event (Should).** Raise $55,000 → $65,000 on Jan 1, 2031 with X% to debt → payments increase from that month.
- **US-703 One-time windfall (Should).** $3,000 bonus June 2029, 100% to debt → lump sum that month per strategy; UI shows months moved and interest saved.
- **US-704 Expense or aid change (Should).** New $1,500 grant in Year 3 → Year 3 gap −$1,500.00.
- **US-705 Timeline (Should).** School years, graduation, repayment start, events, loan payoffs, debt-free date in order.

### Epic 8: Scenarios
- **US-801 Create a scenario (Should).** Starts identical; only changed fields stored as overrides; base edits flow to non-overridden fields.
- **US-802 Compare scenarios (Should).** Debt-free date and total interest per scenario; range summary line.

### Epic 9: Visualization
- **US-901 Balance over time chart (Should).** One line per scenario/strategy; text/table equivalent.
- **US-902 Year summary table (Must).** Per-year cost, resources, gap, amount borrowed.

### Epic 10: Data Persistence
- **US-1001 Account-based automatic saving (Must).** *First sentence superseded by §15 (US-1501, US-1502): no sign-in is needed to create or edit a plan; guests save on their browser, signed-in users save to their account.* ~~Google authentication is required to create and persist an owned plan.~~ Save validated input changes to the authenticated user's server-side plan, with visible saving/saved/offline/error states and retries. Returning users and users on another device recover their latest saved plans. Local cache is optional and never presented as a successful server save. Prevent cross-account cache leakage. Resolve concurrent updates through explicit version checks and conflict handling rather than silent overwrite.
- **US-1002 Export and import (Should).** Versioned JSON export. Invalid/older files show a clear error or migrate; never corrupt the current plan.
- **US-1003 Delete my data (Must).** Confirm destructive deletion and remove the user's server records and local caches. Explain deletion scope and documented backup-retention behavior. Sign-out alone does not delete saved plans.

### Epic 11: Could-Have Extensions
- **US-1101 Debt-to-earnings check (Could).** College Scorecard API; source and data year next to every figure.
- **US-1102 Federal repayment plan modeling (Deferred; not current release).**

## 7. Non-Functional Requirements
| ID | Category | Requirement | Verified by |
|---|---|---|---|
| NFR-1 | Accuracy | Decimal arithmetic for all money; round to cents at each payment. | Unit tests; money lint |
| NFR-2 | Accuracy | Match a reference amortization calculator within $0.01 per payment. | Golden-file tests |
| NFR-3 | Correctness | Balances never negative; principal paid = starting balance; more payment never means more months. | Property tests |
| NFR-4 | Performance | Recalculation < 100 ms for the US-701 reference plan. | Benchmark |
| NFR-5 | Privacy | Financial inputs only to the authorized backend and required storage providers. No financial-input analytics or AI-provider transmission by default. HTTPS, per-user authorization, protected secrets, documented retention and deletion. | Code review; network inspection |
| NFR-6 | Accessibility | WCAG 2.1 AA; full keyboard navigation; charts have text alternatives. | axe-core; manual screen reader |
| NFR-7 | Usability | First-time user gets a borrowing gap and debt-free date in < 5 minutes. | Usability test, 5+ students |
| NFR-8 | Responsiveness | Usable at 360 px without horizontal scrolling. | Manual and visual tests |
| NFR-9 | Transparency | Every calculated figure has a "How is this calculated?" explanation. | Review checklist |
| NFR-10 | Maintainability | Pure engine with no UI dependencies; ≥ 90% line coverage. | Coverage report |
| NFR-11 | Reliability | Invalid input never crashes the app; field-level errors. | Fuzz and component tests |

## 8. Calculation Rules and Assumptions
1. gap = max(0, Σ costs − Σ resources) per school year.
2. In-school accrual (unsubsidized and private): simple interest = principal × annual rate × days / 365.
3. Subsidized: no accrual while enrolled or in grace.
4. Capitalization: accrued unpaid interest added to principal at repayment start.
5. M = P × r / (1 − (1 + r)^−n), r = annual rate / 12, default n = 120.
6. Monthly interest during repayment: balance × annual rate / 12 (v1 approximation).
7. Extra payments after all minimums, in strategy order; paid-off minimums roll forward.
8. Round half-up to cents per transaction; final payment absorbs the remainder.
9. Reference data versioned with a source and "as of" date.
Real servicers may differ; the disclaimer must say so.

## 9. Proposed Technical Approach
TypeScript; React + Vite; pure TypeScript engine; decimal.js; date-fns; Recharts; React state + one useMemo(calculateProjection); storage: server-side database through an authenticated backend with optional local cache; authentication: Google OpenID Connect through a maintained auth library/provider; hosting: frontend plus hosted backend/serverless API (authenticated persistence, migrations, health checks, deployment docs); testing: Vitest, fast-check, React Testing Library, axe-core; CI/CD: GitHub Actions → Vercel.

## 10. Release Plan
M1 Engine core · M2 Borrowing phase UI · M3 Repayment and strategies · M4 Dynamic planning · M5 Polish and launch ·
**M6 Account and workflow upgrade:** target payoff, dates, academic-year loans, Excel exchange, persistent undo, Overview, Google auth and server persistence — US-406, 506–507, 903–905, 1004–1006, 1201–1202. Later: US-203, 305, 405, 1101, 1102.

Definition of Done: acceptance criteria pass as automated tests where possible; engine changes include unit tests; money changes include a property test; no axe-core violations; reviewed and merged through CI.

## 11. Open Questions
1. Final product name. 2. Hosting selection (backend, managed database, auth provider, budget). 3. Monthly vs daily interest precision. 4. Which 5–10 students test M2/M3. 5. Who updates reference data and how staleness is shown.

## 12. Out of Scope Rationale
Lender rankings (personalized rates, advice liability); bank syncing (third-party agreements, security); federal tools deferred — the Federal dashboard shows only Coming soon; federal loan types and existing general loan calculations remain supported.

## 13. October 16 scope update and acceptance criteria
This revision supersedes conflicting local-only, account-free, automatic-expiring undo, calendar-year grouping, and federal-tool implementation assumptions. Existing unrelated requirements remain applicable.

### US-406: Academic-year loan assignment (Must)
- Create/edit loans with an Academic year selector, using stable school-year IDs and labels such as 2026–2027.
- Select existing plan years, add a valid academic-year range, or choose Unassigned.
- Show assignment in collapsed loan summaries; optionally group loans into collapsible academic-year sections with count and total principal.
- Assignment controls annual borrowing allocation, not disbursement dates or interest math. Each loan is counted once.
- Existing assignments are preserved; infer legacy assignment only if unambiguous, otherwise Unassigned. Persist through account saving and both import/export formats.
- Preserve compact expandable cards, edits, and mobile/keyboard accessibility.

### US-506: Target payoff and required monthly payment (Must)
- Replace the user-facing Projection horizon control with Pay off by date or Pay off within N years/months in Repayment Plan.
- Two modes: choose a monthly budget and see payoff; choose a payoff target and see the calculated monthly budget required.
- Calculate against the same multi-loan simulation, strategy, dates, minimums, and configured events. A numerical solver may be used; round upward to cents and verify the target is met.
- Zero-rate $12,000 balance, 12 payments → $1,000 monthly. Independently verify interest-bearing and multi-loan cases.
- Show required payment, chosen payment, difference, estimated outcome, and affordability context when available. Never silently change the user's chosen budget.
- Reject past/invalid targets and identify infeasible targets or missing inputs. Explain fixed assumptions and event treatment.
- Retain an internal simulation safety cap; reaching it means payoff not found within the modeled limit, not debt forgiven or paid off.

### US-507: Payment timing (Must)
Implements revised US-102 with separate voluntary start and estimated required-payment dates per loan. Results show both and explain grace-period behavior. Early payments reduce applicable balances through the engine; late voluntary starts retain required obligations and show warnings. Verify relevant current official loan rules before implementation.

### US-903: Overview as an introduction and navigation hub (Must)
- Briefly describe DebtNav and its two primary tasks: annual borrowing and repayment planning.
- Clear links/cards to Loans, How much I make, Repayment Plan, Results, and Costs.
- How much I make opens the appropriate income controls; post-graduation earnings live in Repayment Plan. In-school earnings remain tied to school-year resources.
- Overview does not duplicate Results charts/tables.
- *Superseded by §14 (US-1301):* the Overview becomes the Introduction destination; the sidebar and separate dashboards for income, repayment, events, scenarios, federal and data are replaced by four tabs.

### US-904: Persistent undo (Must)
- Undo controls do not disappear after five seconds or any automatic timer.
- Stable, keyboard-accessible Undo/history control for supported edits and deletions; clearly disabled when nothing is available.
- Retain undoable actions for the active plan session until used, explicitly cleared, or the session ends; no cross-session history promise.
- Undo restores related records consistently and saves the reversal to the server. Protect against stale/conflicting server versions.
- Import replacement can be undone in the active session. Account deletion remains explicitly confirmed and is not represented as reversible.

### US-905: Federal placeholder (Must)
*Superseded by §14 (US-1301): the Federal page is removed from the interface; stored federal data and federal loan types remain.*
- Federal dashboard displays only Coming soon; existing federal controls, calculators and reference tables removed from that page.
- Do not delete stored federal loan records or remove federal loan types/general calculations.
- Defer US-405 and US-1102; no new federal integrations in this release.

### US-1004: Versioned Excel template and export (Must)
- Your Data offers Download blank Excel template, Export my data (.xlsx), and Import Excel alongside existing JSON exchange.
- Template supports user-selected initial row counts for years and loans, with extensible structured tables; users can add rows without a fixed application limit other than documented file/resource limits.
- Canonical workbook schema covering every editable plan field: Settings, SchoolYears, Costs, Resources, Loans, RepaymentPlan, LifeEvents, Scenarios, ScenarioOverrides, CustomOrder; plus Instructions and Metadata/schema version.
- Stable IDs and foreign-key columns; repeatable rows represent repeatable records, not fixed year-numbered columns.
- Document every column, required/optional status, enum, date format, currency and rate units; zero versus blank; academic-year vs disbursement-date distinction.
- Dropdown validation where practical, readable formatting, examples clearly excluded from imported records.
- Account IDs, credentials, OAuth tokens and secrets are never exported.
- Scenario overrides and nested fields have a documented lossless representation.

### US-1005: Safe Excel import (Must)
- Parse and validate server-side before saving: schema, types, ranges, dates, unique IDs, references, ownership and file size.
- Ignore blank rows; inspect all populated rows including rows beyond the initial template size.
- Errors by sheet/row/column and a preview with record counts. Full-plan replacement only after explicit confirmation; never silently merge.
- Validate all records before an atomic commit. Invalid imports leave the existing plan unchanged.
- Reject unsupported versions or migrate known older versions explicitly.
- Never execute workbook formulas/macros or trust cached formula results for required inputs. Reject macro-enabled files and formula-bearing input cells with clear guidance.
- Escape text that could become spreadsheet formulas on export.
- Export-import-export preserves semantically equivalent inputs and calculated outcomes, including academic-year assignments and scenarios.

### US-1006: Annual borrowing clarity (Must)
- Funding gap = max(0, costs − non-loan resources).
- Already allocated loan principal and remaining unfunded = max(0, gap − allocated loan principal).
- Surplus shown separately; never double-count loan money as resources.
- Borrowing-only and existing-loan repayment workflows operate independently.
- Results identify missing inputs with direct links; a valid entered zero is not missing.

### US-1201: Google sign-in and account ownership (Must)
- *Superseded by §15 (US-1501):* ~~Users sign in with Google before creating an owned plan; public Overview accessible without login.~~ Sign-in is optional: it is needed only to save a plan to an account. The whole planner works without it.
- Sign-in, callback, session restoration, sign-out, cancellation and authentication failures.
- Maintained OpenID Connect/auth tooling with server-validated identity, state/nonce/PKCE and secure sessions; no custom OAuth cryptography.
- Users access only their own records, including imports, exports and nested entities; enforced on every backend route.
- Existing local plans offered for explicit migration after login; never automatically attach another user's cached plan. *Detailed by §15 (US-1503): the browser's guest plan is offered, never uploaded or merged without an explicit choice.*
- Document credential setup and redirect URLs. Missing credentials produce a clear setup state, not fake authentication.

### US-1202: Hosted backend and durable database (Must)
- Production-capable frontend plus backend/serverless API and managed relational database (PostgreSQL preferred).
- Database access through backend code or a managed SDK, not an MCP connector. No privileged database credentials in browser code.
- Store versioned Plan inputs with owner ID, timestamps and concurrency revision; projections remain computed.
- Migrations, env examples without secrets, local setup, deployment configuration, HTTPS/session configuration, health checks, backup/restore documentation and retention/deletion policy.
- Saves survive closing the app, signing back in, server restart and another-device session.
- Authorization tests for cross-user access; concurrency/offline/error tests.
- Prepare deployment artifacts and document external credential/infrastructure blockers; do not publish or purchase infrastructure without authorization.

### Updated domain and operational constraints
Plan adds academic-year references, repaymentPlan (earnings, selected budget, target payoff and voluntary start), and per-loan required-payment settings. Account ownership is enforced by the server and excluded from portable files. Database amounts use exact numeric/decimal or documented lossless strings; dates use explicit calendar-date semantics. Target payment solving must not block the UI; benchmark it separately from ordinary projection recalculation. Network saves may be debounced; show unsaved state and flush appropriately. Authenticated API validation, rate/file-size limits, secret handling, and error reporting without financial inputs in logs.

## 14. October 17 simplification: four destinations (supersedes conflicting navigation requirements)
DebtNav is refocused on borrowing needs and the debt-free date. This section supersedes the retractable-sidebar and separate-dashboard requirements in US-903, the Federal dashboard in US-905, and any requirement that places income, repayment, life-event, scenario or data screens in primary navigation. Calculation, persistence, authentication, import/export and undo requirements are unchanged. No stored data is removed because its screen is hidden.

### US-1301: Four primary destinations (Must)
- Primary navigation has exactly four items: Introduction, College Costs, Loan Amounts, Results.
- Old links (`#setup`, `#income`, `#repayment`, `#events`, `#scenarios`, `#federal`, `#data`) land on the destination that now holds those inputs.
- Export/import (JSON and Excel), template, data deletion, undo history, the disclaimer and sign-out are in a compact account menu, not a fifth destination. Undo stays persistent and keyboard accessible.
- Scenarios, federal settings, custom payoff order, extra payment and all life events stay stored, exported and imported even when their screens are hidden.
- Short labels, at most one line of helper text per field, progressive disclosure; no setup wizard. Works with keyboard, at 360 px and at 200% zoom without horizontal scrolling.

### US-1302: Introduction (Must)
- *Superseded by §15 (US-1501):* ~~Public page: one-sentence description of the two questions and Sign in with Google.~~ Everyone sees a guest-friendly introduction with **Start planning** as the primary action and **Sign in with Google to save across devices** as a secondary action. It is not a login screen.
- Signed in: short introduction and a clear action to start or resume the plan. No detailed results or calculations.

### US-1303: College Costs (Must)
- Academic-year selector (e.g. 2026–2027) instead of stacking every year; school start and graduation dates editable here.
- Costs, grants/scholarships/savings/other non-loan resources, in-school earnings that count toward that year, and one-time aid or cost changes for that year.
- Shows total cost, non-loan resources, funding gap = max(0, cost − resources), loans allocated to the year, and remaining unfunded = max(0, gap − allocated). Surplus is shown separately; the funding gap and the additional borrowing still needed stay distinct.

### US-1304: Loan Amounts (Must)
- Compact expandable loan cards with name, type, principal, rate, disbursement date and academic-year assignment; optional grouping by academic year.
- Academic-year assignment is separate from the disbursement date used for interest. Required-payment terms and other advanced settings are available without crowding the main form.

### US-1305: Results as the repayment workspace (Must)
- Headline figures: total modeled debt, chosen monthly payment, projected debt-free date, time until debt-free (from today), total projected interest.
- Compact expandable sections: post-graduation earnings and amount available for debt; repayment start and required-payment timing; bonuses and one-time extra payments (with the portion applied to debt); dated income changes, raises or job changes (an income change changes debt payments only through a visible allocation rule or a user-chosen payment change); optional payoff target. One source of truth for each input; no duplicate controls elsewhere.
- Incomplete inputs: a short checklist with direct links to the fields; no misleading zero results or fabricated debt-free date.

### US-1306: Yearly breakdown (Should)
- "View yearly breakdown" in Results, with a choice of years to display including "Until debt-free".
- Rows summarise the actual monthly projection (no second calculation). The table says whether years are calendar or repayment years and shows year, starting balance, payments, interest charged, principal reduction and ending balance; bonus payments are shown as part of payments, never added twice; income is shown where useful, labelled gross or take-home.
- The full table ends at the projected payoff, including a partial final year. Choosing fewer years never changes the calculated payoff. If payoff is not reached within the simulation limit, the table says so and shows the remaining balance instead of a date.
- The monthly schedule stays available but secondary.


## 15. October 19 update: optional Google sign-in (supersedes login-required requirements)
Google sign-in becomes optional. Everyone can use every planning and calculation feature without an account; signing in adds saving to an account and access from other devices. This section supersedes the first bullet of US-1201, the public-page bullet of US-1302, the first sentence of US-1001, and any other wording that requires sign-in before creating, editing or calculating a plan. Calculations, academic-year loan assignments, import/export formats and the four-destination interface (§14) are unchanged. Server-side authorization is unchanged: every account endpoint still requires a session.

### US-1501: Guest planning (Must)
- College Costs, Loan Amounts, Results and all their editing controls work without sign-in. The Introduction is a guest-friendly welcome, not a login screen: **Start planning** is the primary action and **Sign in with Google to save across devices** is secondary (disabled, with an explanation, when sign-in is not set up or the server is unreachable).
- A guest plan is saved in this browser's local storage when it is available and the status says exactly: "Saved on this browser. Sign in to access your plan on other devices."
- If storage is unavailable or a save fails (private browsing, blocked site data, full quota, over 5 MB), the app keeps working and says truthfully that changes are not saved; it never claims a guest plan is saved when it is not.
- JSON export and import work for guests. Excel template/import/export stay account-only because they run on the server; guests are told they need an account and nothing is uploaded.
- Guest mode never creates a server-side plan and never sends guest financial inputs to the server for persistence (no `/api/plan` or `/api/workbook` requests).
- The guest account menu shows "Not signed in (guest)" and holds Your data, Undo history, About these estimates and Sign in with Google; there is no Sign out. A guest's Delete removes only the plan saved on this browser.
- Guest mode is also used when sign-in is not configured on the server, when the authentication service is unreachable, and when an account plan cannot be loaded and the user chooses to continue with this browser's plan. Authentication problems are shown as non-blocking notices.

### US-1502: Optional Google sign-in and account saving (Must)
- Existing Google authentication, accounts and saved plans are preserved without migration.
- Signed-in users save to their account and recover the plan on other devices. Status text distinguishes browser saving ("Saved on this browser…") and pending edits ("Saving on this browser…" vs "Changes not yet saved to your account…") from account saving ("Saving to your account…", "Saved to your account."), and shows accurate offline, failed and conflict states.
- Sign-in or cloud-save failures never block calculations and never discard unsaved edits.
- Each browser tab pins its account requests to the signed-in user (`X-DebtNav-User`); if the session now belongs to a different user the server answers `409 accountChanged` and nothing is written.

### US-1503: Guest-to-account transition (Must)
- The guest plan is preserved through the sign-in redirect, cancellation and failure. Before leaving for Google the guest plan is written to the browser; if it cannot be saved the user is warned and can export it, sign in anyway or cancel.
- Signing in never uploads guest data by itself. If the browser holds a non-default guest plan, the user chooses before the account plan loads:
  - account has no plan: **Save this plan to my account** or **Not now — keep it on this browser**;
  - account already has a plan: **Open my account plan** (default) or **Replace my account plan with this browser's plan…**, which requires an explicit confirmation ("Replace account plan"). Plans are never merged.
- DebtNav stores one plan per account, so "save the guest plan separately" is not offered.
- Only a changed (non-default) guest plan is offered. After Open or Not now, the browser remembers a fingerprint of that exact draft (no plan data) and does not ask again; editing the guest plan later makes it a new draft that is offered at the next sign-in. Unsynced account edits restored from this browser take priority, and no offer is made that time. If the account cannot be checked, the user can try again or continue without copying (asked again next sign-in).
- A replacement is saved against the loaded revision, so a newer account version produces a conflict choice instead of an overwrite. The guest copy is removed only after the server confirms the save; after Open or Not now it stays on the browser.
- Late responses from an earlier session or another account can never overwrite the selected plan or save to the wrong account.

### US-1504: Sign-out (Must)
- Sign-out first tries to save pending account edits (up to 5 seconds). If they are still not saved (pending, offline, failed or in conflict), it asks: sign out anyway (unsaved changes are discarded), export a copy (downloads JSON and keeps the dialog open), or stay signed in (changes nothing).
- Sign-out stops account saves, removes this account's local cache, removes the account plan and undo history from the screen, and returns to guest mode.
- Account data is never copied into guest storage. A separate guest plan that existed before sign-in is shown again unchanged; otherwise a fresh plan starts.
- Pending requests, retries and timers cannot restore account data or rewrite the cache after sign-out. Account A's data never appears for a guest or for account B.
- If the server sign-out request fails, the user is told ("DebtNav couldn't confirm sign-out with the server…") and local account data is still cleared.
- Session expiry (401) and an account switch in another tab also stop account saving and return to guest mode, but this account's unsynced-edit cache is kept so the edits return only when the same user signs in again; it is never shown to a guest or another account. Deleting account data removes it.
- Other open tabs learn about a sign-out through a `debtnav.authSignal` storage event (a timestamp only) and re-check the session; without working local storage they find out on their next request.
