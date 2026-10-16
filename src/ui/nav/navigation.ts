import type { ReadinessTarget } from '../../data/readiness';
import { revealField } from '../reveal';

export interface NavigateDetail {
  dashboard: string;
  fieldId?: string;
  /** Dashboard to offer a "Back to …" link to (set when following a readiness action). */
  returnTo?: string;
}

/** Switches dashboard without anchor scrolling; optional field targets support validation links. */
export function navigateDashboard(dashboard: string, fieldId?: string, returnTo?: string): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (window.location.hash !== `#${dashboard}`) window.history.pushState(null, '', `#${dashboard}`);
  const detail: NavigateDetail = { dashboard, fieldId, returnTo };
  window.dispatchEvent(new CustomEvent('debt-nav:navigate', { detail }));
}

/**
 * Opens the dashboard that owns a readiness target, expands its container (loan card, school year,
 * collapsed <details>) and focuses the field or action button. Passing the field id to
 * navigateDashboard suppresses the dashboard-heading focus so the field keeps focus.
 * The dashboard the action was followed from (Results, Overview…) gets a "Back to …" link.
 */
export function goToTarget({ dashboard, fieldId }: ReadinessTarget): void {
  const from = document.querySelector<HTMLElement>('[data-dashboard]')?.dataset.dashboard;
  navigateDashboard(dashboard, fieldId, from && from !== dashboard ? from : undefined);
  revealField(fieldId);
}
