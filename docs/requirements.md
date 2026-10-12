# Software Requirements Specification
## DebtNav: Student Debt Planner

| | |
|---|---|
| **Author** | Bradley J. Elder |
| **Version** | 0.1 (Draft) |
| **Date** | October 11, 2026 |
| **Status** | Draft for review |

---

## 1. Purpose

### 1.1 Problem statement
Self-funded students can't easily see how today's borrowing, income, and aid decisions affect when they'll be debt-free. Existing tools split "how much to borrow" and "how fast can I repay" into separate calculators and force users to recalculate from scratch whenever their situation changes.

### 1.2 Product vision
A **living debt plan**: one continuous timeline from the first year of school to the day the last loan is paid off. The user enters their situation once, then edits it as life changes (new job, grant, raise, bonus). Every result updates automatically.

> Analogy: printed directions vs. GPS. A calculator gives one answer for one set of inputs. This app reroutes whenever an input changes.

### 1.3 Goals
- **G1.** Show the borrowing gap for each school year in under 5 minutes of setup.
- **G2.** Show a projected debt-free date and total interest paid, based on post-graduation income.
- **G3.** Update every result instantly when any input or life event changes.
- **G4.** Let users choose their own payoff method and see the trade-offs between methods.

### 1.4 Non-goals
- Recommending, ranking, or linking to specific lenders.
- Telling users how much they *should* borrow. The app calculates; the user decides.
- Connecting to bank accounts or loan servicers.

---

## 2. Scope (MoSCoW summary)

| Priority | Included |
|---|---|
| **Must** | Plan setup, per-year costs, aid and income, borrowing gap, loans (federal subsidized/unsubsidized, private), in-school interest accrual, repayment projection, avalanche and snowball strategies, instant recalculation, local save |
| **Should** | Life events, custom payoff order, strategy comparison, scenarios (conservative vs. expected), balance-over-time chart, export/import |
| **Could** | Federal loan limit warnings, debt-to-earnings check via College Scorecard API, federal repayment plan modeling (e.g., Repayment Assistance Plan), print view |
| **Won't (v1)** | Lender rankings, bank syncing, user accounts and server storage, mobile native app |

---

## 3. Glossary

| Term | Definition |
|---|---|
| **Cost of attendance** | Total yearly cost of school: tuition, fees, housing, food, books, transportation, personal. |
| **Resources** | Money available to pay costs without borrowing: grants, scholarships, job income, savings, family help. |
| **Borrowing gap** | `max(0, cost of attendance − resources)` for a given year. |
| **Subsidized loan** | Federal loan where interest does not accrue while the student is enrolled at least half-time or during grace. |
| **Unsubsidized loan** | Loan where interest accrues from disbursement, including while in school. |
| **Grace period** | Time after leaving school before repayment begins (6 months for federal Direct Loans). |
| **Capitalization** | Unpaid accrued interest is added to the principal, so future interest is charged on it. |
| **Amortization schedule** | Month-by-month table of payment, interest, principal, and remaining balance. |
| **Avalanche** | Payoff strategy that sends extra money to the highest-interest loan first. Minimizes total interest. |
| **Snowball** | Payoff strategy that sends extra money to the smallest-balance loan first. Gives faster early wins; usually costs more interest. |
| **Life event** | A dated change to the plan, such as a new job, raise, bonus, or new grant. |
| **Scenario** | A copy of the plan with different assumptions, used for comparison. |
| **Projection** | All calculated outputs for a plan. Always derived from inputs, never stored. |

---

## 4. Personas

### 4.1 Alex, the self-funded student (primary)
- Sophomore paying for school alone. Works part-time; hours change each semester.
- Receives some grants; amounts change year to year.
- **Needs:** Know how much to borrow this year and what that means for life after graduation, without spreadsheets.
- **Frustration:** Re-doing the math every time hours, aid, or tuition change.

### 4.2 Jordan, the recent graduate
- Graduated with a mix of federal and private loans. Starting salary known; raises and bonuses uncertain.
- **Needs:** A realistic debt-free date and a way to test "what if I put my bonus toward loans?"
- **Frustration:** Servicer websites show one loan at a time and no big picture.

