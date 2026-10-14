import type { Comparison } from '../../engine/planner-contracts';

/** Tolerates comparison entries that carry an error instead of a projection. */
export function projectable(item: Comparison | undefined): item is Comparison {
  return Boolean(item?.projection) && !comparisonError(item);
}
export function comparisonError(item: Comparison | undefined): string | null {
  const error = (item as (Comparison & { error?: unknown }) | undefined)?.error;
  if (!error) return null;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'this scenario cannot be projected.';
}
