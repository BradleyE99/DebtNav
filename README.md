# DebtNav

**Your path to debt-free, recalculated every time life changes.**

DebtNav is a student debt planner that connects two questions most tools treat separately:

1. **While in school:** How much do I need to borrow each year, given my costs, grants, and part-time job?
2. **After graduation:** When will I be debt-free, and how much interest will I pay?

Enter your situation once. When something changes (a new job, a grant, a raise, a bonus), edit it, and every number updates instantly. Think of it as a GPS for student debt: it reroutes instead of making you start over.

> **Status:** Connected local planner implemented across borrowing, repayment, events, scenarios and persistence. Production Chromium checks cover desktop and 360 px layouts, keyboard controls, editing and persistence. Human accessibility and usability checks remain outstanding; see the requirements checklist.

## Run locally

Requires Node.js 22.12 or newer and npm.

```sh
npm ci
npm run dev
```

Run `npm run check` for the full local gate and `npm run test:e2e` for the real-browser suite (see below).

On Windows, stop this project's Vite dev/preview servers and test watchers with Ctrl+C before running `npm ci`. A running server can keep the native Rolldown module loaded, causing `EPERM ... unlink ... rolldown-binding.win32-x64-msvc.node` during reinstall. Close any leftover DebtNav server processes, then retry `npm ci`; Administrator access is not needed for a file lock. An ordinary app restart only needs `npm run dev` when dependencies are already installed.

The planner saves valid inputs automatically in this browser. Results are derived locally. Academic years begin on the school start anniversary; the final year ends at graduation. February 29 anniversaries use February 28 in non-leap years.

## Why I'm building this

I'm paying for college on my own. Every time my job hours, aid, or tuition changed, I had to redo the math to figure out how much to borrow and what it meant for life after graduation. I wanted one place that keeps the whole picture current.

## Features

- **Borrowing gap per year:** costs minus grants, scholarships, job income, and savings.
- **Accurate loan modeling:** subsidized vs. unsubsidized loans, in-school interest, capitalization at repayment.
- **Debt-free date and total interest,** with a month-by-month amortization schedule.
- **Your payoff method:** avalanche, snowball, or your own custom order, with the trade-offs shown side by side.
- **Life events:** add a raise, bonus, or new grant on a date and see how it moves your debt-free date.
- **Scenarios:** compare conservative vs. expected plans to get a realistic range.
- **Private by design:** your financial data stays on your device.

## Tech stack (planned)

| Area | Choice |
|---|---|
| Language | TypeScript |
| UI | React + Vite |
| Money math | decimal.js (no floating-point errors) |
| Charts | Recharts |
| Testing | Vitest, fast-check (property-based), React Testing Library, axe-core |
| CI/CD | GitHub Actions → Vercel |

## Project docs

- [Requirements specification](docs/REQUIREMENTS.md): personas, user stories with acceptance criteria, non-functional requirements, calculation rules, and the release plan.
- Work is tracked in [Issues](../../issues) and grouped by [Milestones](../../milestones).

## Roadmap

| Milestone | Focus |
|---|---|
| M1 | Calculation engine and tests |
| M2 | Borrowing-phase UI |
| M3 | Repayment projection and payoff strategies |
| M4 | Life events, scenarios, and charts |
| M5 | Polish, accessibility audit, and usability testing |

## Disclaimer

