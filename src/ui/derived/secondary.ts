/**
 * Secondary (heavy) derived results: strategy/scenario/event comparisons and federal repayment
 * plan models. Pure; runs in a Web Worker in the browser and synchronously where Worker is
 * unavailable (jsdom tests). Never stored — always derived from the plan.
 */
import type { PlannerComparisons, PlannerPlan, Result } from '../../engine/planner-contracts';
import { calculatePlannerComparisons } from '../../engine/planner';
import { modelIbr, modelRap, modelTieredStandard } from '../../policy/federal';

export type RapEstimate = ReturnType<typeof modelRap>;
export type IbrEstimate = ReturnType<typeof modelIbr>;
export type TieredEstimate = ReturnType<typeof modelTieredStandard>;

export interface SecondaryResults {
  comparisons: Result<PlannerComparisons>;
  /** Null when the model cannot run for this plan (for example, its term exceeds the date range). */
  rap: RapEstimate | null;
  ibr: IbrEstimate | null;
  tiered: TieredEstimate | null;
}

function attempt<T>(run: () => T): T | null {
  try { return run(); } catch { return null; }
}

export function computeSecondary(plan: PlannerPlan): SecondaryResults {
  const comparisons = attempt(() => calculatePlannerComparisons(plan))
    ?? { ok: false as const, errors: [{ path: '', code: 'OUT_OF_RANGE' as const, message: 'Comparisons could not be calculated for this plan.' }] };
  return { comparisons, rap: attempt(() => modelRap(plan)), ibr: attempt(() => modelIbr(plan)), tiered: attempt(() => modelTieredStandard(plan)) };
}

export interface SecondaryRequest { id: number; plan: PlannerPlan }
export interface SecondaryResponse { id: number; result: SecondaryResults }
