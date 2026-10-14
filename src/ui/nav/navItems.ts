/**
 * Planner sections shown in the navigation (shared contract, owned by the lead).
 * `id` is the section element id (`#setup` …); destinations are unchanged from the old top nav.
 */
export type NavIconName = 'timeline' | 'costs' | 'loans' | 'repayment' | 'events' | 'scenarios' | 'federal' | 'results' | 'data';

export interface NavItem { id: string; label: string; icon: NavIconName }

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'setup', label: 'Timeline', icon: 'timeline' },
  { id: 'school', label: 'Costs', icon: 'costs' },
  { id: 'loans', label: 'Loans', icon: 'loans' },
  { id: 'repayment', label: 'Repayment', icon: 'repayment' },
  { id: 'events', label: 'Life events', icon: 'events' },
  { id: 'scenarios', label: 'Scenarios', icon: 'scenarios' },
  { id: 'federal', label: 'Federal', icon: 'federal' },
  { id: 'results', label: 'Results', icon: 'results' },
  { id: 'data', label: 'Your data', icon: 'data' },
];