DebtNav produces estimates for planning purposes only. It is not financial advice. Verify loan terms with your servicer and at [studentaid.gov](https://studentaid.gov).

## Author

**Bradley J. Elder** · [GitHub](https://github.com/BradleyE99) · [LinkedIn](https://linkedin.com/in/bradleyjelder21) · [bradleyjelder.com](https://bradleyjelder.com)

## Using the connected planner

Run `npm ci` and `npm run dev`, then open the printed localhost URL (Node.js 22.12+). There is no Calculate button: every valid edit updates the results immediately and is saved in this browser.

1. Edit school dates and grace; academic years are added or removed to match, and data in remaining years is kept.
2. In Costs, select a school year and open the cost or resource editor for grants, scholarships, savings, family help, and a borrowing buffer. Enter hourly or fixed job earnings separately in Income & Earnings, including the percentage available for school. Click into any field, clear it and type. Blank or invalid text stays visible with a field-level error, and results keep the last valid value.
3. Create a loan from a year's gap or add loans manually. Loan cards show principal and annual rate while collapsed; open a card to edit its fields, or use Expand all / Collapse all. Saved loans start collapsed; new loans open for editing. Invalid drafts stay visible when reopened and flag the card; only valid edits are saved across reloads.
4. In Income & Earnings, enter salary and a separate monthly loan payment budget; salary is not automatically allocated to debt. In Repayment, choose avalanche, snowball or custom order, and reorder custom priorities by dragging or with the keyboard.
5. Add dated income changes, windfalls, aid changes and expenses. Each event shows how it moves your debt-free date. Add scenarios that override only the fields you change; everything else inherits base-plan edits.
6. In Results, use Explore results to open a year summary, a chart, comparisons, a timeline, or a payment schedule with 12 months per page. Open Federal for rule context and optional earnings research. Reload to confirm edits persist. Export or import a versioned JSON backup. Deleting all data requires confirmation.

The plan is saved under `debtnav.plan` (schema version 3). Projections are never stored. If storage is unavailable, the app keeps working and says changes will not be saved. Unreadable saved data is preserved, and autosave pauses until you import a backup or delete it. Older development data (schema 2) is migrated. A saved or imported plan with a loan disbursed after repayment start is repaired with a visible notice.

Each sidebar link opens its own focused dashboard, with shared plan inputs and calculations preserved across views. Overview includes an Edit income shortcut. Collapse it to an icon rail for more space; this preference is remembered on this device. On narrow screens, Menu opens a drawer that closes after navigation, on an outside click, or with Escape. Navigation highlights the active dashboard and moves keyboard focus to its heading. Expanded editors and long record lists use normal page scrolling; content is not clipped to a fixed height.

## Architecture and verification

Shared contracts live in `src/engine/planner-contracts.ts`. Calculations are pure decimal (decimal.js) code in `src/engine/` with no UI dependencies. Validation and storage live in `src/data/` and `src/state/`, federal reference data in `src/policy/`, the Scorecard adapter in `src/integrations/`, and the React UI in `src/ui/`. Strategy comparisons and federal estimates run in a Web Worker so typing stays responsive.

| Command | What it checks |
|---|---|
| `npm run check` | Typecheck, ESLint (incl. jsx-a11y), money lint, all unit/property/component tests, recalculation benchmark, production build |
| `npm run test:coverage` | ≥ 90% line coverage across engine, policy, data, state and integrations |
| `npm run test:bench` | US-701 reference plan (4 years, 8 loans, 360 months) |
| `npm run test:e2e` | Real-browser journeys (dashboard navigation, earnings calculations, reload, export/import, delete), axe incl. color contrast, keyboard controls, 360 px, equivalent zoom reflow, and print. Run `npx playwright install chromium` once first. |

To use an installed Microsoft Edge instead of bundled Chromium on Windows, run `$env:PLAYWRIGHT_CHANNEL = 'msedge'; npm run test:e2e` in PowerShell.

`.github/workflows/ci.yml` runs these on push. It has not been run on GitHub yet.

## Federal and College Scorecard context

Federal reference data in `src/policy/reference.ts` is versioned as of 2026-10-13, with a source link for every value. The values were checked against the FSA Loan Limits FAQ (May 20, 2026), 34 CFR 685.200–685.210 (eCFR text as of 2026-10-09), FSA announcement GENERAL-26-33 (2026-27 rates) and the 2026 HHS poverty guidelines. The app keeps federal rules separate from DebtNav's simplified modeling assumptions. RAP, IBR (unavailable when any loan was made on or after July 1, 2026) and Tiered Standard estimates are comparisons, not eligibility decisions.

The optional College Scorecard lookup is user-initiated. It sends only the school name, data key ("latest" release by default), the requested field list and an API key: the public `DEMO_KEY` (about 10 requests per IP), or a personal api.data.gov key you paste, which stays in memory and is never saved. No plan data is sent, and the debt-to-earnings ratio is computed on the device. The live API and its CORS access were verified on 2026-10-13.

## Review status

[Requirements checklist](docs/REQUIREMENTS-CHECKLIST.md) maps every story and NFR to its implementation and evidence. [Independent review](docs/INDEPENDENT-REVIEW.md) records findings and resolutions. Still outstanding: five-student usability testing (NFR-7), a manual screen-reader pass (NFR-6), a real printed page, and a CI run on GitHub. No push, merge or deployment has been performed.
