# M1 independent review

Status: final integrated review complete; no unresolved blocking defect identified.

Scope: US-403, US-404, US-502–505, US-605; NFR-1–3 and NFR-10. Reviewer owns only this document. No AGENTS.md was found in repository source directories.

## Findings and resolution

The original final-payment rounding bound could authorize material balloon payments at long terms. The final implementation caps the adjustment at $1, applies it only at the nominal final installment, and continues amortizing larger residuals. The 600-month regression checks that a material residual remains scheduled, principal is conserved, and extra payment shortens payoff. The identified issue is resolved.

The independent BigInt cent golden fixture covers all 120 installments for $30,000 at 6.5%, including the final payment of $341.25 and total interest of $10,877.41. Reviewed decimal operations, actual-day accrual, capitalization, paid in-school interest, private overrides, subsidized exemption, zero rates, input validation, incomplete projections and strategy boundaries. Strategy inputs are frozen; the engine has no UI dependencies.

The preview remains a fixed-sample M1 harness with complete combined/per-loan schedules, in-school payments, assumptions and warning states. No new borrowing UI, persistence, network activity or avalanche/snowball strategy was found in reviewed M1 files. Shared interfaces, dependencies and configuration remain lead-owned.

## Verification

Lead-reported integrated results: 52 tests passed (33 projection, 10 plan, 6 preview, 3 app); V8 reported 100% engine line coverage; TypeScript noEmit, Vite production build, money lint and git diff --check passed. Reviewed engine source contains no coverage-ignore directives. Reviewer directly inspected final source, tests and golden fixture. Independent shell test execution was blocked before process creation by setup refresh had errors; execution results above are attributed to the lead.

Randomized properties cover single loans up to 240 months and compare $1 extra payments; a two-loan example verifies conservation and rollover. They do not exhaust all terms, strategies or cent-level chosen-payment boundaries. The near-minimum threshold was inspected; no concrete monotonicity failure was identified. Increasing the standard reference payment from $340.64 to $340.66 saves more than its $0.61 final residual. Broader boundary properties would improve confidence.

## Assumptions and limits

- Actual days/365 governs accrual; leap years can exceed principal times annual rate.
- First payment is one month after graduation plus grace; dates clamp from the original anchor.
- Total interest includes in-school interest once, paid or capitalized, plus repayment interest.
- Interest-only payments are non-amortizing. Incomplete projections have no payoff date or lifetime interest total. Default horizon is 600 months.
- The nominal final-payment adjustment is limited to $1; larger residuals extend the schedule. This cap and the other modeling assumptions are provisional for user review.
- Axe component tests disable color contrast. Full WCAG compliance and manual visual, keyboard and screen-reader checks remain unverified.
- No push, merge, deploy or CI change was performed. M1 is ready for user review; later milestones remain deferred.
