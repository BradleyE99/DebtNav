import type { ReadinessTarget } from '../../data/readiness';
import { revealField } from '../reveal';
import { isDashboard } from './navItems';

export interface NavigateDetail {
  dashboard: string;
  fieldId?: string;
  /** Dashboard to offer a "Back to …" link to (set when following a readiness action). */
  returnTo?: string;
}

/** Opens the account menu's "Your data" dialog (old #data links and bookmarks). */
export const OPEN_DATA_EVENT = 'debt-nav:open-data';

/**
 * Hashes of pages that were folded into the four destinations. Old bookmarks and links land on the
 * new home, with the matching section opened and its first field focused.
 */
export const LEGACY_DASHBOARDS: Readonly<Record<string, { dashboard: string; fieldId?: string }>> = {
  setup: { dashboard: 'school', fieldId: 'settings.startDate' },
  income: { dashboard: 'school', fieldId: 'income-add-earnings' },
  repayment: { dashboard: 'results', fieldId: 'postGradIncome.monthlyDebtBudget' },
  events: { dashboard: 'results', fieldId: 'lifeEvents-add-income' },
  scenarios: { dashboard: 'results' },
  federal: { dashboard: 'results' },
};

/** Resolves a hash id (current or legacy) to a destination; `data` asks for the data dialog. */
export function resolveDashboard(id: string): { dashboard: string; fieldId?: string; openData?: boolean } | undefined {
  if (isDashboard(id)) return { dashboard: id };
  if (id === 'data') return { dashboard: '', openData: true };
  return LEGACY_DASHBOARDS[id];
}

/** Switches dashboard without anchor scrolling; optional field targets support validation links. */
export function navigateDashboard(dashboard: string, fieldId?: string, returnTo?: string): void {
  const resolved = resolveDashboard(dashboard);
  if (resolved?.openData) { window.dispatchEvent(new CustomEvent(OPEN_DATA_EVENT)); return; }
  if (resolved && resolved.dashboard !== dashboard) {
    navigateDashboard(resolved.dashboard, fieldId ?? resolved.fieldId, returnTo);
    if (!fieldId && resolved.fieldId) revealField(resolved.fieldId);
    return;
  }
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (window.location.hash !== `#${dashboard}`) window.history.pushState(null, '', `#${dashboard}`);
  const detail: NavigateDetail = { dashboard, fieldId, returnTo };
  window.dispatchEvent(new CustomEvent('debt-nav:navigate', { detail }));
}

/**
 * Opens the dashboard that owns a readiness target, expands its container (loan card, school year,
 * collapsed <details>) and focuses the field or action button. Passing the field id to
 * navigateDashboard suppresses the dashboard-heading focus so the field keeps focus.
 * The dashboard the action was followed from (Results, Introduction…) gets a "Back to …" link.
 */
export function goToTarget({ dashboard, fieldId }: ReadinessTarget): void {
  const from = document.querySelector<HTMLElement>('[data-dashboard]')?.dataset.dashboard;
  const to = resolveDashboard(dashboard)?.dashboard || dashboard;
  navigateDashboard(to, fieldId, from && from !== to ? from : undefined);
  revealField(fieldId);
}
