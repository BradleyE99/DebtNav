# DebtNav

**Your path to debt-free, recalculated every time life changes.**

DebtNav is a student debt planner that connects two questions most tools treat separately:

1. **While in school:** How much do I need to borrow each year, given my costs, grants, and part-time job?
2. **After graduation:** When will I be debt-free, and how much interest will I pay?

Enter your situation once. When something changes (a new job, a grant, a raise, a bonus), edit it, and every number updates instantly. Think of it as a GPS for student debt: it reroutes instead of making you start over.

> **Status:** M1 engine core and a sample review panel are implemented locally for review. Existing initial plan setup (US-101) is preserved. Later milestones remain planned.

## Run locally

Requires Node.js 22.12 or newer and npm.

```sh
npm ci
npm run dev
```

Run `npm test` for acceptance tests and `npm run build` for type checking and the production build.

The initial app implements [issue #1](https://github.com/BradleyE99/DebtNav/issues/1): create a plan, validate dates, and adjust school years when graduation changes. Each academic year begins on the school start date's anniversary; the final year ends at graduation. Graduation on an anniversary does not add an extra year. Same-day start and graduation create one year. February 29 anniversaries use February 28 in non-leap years. Retained years keep their data; removed years are discarded. Plans remain in memory for this issue; browser persistence is tracked separately as US-1001.

## Why I'm building this

I'm paying for college on my own. Every time my job hours, aid, or tuition changed, I had to redo the math to figure out how much to borrow and what it meant for life after graduation. I wanted one place that keeps the whole picture current.

## Planned features

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

## M1 engine review

The app includes a fixed-sample review panel for the M1 calculation engine. It shows in-school accrual, capitalization, minimum payments, complete combined/per-loan schedules, and non-amortizing warnings. Existing plan setup is preserved; the sample panel does not consume that setup form yet.

Shared types live in `src/engine/contracts.ts`; money and annual rates are decimal strings, dates are ISO calendar dates, and `calculateProjection(plan)` returns a validated result. Inputs remain separate from derived projections. The engine uses decimal.js and has no React dependencies. M1 registers an input-order strategy; avalanche and snowball remain M3 work.

Run `npm run lint:money`, `npm run test:coverage`, and `npm run build` to verify M1. Coverage enforces at least 90% engine lines. The focused money lint checks decimal aliases and string coercion/arithmetic in engine code.

See [M1 coordination plan](docs/M1-PLAN.md) for scope, interface ownership, and provisional calculation assumptions, and [independent review](docs/M1-REVIEW.md) for findings and verification limits. First payment is one month after repayment starts. Accrual uses actual days/365; total interest counts in-school interest once. Accessibility automation does not replace manual screen-reader or mobile visual review. No push, merge, deployment, or new CI workflow is part of this milestone.
