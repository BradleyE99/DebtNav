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

Run `npm ci`, then `npm run dev:local` and open http://localhost:5173 (Node.js 22.12+). This starts the app, the API and a local test sign-in page in one terminal (Ctrl+C stops all three), so no Google credentials are needed: sign in with any test user name, and each name is its own account. Plans are kept in `.data/pglite`. To use real Google sign-in instead, run `npm run dev:api` and `npm run dev` with credentials in `.env` (see [docs/BACKEND.md](docs/BACKEND.md)). No account is needed: choose **Start planning** and every page and calculation works as a guest. Signing in with Google is optional and adds saving to your account and access from other devices. There is no Calculate button: every valid edit updates the results immediately and is saved (on this browser as a guest, to your account when signed in).

1. **Introduction:** **Start planning** (primary) or **Sign in with Google to save across devices** (secondary); returning users use the Continue link to pick up where they left off.
2. **College Costs:** choose a school year (Edit dates changes the school start and graduation). Add costs, grants and savings, work while in school, and one-time aid or cost changes. The year shows total cost, non-loan resources, funding gap, loans already assigned to the year and what is still unfunded.
3. **Loan Amounts:** add loans or create one for a year's unfunded amount. Cards stay compact; open one to edit it, and use Advanced for required-payment terms and interest options. Optionally group loans by academic year.
4. **Results:** total debt, monthly payment, debt-free date, time until debt-free and total interest. Expand Earnings & payment, Repayment start, Bonuses & extra payments, Income changes or the optional Payoff target to adjust repayment. A checklist links straight to anything missing. View yearly breakdown summarises the monthly projection by calendar or repayment year; the monthly schedule is inside it, and More has the strategy comparison and balance chart.
5. **Account menu:** Your data (export or import JSON; Excel and the blank template need an account; delete), undo history, About these estimates, and Sign in (guests) or Sign out (signed in). Undo is always in the header.

**Guest plans** are saved only in this browser's local storage, with the status "Saved on this browser. Sign in to access your plan on other devices." They are not sent to the server. Local storage is per browser and profile, is erased when site data is cleared, may be unavailable in private browsing, and is limited to about 5 MB; when it is unavailable or full, DebtNav keeps working, says that changes are not saved, and suggests exporting a backup. **Signed-in plans** are saved to your account on the server (PostgreSQL in production, embedded PGlite locally) with visible saving, saved, offline and error states. Saves are versioned: if the plan changed on another device, you choose which version to keep instead of one silently overwriting the other. Projections are never stored. A per-account copy in this browser holds unsynced edits only and is never shown as saved. Signing in never uploads the guest plan by itself: if this browser holds one, you choose to save it to your account (when the account is empty), open your account plan, or replace the account plan after an explicit confirmation. Plans are never merged, and the browser copy is kept unless it was successfully saved to the account. Signing out (after a warning if account changes are unsaved) clears this account's local cache and returns to guest mode, showing any earlier guest plan unchanged; account data is never copied into guest storage. Undo/history stays available for the whole session (no timer), including undoing an import. Your Data exchanges versioned JSON and Excel (.xlsx) files: a blank template, a full export, and an import that is validated server-side and previewed before it replaces the plan. Deleting your data requires confirmation and removes your server records and this browser's cache; signing out deletes nothing on the server. Known limitations: one plan per account, so a guest plan cannot be saved alongside an existing account plan (only open or replace); Excel exchange requires an account; guest plans do not sync between browsers or devices; real Google sign-in is tested manually only (automated tests use a mock OIDC issuer). Backend setup, security, deployment and backup policy: [docs/BACKEND.md](docs/BACKEND.md). To put it online with Google sign-in, follow [docs/DEPLOY-RENDER.md](docs/DEPLOY-RENDER.md).

Navigation is four tabs: Introduction, College Costs, Loan Amounts and Results. Old links such as `#income`, `#repayment` or `#data` open the destination that now holds those inputs. Scenarios and federal settings are no longer shown, but any saved ones are kept and still exported.

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
