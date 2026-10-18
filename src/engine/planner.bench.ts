import { test, expect } from 'vitest';
import type { PlannerPlan } from './planner-contracts';
import { createDefaultPlan, calculatePlannerProjection, calculatePlannerComparisons } from './planner';
import { solveTargetPayment } from './targetPayment';

/** US-701 reference plan: 4 school years, 8 loans (v4: internal 1200-month cap; this plan pays off well before it). */
function referencePlan(): PlannerPlan {
  const plan = createDefaultPlan();
  plan.loans = Array.from({ length: 8 }, (_, i) => ({
    id: `loan-${i}`, name: `Loan ${i}`, type: i % 3 === 0 ? 'subsidized' as const : 'unsubsidized' as const,
    principal: String(4000 + i * 750), annualRate: ['0.0652', '0.0807', '0.05', '0.0907'][i % 4],
    disbursementDate: plan.schoolYears[i % 4].startDate, termMonths: 120,
  }));
  plan.postGradIncome.monthlyDebtBudget = '600.00';
  return plan;
}

/**
 * Each iteration is a new plan (a simulated keystroke: the budget changes by one cent), so the
 * engine memo of recent base projections never hides the real cost; these are uncached numbers.
 */
function keystrokes(plan: PlannerPlan): () => PlannerPlan {
  let cents = 0;
  return () => ({ ...plan, postGradIncome: { ...plan.postGradIncome, monthlyDebtBudget: (600 + (++cents % 10000) / 100).toFixed(2) } });
}

/** Mean, p99 and max latency in ms (the max catches GC pauses that a mean hides). */
function report(name: string, latency: { mean: number; p99: number; max: number }) {
  console.info(`${name} ms: mean ${latency.mean.toFixed(2)}, p99 ${latency.p99.toFixed(2)}, max ${latency.max.toFixed(2)}`);
}

/**
 * Shared CI runners (GitHub Actions) are about 2× slower than a developer machine and noisier, so CI checks
 * the NFR-4 requirement itself (< 100 ms per recalculation), while local runs keep a tighter regression guard
 * (the reference plan takes about 10 ms on a typical laptop).
 */
const ON_CI = Boolean(process.env.CI);
const CORE = ON_CI ? { mean: 50, p99: 100, max: 250 } : { mean: 15, p99: 30, max: 100 };

test(`core projection: 4 school years, 8 loans, 360-month horizon (mean < ${CORE.mean} ms, p99 < ${CORE.p99} ms)`, async ({ bench }) => {
  const next = keystrokes(referencePlan());
  const result = await bench('calculatePlannerProjection', () => {
    expect(calculatePlannerProjection(next()).ok).toBe(true);
  }).run({ time: 1000 });
  report('calculatePlannerProjection', result.latency);
  // US-701/NFR-4: computed synchronously on every keystroke; the browser adds rendering on top.
  expect(result.latency.mean).toBeLessThan(CORE.mean);
  // NFR-4: p99 under the requirement's 100 ms on CI; a single max sample can spike from GC on shared runners.
  expect(result.latency.p99).toBeLessThan(CORE.p99);
  expect(result.latency.max).toBeLessThan(CORE.max);
});

test('comparisons: reference plan + 2 scenarios + 3 life events (mean < 100 ms)', async ({ bench }) => {
  const plan = referencePlan();
  plan.scenarios = [
    { id: 'conservative', name: 'Conservative', overrides: { 'postGradIncome.monthlyDebtBudget': '450.00' } },
    { id: 'expected', name: 'Expected', overrides: { 'postGradIncome.monthlyDebtBudget': '750.00' } },
  ];
  plan.lifeEvents = [
    { id: 'raise', name: 'Raise', date: '2033-01-01', type: 'income', amount: '65000.00', allocationPercent: '50' },
    { id: 'bonus', name: 'Bonus', date: '2032-06-01', type: 'windfall', amount: '3000.00', allocationPercent: '100' },
    { id: 'refund', name: 'Tax refund', date: '2031-04-15', type: 'windfall', amount: '800.00', allocationPercent: '100', recurrence: 'yearly' },
  ];
  const next = keystrokes(plan);
  const result = await bench('calculatePlannerComparisons', () => {
    expect(calculatePlannerComparisons(next()).ok).toBe(true);
  }).run({ time: 2000 });
  report('calculatePlannerComparisons', result.latency);
  // Secondary outputs run from a deferred value, but still block the main thread when they run.
  expect(result.latency.mean).toBeLessThan(100);
  expect(result.latency.max).toBeLessThan(200);
});

test('US-506 target solver: reference plan + 3 life events, 10-year target (mean < 300 ms, worker only)', async ({ bench }) => {
  const plan = referencePlan();
  plan.lifeEvents = [
    { id: 'raise', name: 'Raise', date: '2033-01-01', type: 'income', amount: '65000.00', allocationPercent: '50' },
    { id: 'bonus', name: 'Bonus', date: '2032-06-01', type: 'windfall', amount: '3000.00', allocationPercent: '100' },
    { id: 'refund', name: 'Tax refund', date: '2031-04-15', type: 'windfall', amount: '800.00', allocationPercent: '100', recurrence: 'yearly' },
  ];
  const next = keystrokes(plan);
  const result = await bench('solveTargetPayment', () => {
    expect(solveTargetPayment(next(), { mode: 'target', kind: 'duration', months: 120 }, '2026-10-16').status).toBe('feasible');
  }).run({ time: 2000 });
  report('solveTargetPayment', result.latency);
  // Runs in the secondary-results Web Worker (never on the main thread), so the budget is looser than
  // the per-keystroke core projection; it bounds how stale the target result can be while typing.
  expect(result.latency.mean).toBeLessThan(300);
  expect(result.latency.max).toBeLessThan(1000);
});
