# DebtNav

**Your path to debt-free, recalculated every time life changes.**

DebtNav is a student debt planner that connects two questions most tools treat separately:

1. **While in school:** How much do I need to borrow each year, given my costs, grants, and part-time job?
2. **After graduation:** When will I be debt-free, and how much interest will I pay?

Enter your situation once. When something changes (a new job, a grant, a raise, a bonus), edit it, and every number updates instantly. Think of it as a GPS for student debt: it reroutes instead of making you start over.

> **Status:** Connected local planner implemented across borrowing, repayment, events, scenarios and persistence. Live external-data verification and human/browser checks remain outstanding; see the requirements checklist.

## Run locally

Requires Node.js 22.12 or newer and npm.

```sh
npm ci
npm run dev
```

Run `npm test` for acceptance tests and `npm run build` for type checking and the production build.

The planner saves valid inputs and unfinished field text automatically in this browser. Results are derived locally. Academic years begin on the school start anniversary; the final year ends at graduation. February 29 anniversaries use February 28 in non-leap years.

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

Run `npm install` and `npm run dev`, then open the printed localhost URL. Node22.12+ is required.

1. Edit school dates and grace; valid dates update academic years automatically.
2. Add annual/semester costs and resources, including hourly job income. Edit any field directly; empty/invalid text stays visible while results keep the last valid model value.
3. Create a loan from a year's gap or add loans manually. Edit rates, terms and interest settings.
4. Enter a monthly debt budget, choose avalanche/snowball/custom, and reorder custom priorities by dragging or keyboard buttons.
5. Add dated income, windfall, aid or expense events. Add scenarios and override assumptions; untouched values inherit base edits.
6. Inspect live borrowing tables, repayment schedules, comparisons, chart/table and timeline. Reload to verify saved edits. Export/import a version2 JSON backup; deletion requires confirmation.

Plans and unfinished field text save automatically under `debtnav.plan.v2`. No projection is stored. Storage failure shows a notice and keeps the app usable. Unreadable stored data is preserved and automatic replacement pauses; export/import or confirmed deletion controls recovery. Older-version JSON is explicitly rejected without changing the current plan.

## Architecture and verification

React forms use lead-owned shared contracts in `src/engine/planner-contracts.ts`, pure decimal calculations in `src/engine/`, validation/storage in `src/data/`, and UI in `src/ui/`. The tested M1 API and fixtures remain available but the mounted app uses actual plan inputs. Existing UTC date helpers are retained. A native SVG chart with a full equivalent table provides accessible comparisons without adding a chart dependency.

`npm test` runs calculation, property, golden, editing, persistence and accessibility tests. `npm run test:coverage` enforces90% engine lines. `npm run test:bench` measures the four-year/eight-loan/360-month reference projection. `npm run lint:money` checks money rules. `npm run build` type-checks and builds.

## Federal and College Scorecard context

Federal reference data is versioned as of2026-10-12 in `src/policy/reference.ts`, sourced from [Federal Student Aid loan-limit guidance](https://fsapartners.ed.gov/sites/default/files/2026-05/FrequentlyAskedQuestionsLoanLimits.pdf) and [official RAP rules](https://edfinancial.studentaid.gov/income-driven-repaymentinformation-center/rap). The separate simplified RAP comparison assumes one borrower, fixed AGI, qualifying on-time payments and no spouse debt. It models current-interest subsidy, matching principal and potential360-payment forgiveness; it is not an eligibility decision or tax calculation. The standard projection uses editable SRS assumptions, clearly distinguished from policy.

Optional Scorecard lookup sends only a public school name and requested data year. All debt-to-earnings arithmetic stays local. It uses the documented public DEMO_KEY, never a private credential; [api.data.gov](https://api.data.gov/docs/developer-manual/) limits demo access to30 requests/hour and50/day. Network/CORS/rate limits, suppressed earnings and unsupported responses produce an explicit unavailable state. Live API schema/browser access could not be verified in this environment.

## Review status

[Requirements checklist](docs/REQUIREMENTS-CHECKLIST.md) maps every story/NFR to implementation and evidence. [Independent review](docs/FULL-REVIEW.md) records findings and resolutions; [coordination plan](docs/IMPLEMENTATION-PLAN.md) records ownership. Real-browser clear/type/reload/download/import journey,360px visual inspection, contrast and screen-reader checks remain unperformed because no browser surface is available. Five-student usability testing needs human participants. No push, merge, deployment or CI success is claimed.
