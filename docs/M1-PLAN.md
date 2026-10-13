# M1 coordination and contract freeze

Scope: US-403, US-404, US-502�505, US-605; NFR-1�3 and NFR-10. Existing setup work is preserved. UI is a sample-driven engine review harness, not M2/M3 implementation. No push, merge, deploy, or CI changes.

Shared interfaces: src/engine/contracts.ts. Shared fixtures: src/samples/m1.ts. Money and rates are decimal strings, calculations use decimal.js, output money has two decimal places. Dates are strict Gregorian YYYY-MM-DD with UTC arithmetic. Invalid inputs return Result errors with field paths; valid but incomplete projections return warnings and null payoff/interest totals. Plan extends the existing SetupPlan and adds loans and repayment settings. Projection includes per-loan accrual/capitalization, in-school cash payments, combined/per-loan schedules and payoff results. Strategies implement orderLoans and are registered independently of the engine.

Provisional interpretations for user review:
- Repayment starts graduation plus grace; first payment is one month later. Monthly dates clamp from the original anchor.
- In-school accrual uses actual days/365; a calendar year containing a leap day may exceed principal times annual rate.
- Total interest includes in-school interest once, whether paid or capitalized, plus repayment interest.
- Equality with monthly interest is non-amortizing; smaller payments warn negative amortization. No invented payoff date. Horizon default 600 months.
- Fixed payments may leave a few cents after the nominal final installment; the final scheduled payment absorbs this rounding remainder up to a provisional $1 cap. Larger remainders extend the schedule.
- M1 uses input-order strategy only. Avalanche/snowball, budgets, save, events, scenarios, and borrowing UI remain deferred.
- No loans yields zero interest and debt-free at repayment start.

Ownership: lead exclusively owns contracts.ts, samples/m1.ts, package.json, lockfile, all configuration and integration docs. Agents must request shared changes by message. Engine agent owns new src/engine files except contracts.ts and existing plan.ts/plan.test.ts. UI agent owns src/M1Preview.tsx, src/M1Preview.test.tsx, src/m1-preview.css only. Review agent owns docs/M1-REVIEW.md only and otherwise reads/runs verification. Lead integrates App.tsx and README.md. No agent changes dependencies/configuration or another owner's files.

All agent reports must include requirements completed, files changed, verification commands/results, and unresolved assumptions/blockers. Independent review runs again after integration. Financial calculations implement SRS modeling assumptions, not external regulatory rules.

## Current orchestration pass

Repository inspection found existing uncommitted M1 work and no applicable AGENTS.md. Existing work was preserved. Contracts and samples were read and frozen before delegating engine, UI, and independent review agents with the ownership above. Shared interfaces, dependencies, and configuration remain lead-owned; agents request changes by message. The reviewer independently identified the same unbounded final-payment rounding allowance as the engine agent; the engine agent is correcting it with regression coverage. User review remains required before any M2 work. No push, merge, or deployment is authorized.

## Agent completion reports

- Engine: audited US-403/404, US-502–505, US-605; changed projection.ts and projection.test.ts to cap nominal final-payment rounding adjustments and add material-residual regression. Reported 33 projection tests passing, including golden, property, rollover/conservation and long-term checks. Provisional $1 adjustment cap; zero-rounded payments warn. No blockers.
- UI: audited all sample projection displays; changed M1Preview.test.tsx for field-level validation, stale-output suppression, error-state axe and payment/date assertions. Local shell startup failed; lead subsequently verified all six preview tests. No functional component changes, shared changes or blockers. Manual accessibility limits remain.
- Independent review: owns M1-REVIEW.md; examines final integrated code and reports findings there.

## Integrated verification

Lead ran TypeScript noEmit, Vite production build, money lint and full Vitest V8 coverage using the installed Node CLIs after intermittent shell startup errors. All passed: 52 tests across four files; engine coverage reported 100% lines, above the 90% threshold. Git diff --check passed (README line-ending notice only). Standard golden schedule remains 120 payments, final payment $341.25 and total interest $10,877.41. Automated axe checks exclude color contrast; manual screen reader/mobile checks were not performed. No CI merge verification is claimed because the user reserved push/merge/deploy.