### 4.3 Sam, the method-driven planner
- Follows a specific debt philosophy (e.g., Dave Ramsey's debt snowball) and wants to stick to it.
- **Needs:** Use their own method while still seeing what it costs or saves compared to alternatives.
- **Frustration:** Tools that pick one method and hide the trade-off.

---

## 5. Domain Model

Core entities. The **Plan** is the only thing stored; the **Projection** is always computed from it.

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

**Design principle: derived state.** Store inputs, compute outputs. Like a spreadsheet: change one cell and every dependent formula updates. Never store a computed result, or it will go stale.

---

## 6. Functional Requirements: User Stories

**Format:** Each story has an ID, priority, and acceptance criteria in Given / When / Then form. Each story is intended to become one GitHub issue.

**Labels:** `epic:<name>`, `priority:must|should|could`, `type:story`.

---

### Epic 1: Plan Setup (`epic:setup`)

#### US-101: Create a plan (Must)
**As** a student, **I want** to create a plan with my school start and expected graduation dates **so that** the app knows how many school years to model.

- Given no existing plan, when I enter a start date and graduation date, then the app creates one school year per academic year in that range.
- Given a graduation date before the start date, when I try to save, then I see a validation error and the plan is not created.
- Given I change the graduation date, when I save, then school years are added or removed to match, and data in remaining years is kept.

#### US-102: Set grace period (Must)
**As** a student, **I want** to set the grace period length **so that** repayment starts at the right time.

- Given a new plan, then the grace period defaults to 6 months.
- Given I change it to 0–12 months, then repayment start date = graduation date + grace months.

#### US-103: Read the disclaimer (Must)
**As** a user, **I want** to know the app's limits **so that** I don't treat projections as financial advice.

- Given I open the app for the first time, then I see a short notice that results are estimates, not financial advice.
- Given I dismiss it, then it remains accessible from the footer.

---

### Epic 2: Cost of Attendance (`epic:costs`)

#### US-201: Add cost items per year (Must)
**As** a student, **I want** to enter each type of expense for each school year **so that** I see my true total cost.

- Given a school year, when I add an item with a category (tuition, fees, housing, food, books, transportation, personal, other), a label, and an amount, then the year's total updates immediately.
- Given an amount that is negative or non-numeric, then the field shows an error and the total is unchanged.
- Given items totaling $12,000 + $9,500 + $1,200, then the year total shows $22,700.00.

#### US-202: Copy a year forward (Should)
**As** a student, **I want** to copy last year's costs to next year with an optional percentage increase **so that** I don't re-enter everything.

- Given Year 1 costs total $20,000, when I copy to Year 2 with a 3% increase, then Year 2 items are created with each amount × 1.03 and a total of $20,600.00.

#### US-203: Semester-level costs (Could)
**As** a student, **I want** to enter costs per semester **so that** they match how my school bills me.

- Given Fall $10,000 and Spring $10,500, then the year total shows $20,500.00.

---

### Epic 3: Aid, Income, and Borrowing Gap (`epic:resources`)

#### US-301: Add grants and scholarships (Must)
**As** a student, **I want** to enter grants and scholarships per year **so that** they reduce what I need to borrow.

- Given a $4,000 grant in Year 1, then Year 1 resources increase by $4,000.00 and the borrowing gap decreases by $4,000.00 (not below $0).

#### US-302: Add part-time job income (Must)
**As** a student with a part-time job, **I want** to enter my hourly wage, hours per week, and weeks worked **so that** the app calculates my earnings for me.

- Given $15.00/hour × 15 hours/week × 30 weeks, then Year income shows $6,750.00.
- Given I enter a fixed yearly amount instead, then that amount is used.
- Given I mark a percentage of income as unavailable for school (e.g., 40% for living costs already counted elsewhere), then only the remaining share counts as a resource.

#### US-303: Add savings and family contributions (Must)
**As** a student, **I want** to enter savings and outside help **so that** all resources are counted.

- Given $2,000 savings applied to Year 1, then Year 1 resources increase by $2,000.00.

#### US-304: See the borrowing gap (Must)
**As** a student, **I want** to see how much I need to borrow each year **so that** I borrow only what I need.

- Given cost $22,700 and resources $12,750, then the gap shows $9,950.00.
- Given resources exceed cost, then the gap shows $0.00 and a surplus amount is displayed separately.
- The gap is labeled as a calculation, not a recommendation.

#### US-305: Add a borrowing buffer (Could)
**As** a cautious student, **I want** to add a buffer percentage **so that** I'm covered for surprises.

- Given a $9,950 gap and a 5% buffer, then the suggested borrowing amount shows $10,447.50, labeled as "gap + your buffer."

---

### Epic 4: Loans (`epic:loans`)

#### US-401: Add a loan (Must)
**As** a borrower, **I want** to add each loan with its type, amount, interest rate, and disbursement date **so that** the app models my actual debt.

- Types: Federal Direct Subsidized, Federal Direct Unsubsidized, Private, Other.
- Given a rate outside 0–30%, then the field shows an error.
- Given a valid loan, then it appears in the loan list and total debt updates immediately.

#### US-402: Create loans from the borrowing gap (Should)
**As** a student, **I want** to turn a year's gap into a loan in one click **so that** setup is fast.

- Given a Year 2 gap of $9,950, when I click "Create loan from gap," then a loan form opens pre-filled with $9,950 and the Year 2 disbursement date.
- Given the gap later changes, then the loan does **not** change automatically, and a notice shows that the gap and loan no longer match.

#### US-403: Model in-school interest (Must)
**As** a borrower, **I want** interest on unsubsidized loans to accrue while I'm in school **so that** my projected balance is accurate.

- Given a $5,000 unsubsidized loan at 6% disbursed 12 months before repayment starts, then accrued interest at repayment start is $300.00 (simple interest).
- Given a subsidized loan, then accrued interest during school and grace is $0.00.
- Given a private loan, then interest accrues from disbursement, matching unsubsidized behavior unless the user sets otherwise.

#### US-404: Capitalize interest at repayment (Must)
**As** a borrower, **I want** unpaid interest added to my balance when repayment starts **so that** the projection matches reality.

- Given $5,000 principal and $300 accrued interest at repayment start, then the repayment balance is $5,300.00.
- Given the user enables "I pay interest while in school," then nothing capitalizes and in-school interest payments are shown as a monthly cost.

#### US-405: Federal loan limit warnings (Could)
**As** a student, **I want** a warning if my federal loans exceed annual limits **so that** my plan is realistic.

- Limits are stored as reference data with a source link and "as of" date, not hard-coded in logic.
- Given federal loans in a year exceed the stored limit for that year and dependency status, then a non-blocking warning appears.

---

### Epic 5: Repayment Projection (`epic:repayment`)

#### US-501: Enter post-graduation income (Must)
**As** a graduate, **I want** to enter my expected salary and how much per month I can put toward loans **so that** the app projects my payoff.

- Given a monthly debt budget lower than the sum of minimum payments, then a warning shows the shortfall amount.

#### US-502: See the monthly payment for each loan (Must)
**As** a borrower, **I want** to see each loan's minimum monthly payment **so that** I know my baseline obligation.

- Given $30,000 at 6.5% over 120 months, then the monthly payment is $340.64.
- Formula: `M = P × r / (1 − (1 + r)^−n)`, where r = annual rate / 12.

#### US-503: See the debt-free date and total interest (Must)
**As** a borrower, **I want** to see when I'll be debt-free and how much interest I'll pay **so that** I can plan my life.

- Given $30,000 at 6.5% paid at $340.64/month from the first payment, then the projection shows 120 payments and total interest within $1.00 of $10,877.41.
- Given any input changes, then both values update without a page reload.

#### US-504: View the amortization schedule (Must)
**As** a borrower, **I want** a month-by-month table **so that** I can see where each payment goes.

- Columns: month, payment, interest, principal, remaining balance (per loan and combined).
- The final payment is adjusted so the balance ends at exactly $0.00.
- The sum of principal paid equals the starting balance, to the cent.

#### US-505: Negative amortization warning (Must)
**As** a borrower, **I want** to know if my payment doesn't cover interest **so that** I don't think I'm making progress when I'm not.

- Given a payment smaller than one month's interest, then the app shows a warning and does not project a debt-free date.

---

### Epic 6: Payoff Strategies (`epic:strategies`)

#### US-601: Avalanche strategy (Must)
**As** a borrower, **I want** extra payments sent to the highest-rate loan first **so that** I pay the least interest.

- Given extra money after minimums, then it goes to the highest-rate loan; ties are broken by smallest balance.
- When a loan is paid off, its minimum payment rolls into the next target loan.

#### US-602: Snowball strategy (Must)
**As** a borrower who wants quick wins, **I want** extra payments sent to the smallest balance first **so that** loans disappear faster.

- Given extra money after minimums, then it goes to the smallest-balance loan; ties are broken by highest rate.
- When a loan is paid off, its minimum payment rolls into the next target loan.

#### US-603: Custom payoff order (Should)
**As** a borrower with my own method, **I want** to drag loans into my own payoff order **so that** I can follow the approach I believe in.

- Given a custom order, then extra payments follow that order exactly.

#### US-604: Compare strategies (Should)
**As** a borrower, **I want** to see strategies side by side **so that** I understand the trade-off of my choice.

- Shows debt-free date, total interest, and months until first loan is paid off for each strategy.
- Shows the difference from the lowest-interest strategy (e.g., "+$640 interest, +3 months").
- Uses neutral language; no strategy is labeled "best."
- **Invariant (tested):** avalanche total interest ≤ every other strategy's total interest for the same plan.

#### US-605: Pluggable strategy design (Must, technical)
**As** a developer, **I want** every strategy to implement one interface **so that** new methods can be added without changing the engine.

- Interface: `orderLoans(loans, month) → Loan[]`.
- Adding a strategy requires one new file and one registry entry, with no changes to the core engine.

---

### Epic 7: Life Events and Dynamic Updates (`epic:events`)

#### US-701: Instant recalculation (Must)
**As** a user, **I want** every result to update as soon as I change an input **so that** I never have to "recalculate."

- Given any change to any input, then all outputs update within 100 ms for a plan with 4 school years, 8 loans, and a 30-year horizon.
- No "Calculate" button exists.

#### US-702: Add an income change event (Should)
**As** a user, **I want** to add "new job / raise / job ends" on a date **so that** my plan reflects expected changes.

- Given a raise from $55,000 to $65,000 on Jan 1, 2031, and a rule that X% of the raise goes to debt, then monthly debt payments increase from that month onward.

#### US-703: Add a one-time windfall (Should)
**As** a user, **I want** to add a bonus, tax refund, or gift on a date **so that** I see its effect on payoff.

- Given a $3,000 bonus in June 2029 with 100% applied to debt, then a $3,000 lump sum is applied that month according to the active strategy.
- The UI shows "This event moves your debt-free date by N months and saves $X interest."

#### US-704: Add a one-time expense or aid change (Should)
**As** a student, **I want** to add a new grant or unexpected expense mid-plan **so that** my borrowing gap stays accurate.

- Given a new $1,500 grant added to Year 3, then the Year 3 gap decreases by $1,500.00.

#### US-705: View the timeline (Should)
**As** a user, **I want** all school years, events, and payoff milestones on one timeline **so that** I see my whole journey.

- Shows school years, graduation, repayment start, each life event, each loan payoff, and the debt-free date in date order.

---

### Epic 8: Scenarios (`epic:scenarios`)

#### US-801: Create a scenario (Should)
**As** a user unsure about the future, **I want** to copy my plan and change assumptions **so that** I can compare outcomes.

- Given a base plan, when I create a scenario, then it starts identical to the base, and only changed fields are stored as overrides.
- Editing the base plan updates any scenario fields that were not overridden.

#### US-802: Compare scenarios (Should)
**As** a user, **I want** to see conservative vs. expected outcomes side by side **so that** I plan with a range, not one guess.

- Shows debt-free date and total interest per scenario.
- Summary line shows the range (e.g., "Debt-free between Mar 2033 and Nov 2034").

---

### Epic 9: Visualization (`epic:visuals`)

#### US-901: Balance over time chart (Should)
**As** a user, **I want** a chart of total balance over time **so that** I see progress at a glance.

- One line per scenario or strategy being compared.
- Every chart has a text or table equivalent (accessibility).

#### US-902: Year summary table (Must)
**As** a student, **I want** a per-year table of cost, resources, gap, and amount borrowed **so that** I see the borrowing phase clearly.

---

### Epic 10: Data Persistence (`epic:data`)

#### US-1001: Save automatically on this device (Must)
**As** a user, **I want** my plan saved automatically **so that** I can come back and update it.

- Plan is saved in browser storage after every change.
- If storage is unavailable (e.g., private browsing), the app still works and shows a notice that data won't be saved.

#### US-1002: Export and import (Should)
**As** a user, **I want** to export my plan to a file and import it later **so that** I can back it up or move devices.

- Export produces a versioned JSON file.
- Importing an invalid or older-version file shows a clear error or migrates it; it never corrupts the current plan.

#### US-1003: Delete my data (Must)
**As** a user, **I want** to delete all my data **so that** I control my financial information.

- After confirmation, all stored plan data is removed from the device.

---

### Epic 11: Could-Have Extensions (`epic:future`)

#### US-1101: Debt-to-earnings check (Could)
**As** a prospective student, **I want** to compare my projected debt to typical earnings for my school and major **so that** I can judge if the debt is reasonable.

- Uses the U.S. Department of Education College Scorecard API.
- Shows source and data year next to every figure.

#### US-1102: Federal repayment plan modeling (Could)
**As** a federal borrower, **I want** to model income-based federal plans **so that** I can compare them to standard repayment.

- Plan rules are stored as versioned reference data with a source link and "as of" date.
- **Must verify current rules at studentaid.gov before implementation.** Federal repayment rules changed under 2025 legislation.

---

## 7. Non-Functional Requirements

| ID | Category | Requirement | How it's verified |
|---|---|---|---|
| NFR-1 | **Accuracy** | All money math uses decimal arithmetic, never floating point. Values round to cents at each payment. | Unit tests; lint rule banning `number` for money types |
| NFR-2 | **Accuracy** | Engine results match a reference amortization calculator within $0.01 per payment. | Golden-file tests |
| NFR-3 | **Correctness** | Invariants hold for all valid inputs: balances never negative; principal paid = starting balance; more payment never means more months. | Property-based tests (fast-check) |
| NFR-4 | **Performance** | Recalculation < 100 ms for the reference plan in US-701. | Benchmark test in CI |
| NFR-5 | **Privacy** | No financial data leaves the device in v1. No analytics on input values. | Code review; network inspection |
| NFR-6 | **Accessibility** | WCAG 2.1 AA. Full keyboard navigation. Charts have text alternatives. | axe-core in CI; manual screen reader check |
| NFR-7 | **Usability** | A first-time user can produce a borrowing gap and debt-free date in under 5 minutes. | Usability test with 5+ students |
| NFR-8 | **Responsiveness** | Usable at 360 px width without horizontal scrolling. | Manual and visual tests |
| NFR-9 | **Transparency** | Every calculated figure has an "How is this calculated?" explanation showing the formula and assumptions. | Review checklist |
| NFR-10 | **Maintainability** | Calculation engine is a pure module with no UI dependencies; ≥ 90% line coverage. | Coverage report in CI |
| NFR-11 | **Reliability** | Invalid input never crashes the app; it shows a field-level error. | Fuzz and component tests |

---

## 8. Calculation Rules and Assumptions

1. **Borrowing gap:** `gap = max(0, Σ costs − Σ resources)` per school year.
2. **In-school accrual (unsubsidized and private):** simple interest, `interest = principal × annual rate × days / 365`.
3. **Subsidized loans:** no accrual while enrolled or in grace.
4. **Capitalization:** accrued unpaid interest is added to principal at repayment start.
5. **Monthly payment:** `M = P × r / (1 − (1 + r)^−n)`, with r = annual rate / 12, default n = 120.
6. **Monthly interest during repayment:** `balance × annual rate / 12` (v1 approximation; daily accrual is a future refinement).
7. **Extra payments:** applied after all minimums, in the order set by the active strategy. Paid-off loans' minimums roll forward.
8. **Rounding:** round half-up to cents per transaction; final payment absorbs the remainder.
9. **Reference data** (loan limits, plan rules) is versioned with a source and "as of" date.

> These are modeling assumptions. Real servicers may differ slightly (e.g., daily interest, payment application order). The app must state this in its disclaimer.

---

## 9. Proposed Technical Approach

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript | Type safety for money and dates; strong job-market signal |
| UI | React + Vite | Fast setup; component model fits forms and live results |
| Engine | Separate `engine/` package, pure TypeScript | Testable without UI; enables derived-state design |
| Money math | `decimal.js` | Avoids floating-point rounding errors |
| Dates | `date-fns` | Simple, immutable date math |
| Charts | Recharts | React-native charting |
| State | React state + one `useMemo(calculateProjection)` | Inputs stored; outputs derived |
| Storage | `localStorage` with try/catch | No server needed for v1 |
| Testing | Vitest, fast-check, React Testing Library, axe-core | Unit, property, component, accessibility |
| CI/CD | GitHub Actions → Vercel | Tests on every push; auto-deploy main |

**Strategy pattern sketch:**

```ts
interface PayoffStrategy {
  id: string;
  name: string;
  orderLoans(loans: LoanState[], month: Date): LoanState[];
}

const avalanche: PayoffStrategy = {
  id: "avalanche",
  name: "Avalanche (highest rate first)",
  orderLoans: (loans) =>
    [...loans].sort((a, b) => b.rate.cmp(a.rate) || a.balance.cmp(b.balance)),
};
```

---

## 10. Release Plan

| Milestone | Contents | Stories |
|---|---|---|
| **M1: Engine core** | Amortization, accrual, capitalization, tests | US-403, 404, 502, 503, 504, 505, 605, NFR-1, 2, 3, 10 |
| **M2: Borrowing phase UI** | Plan setup, costs, resources, gap | US-101–103, 201, 301–304, 401, 902 |
| **M3: Repayment and strategies** | Income, avalanche, snowball, save | US-501, 601, 602, 701, 1001, 1003, NFR-4, 5, 11 |
| **M4: Dynamic planning** | Life events, timeline, scenarios, comparison, chart | US-603, 604, 702–705, 801, 802, 901 |
| **M5: Polish and launch** | Export/import, copy-forward, usability test, accessibility audit | US-202, 402, 1002, NFR-6, 7, 8, 9 |
| **Later** | Could-haves | US-203, 305, 405, 1101, 1102 |

**Definition of Done (every story):**
- Acceptance criteria pass as automated tests where possible.
- Engine changes include unit tests; money changes include a property test.
- No accessibility violations from axe-core.
- Code reviewed (self-review via pull request checklist) and merged through CI.

---

## 11. Open Questions

1. **Name.** Final product name?
2. **Accounts.** Do users need cross-device sync enough to justify accounts and server storage in v2? (Triggers new security and privacy requirements.)
3. **Interest precision.** Is the monthly approximation accurate enough, or should v1 use daily accrual?
4. **Validation.** Which 5–10 students will test M2 and M3?
5. **Reference data upkeep.** Who updates loan limits and federal rules each year, and how is staleness shown to users?

---

## 12. Out of Scope Rationale

- **Lender rankings:** Private loan rates are personalized by credit, so no objective "best" list exists. Ranking lenders also creates financial-advice liability.
- **Bank syncing:** Adds third-party data agreements and security burden with little benefit for v1.
- **User accounts:** Storing financial data on a server requires authentication, encryption, and breach-response planning. Deferred until the core product is validated.
