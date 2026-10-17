/**
 * Focused planner dashboards shown in the navigation.
 * `id` is a dashboard key; hashes support direct links and browser history.
 */
export type NavIconName = 'overview' | 'income' | 'timeline' | 'costs' | 'loans' | 'repayment' | 'events' | 'scenarios' | 'federal' | 'results' | 'data';

export interface NavItem { id: string; label: string; icon: NavIconName }

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'income', label: 'Income & Earnings', icon: 'income' },
  { id: 'setup', label: 'Timeline', icon: 'timeline' },
  { id: 'school', label: 'Costs', icon: 'costs' },
  { id: 'loans', label: 'Loans', icon: 'loans' },
  { id: 'repayment', label: 'Repayment Plan', icon: 'repayment' },
  { id: 'events', label: 'Life events', icon: 'events' },
  { id: 'scenarios', label: 'Scenarios', icon: 'scenarios' },
  { id: 'federal', label: 'Federal', icon: 'federal' },
  { id: 'results', label: 'Results', icon: 'results' },
  { id: 'data', label: 'Your data', icon: 'data' },
];
