/**
 * Secondary (heavy) derived results: strategy/scenario/event comparisons and the US-506 payoff-target
 * solver. Pure; runs in a Web Worker in the browser and synchronously where Worker is unavailable
 * (jsdom tests). Never stored — always derived from the plan.
 *
 * US-905: federal repayment-plan models (RAP/IBR/Tiered) are no longer computed here while the
 * Federal dashboard is "Coming soon"; the policy functions in src/policy/federal.ts stay (with tests).
 */
import type { ISODate, PlannerPlan, Result, TargetPaymentOutput } from '../../engine/planner-contracts';
import type { PlannerComparisonsDetailed } from '../../engine/planner';
import { calculatePlannerComparisons } from '../../engine/planner';
import { solveTargetPayment } from '../../engine/targetPayment';

export interface SecondaryResults {
  comparisons: Result<PlannerComparisonsDetailed>;
  /** US-506: null when repayment.payoffTarget.mode is 'budget'. */
  target: TargetPaymentOutput;
}

function attempt<T>(run: () => T): T | null {
  try { return run(); } catch { return null; }
}

export function computeTarget(plan: PlannerPlan, today: ISODate): TargetPaymentOutput {
  const goal = plan.repayment.payoffTarget;
  if (!goal || goal.mode !== 'target') return null;
  return attempt(() => solveTargetPayment(plan, goal, today)) ?? {
    status: 'invalid', reason: 'missingInputs', errors: [], message: 'The payment for this target could not be calculated.',
  };
}

export function computeSecondary(plan: PlannerPlan, today: ISODate): SecondaryResults {
  const comparisons = attempt(() => calculatePlannerComparisons(plan))
    ?? { ok: false as const, errors: [{ path: '', code: 'OUT_OF_RANGE' as const, message: 'Comparisons could not be calculated for this plan.' }] };
  return { comparisons, target: computeTarget(plan, today) };
}

export interface SecondaryRequest { id: number; plan: PlannerPlan; today: ISODate }
export interface SecondaryResponse { id: number; result: SecondaryResults }
