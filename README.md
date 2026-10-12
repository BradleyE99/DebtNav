# DebtNav

**Your path to debt-free, recalculated every time life changes.**

DebtNav is a student debt planner that connects two questions most tools treat separately:

1. **While in school:** How much do I need to borrow each year, given my costs, grants, and part-time job?
2. **After graduation:** When will I be debt-free, and how much interest will I pay?

Enter your situation once. When something changes (a new job, a grant, a raise, a bonus), edit it, and every number updates instantly. Think of it as a GPS for student debt: it reroutes instead of making you start over.

> **Status:** Planning. Requirements are complete; development starts with the calculation engine (Milestone 1).

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
