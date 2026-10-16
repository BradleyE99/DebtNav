import { createContext, useContext, useDeferredValue, useMemo, type ReactNode } from 'react';
import type {
  FieldError, PlannerPlan, PlannerStore, Result,
} from '../engine/planner-contracts';
import { calculatePlannerOutputs } from '../engine/planner';
import type { PlannerComparisonsDetailed, PlannerOutputs, RepaymentUnavailable } from '../engine/planner';
import { pruneDanglingReferences } from '../engine/paths';
import { useSecondaryResults } from './derived/useSecondaryResults';
import type { IbrEstimate, RapEstimate, TieredEstimate } from './derived/secondary';
import { getPlanReadiness, type PlanReadiness } from '../data/readiness';
import { DraftRegistryProvider, useDraftRegistryState } from './fields/draftRegistry';

export interface PlannerApi {
  store: PlannerStore;
  /** The stored plan (always current; inputs render from it). */
  plan: PlannerPlan;
  /**
   * Core results, or null when the plan cannot be projected. Computed from a deferred copy of the
   * plan so a keystroke commits and paints first; React then renders results in an interruptible pass.
   */
  projection: PlannerOutputs | null;
  /** Errors from invalid planner inputs, or from repayment when it can't be projected. */
  projectionErrors: FieldError[];
  /** Set when school-year results exist but repayment can't be projected (projection.repayment is null). */
  repaymentUnavailable: RepaymentUnavailable | null;
  /** True while `projection` belongs to an older plan (normally for a single frame). */
  projectionUpdating: boolean;
  /** Secondary results computed off the main thread (Web Worker) so typing stays responsive. */
  comparisons: PlannerComparisonsDetailed | null;
  /** Federal repayment plan models for the same plan as `comparisons`. */
  federal: { rap: RapEstimate | null; rapError: string | null; ibr: IbrEstimate | null; tiered: TieredEstimate | null } | null;
  /** True while comparisons/federal models are being recalculated for the latest plan. */
  comparisonsUpdating: boolean;
  /** What can be calculated, what is missing/invalid, and which results are estimates (one shared call). */
  readiness: PlanReadiness;
  update(edit: (plan: PlannerPlan) => PlannerPlan): Result<PlannerPlan>;
  /** Destructive edit: records an undo point, applies the edit, then prunes dangling references. */
  remove(label: string, edit: (plan: PlannerPlan) => PlannerPlan): Result<PlannerPlan>;
}

const PlannerContext = createContext<PlannerApi | null>(null);

export function PlannerProvider({ store, children }: { store: PlannerStore; children: ReactNode }) {
  const plan = store.document.plan;
  const projectedPlan = useDeferredValue(plan);
  const result = useMemo(() => calculatePlannerOutputs(projectedPlan), [projectedPlan]);
  const { results: secondary, updating: secondaryUpdating } = useSecondaryResults(plan);

  const { registry: drafts, invalidFieldIds } = useDraftRegistryState();

  const comparisonsValue = secondary?.comparisons?.ok ? secondary.comparisons.value : null;
  // Readiness follows the projected (deferred) plan so items and figures always describe the same plan.
  // Invalid drafts come from the draft registry, so they are listed even after their dashboard closes.
  const readiness = useMemo(() => getPlanReadiness(projectedPlan, {
    outputs: result.ok ? result.value : null,
    projectionErrors: result.ok ? result.value.repaymentUnavailable?.errors ?? [] : result.errors,
    comparisons: comparisonsValue,
    invalidFieldIds,
  }), [projectedPlan, result, comparisonsValue, invalidFieldIds]);

  const api = useMemo<PlannerApi>(() => {
    const comparisons = secondary?.comparisons;
    return {
      readiness,
      store,
      plan,
      projection: result.ok ? result.value : null,
      projectionErrors: result.ok ? result.value.repaymentUnavailable?.errors ?? [] : result.errors,
      repaymentUnavailable: result.ok ? result.value.repaymentUnavailable : null,
      projectionUpdating: projectedPlan !== plan,
      comparisons: comparisons?.ok ? comparisons.value : null,
      federal: secondary ? { rap: secondary.rap, rapError: secondary.rapError, ibr: secondary.ibr, tiered: secondary.tiered } : null,
      comparisonsUpdating: secondaryUpdating,
      update: edit => store.updatePlan(edit),
      remove: (label, edit) => {
        store.markUndoable(label);
        return store.updatePlan(current => pruneDanglingReferences(edit(current)));
      },
    };
  }, [store, plan, result, projectedPlan, secondary, secondaryUpdating, readiness]);

  return (
    <PlannerContext.Provider value={api}>
      <DraftRegistryProvider value={drafts}>{children}</DraftRegistryProvider>
    </PlannerContext.Provider>
  );
}

export function usePlanner(): PlannerApi {
  const api = useContext(PlannerContext);
  if (!api) throw new Error('usePlanner must be used inside PlannerProvider.');
  return api;
}
