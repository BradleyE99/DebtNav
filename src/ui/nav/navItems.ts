/**
 * The four primary destinations, shown as tabs. `id` is the dashboard key and the URL hash; the ids
 * predate the simplification so bookmarks of these four keep working (older hashes: see navigation.ts).
 */
export type NavIconName = 'overview' | 'costs' | 'loans' | 'results';

/** `short` is shown instead of `label` on narrow screens so the four tabs fit on one row. */
export interface NavItem { id: string; label: string; short: string; icon: NavIconName }

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'overview', label: 'Introduction', short: 'Intro', icon: 'overview' },
  { id: 'school', label: 'College Costs', short: 'Costs', icon: 'costs' },
  { id: 'loans', label: 'Loan Amounts', short: 'Loans', icon: 'loans' },
  { id: 'results', label: 'Results', short: 'Results', icon: 'results' },
];

export const isDashboard = (id: string | undefined): id is string => id !== undefined && NAV_ITEMS.some(item => item.id === id);
