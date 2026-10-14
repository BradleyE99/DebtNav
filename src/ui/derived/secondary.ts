/**
 * Secondary (heavy) derived results: strategy/scenario/event comparisons and federal repayment
 * plan models. Pure; runs in a Web Worker in the browser and synchronously where Worker is
 * unavailable (jsdom tests). Never stored — always derived from the plan.
 */
import type { PlannerPlan, Result } from '../../engine/planner-contracts';
import type { PlannerComparisonsDetailed } from '../../engine/planner';
import { calculatePlannerComparisons } from '../../engine/planner';
import { modelIbr, modelRap, modelTieredStandard } from '../../policy/federal';

export type RapEstimate = ReturnType<typeof modelRap>;
export type IbrEstimate = ReturnType<typeof modelIbr>;
export type TieredEstimate = ReturnType<typeof modelTieredStandard>;

export interface SecondaryResults {
  comparisons: Result<PlannerComparisonsDetailed>;
  /** Null when the model cannot run for this plan (for example, its term exceeds the date range). */
  rap: RapEstimate | null;
  ibr: IbrEstimate | null;
  tiered: TieredEstimate | null;
  /** Why `rap` is null (the model's own message), or null. */
  rapError: string | null;
}

function attempt<T>(run: () => T): T | null {
  try { return run(); } catch { return null; }
}

function attemptWithReason<T>(run: () => T, fallback: string): { value: T | null; error: string | null } {
  try { return { value: run(), error: null }; } catch (error) {
    return { value: null, error: error instanceof Error && /date range/i.test(error.message) ? error.message : fallback };
  }
}

export function computeSecondary(plan: PlannerPlan): SecondaryResults {
  const comparisons = attempt(() => calculatePlannerComparisons(plan))
    ?? { ok: false as const, errors: [{ path: '', code: 'OUT_OF_RANGE' as const, message: 'Comparisons could not be calculated for this plan.' }] };
  const rap = attemptWithReason(() => modelRap(plan), 'The RAP estimate could not be calculated for this plan.');
  return { comparisons, rap: rap.value, rapError: rap.error, ibr: attempt(() => modelIbr(plan)), tiered: attempt(() => modelTieredStandard(plan)) };
}

export interface SecondaryRequest { id: number; plan: PlannerPlan }
export interface SecondaryResponse { id: number; result: SecondaryResults }
