import { createContext, useContext, useDeferredValue, useMemo, type ReactNode } from 'react';
import type {
  FieldError, PlannerComparisons, PlannerPlan, PlannerProjection, PlannerStore, Result,
} from '../engine/planner-contracts';
import { calculatePlannerProjection } from '../engine/planner';
import { pruneDanglingReferences } from '../engine/paths';
import { useSecondaryResults } from './derived/useSecondaryResults';
import type { IbrEstimate, RapEstimate, TieredEstimate } from './derived/secondary';

export interface PlannerApi {
  store: PlannerStore;
  /** The stored plan (always current; inputs render from it). */
  plan: PlannerPlan;
  /**
   * Core results, or null when the plan cannot be projected. Computed from a deferred copy of the
   * plan so a keystroke commits and paints first; React then renders results in an interruptible pass.
   */
  projection: PlannerProjection | null;
  projectionErrors: FieldError[];
  /** True while `projection` belongs to an older plan (normally for a single frame). */
  projectionUpdating: boolean;
  /** Secondary results computed off the main thread (Web Worker) so typing stays responsive. */
  comparisons: PlannerComparisons | null;
  /** Federal repayment plan models for the same plan as `comparisons`. */
  federal: { rap: RapEstimate | null; ibr: IbrEstimate | null; tiered: TieredEstimate | null } | null;
  /** True while comparisons/federal models are being recalculated for the latest plan. */
  comparisonsUpdating: boolean;
  update(edit: (plan: PlannerPlan) => PlannerPlan): Result<PlannerPlan>;
  /** Destructive edit: records an undo point, applies the edit, then prunes dangling references. */
  remove(label: string, edit: (plan: PlannerPlan) => PlannerPlan): Result<PlannerPlan>;
}

const PlannerContext = createContext<PlannerApi | null>(null);

export function PlannerProvider({ store, children }: { store: PlannerStore; children: ReactNode }) {
  const plan = store.document.plan;
  const projectedPlan = useDeferredValue(plan);
  const result = useMemo(() => calculatePlannerProjection(projectedPlan), [projectedPlan]);
  const { results: secondary, updating: secondaryUpdating } = useSecondaryResults(plan);

  const api = useMemo<PlannerApi>(() => {
    const comparisons = secondary?.comparisons;
    return {
      store,
      plan,
      projection: result.ok ? result.value : null,
      projectionErrors: result.ok ? [] : result.errors,
      projectionUpdating: projectedPlan !== plan,
      comparisons: comparisons?.ok ? comparisons.value : null,
      federal: secondary ? { rap: secondary.rap, ibr: secondary.ibr, tiered: secondary.tiered } : null,
      comparisonsUpdating: secondaryUpdating,
      update: edit => store.updatePlan(edit),
      remove: (label, edit) => {
        store.markUndoable(label);
        return store.updatePlan(current => pruneDanglingReferences(edit(current)));
      },
    };
  }, [store, plan, result, projectedPlan, secondary, secondaryUpdating]);

  return <PlannerContext.Provider value={api}>{children}</PlannerContext.Provider>;
}

export function usePlanner(): PlannerApi {
  const api = useContext(PlannerContext);
  if (!api) throw new Error('usePlanner must be used inside PlannerProvider.');
  return api;
}
