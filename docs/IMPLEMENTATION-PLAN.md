# Full application coordination

Root cause: App date setup is disconnected from M1Preview, which reads immutable sample fixtures. No financial editors exist. Replace the mounted preview with a connected planner while retaining the tested pure core.

Shared contract: src/engine/planner-contracts.ts extends existing M1 types without breaking existing APIs. Valid plan plus unfinished draft text are persisted; projections stay derived. Field text must remain editable while invalid values cannot replace last valid plan values.

Ownership: lead owns shared contracts, App.tsx, App.test.tsx, dependencies/configuration, policy reference data, external integrations and documentation. Engine owns engine files except contracts.ts/planner-contracts.ts; UI owns src/ui/**; Data owns src/data/**. Independent reviewer owns docs/FULL-REVIEW.md only, with code read-only. No agent changes dependencies/configuration/contracts without lead agreement.

Three implementation agents run in parallel; the fourth independent review assignment follows when a concurrency slot is free. Reports require changed files, completed IDs, verification and unresolved issues. No push, merge or deployment. Existing package-lock.json modification is user-owned and will be preserved.

## Completion reports

Engine changed money.ts, projection.ts, planner.ts/tests/benchmark and three strategy files plus registry. Completed borrowing/repayment/events/scenarios calculations; preserved M1 golden.56 engine tests passed. Safe Decimal allocation optimization reduced observed full-reference latency below100ms. No engine blockers; federal mode remains a separate sourced comparison.

UI changed only src/ui/PlannerApp.tsx, planner.css and PlannerApp.test.tsx. Completed editable records/forms, comparisons/chart/table/timeline, custom drag/keyboard order, print and data controls.9 UI tests passed including clearing, validation, scenario/removal cleanup, keyboard modal and axe. Real browser/visual checks unavailable.

Data changed only src/data/validation.ts,storage.ts,storage.test.ts. Completed versioned local persistence/import/export/deletion, validation and protection of corrupt saved data.13 data tests pass. Dates/overflow and effective scenario references validated. No data blockers.

Independent reviewer changed docs/FULL-REVIEW.md only. All concrete source findings were corrected and re-inspected. Reviewer could not independently start shell processes; lead executed combined checks.

Lead integrated App, shared contracts, global styles, pure federal reference/model, Scorecard adapter/unavailable state, policy UI, journey/reload/import/export/deletion tests and requirements checklist. Existing package-lock modification remains untouched by implementation commands. No external messages, push, merge or deploy performed.

Latest integrated verification:99 tests passed across9files, typecheck/build/money lint pass; coverage threshold passed. Final reference benchmark mean45.28ms/max65.84ms/64samples. Actual browser surfaces absent; no real browser journey,360px visual, contrast/screen-reader or human usability pass is claimed. Live Scorecard endpoint/schema/CORS remains an external verification dependency.
