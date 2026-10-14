import { D } from '../engine/money';
import { formatCurrency } from '../data/parse';
import { listStrategies } from '../engine/strategies/registry';

export { formatCurrency };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2033-03-01' → 'Mar 2033'. */
export function formatMonthYear(date: string | null | undefined, fallback = 'Not available'): string {
  if (!date) return fallback;
  const [year, month] = date.split('-');
  return `${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

/** '2033-03-01' → 'Mar 1, 2033'. */
export function formatDate(date: string | null | undefined, fallback = 'Not available'): string {
  if (!date) return fallback;
  const [year, month, day] = date.split('-');
  return `${MONTHS[Number(month) - 1] ?? month} ${Number(day)}, ${year}`;
}

/** Money text for an input field: '55000.00' → '55,000.00'. */
export function formatMoneyInput(value: string | undefined): string {
  if (value === undefined) return '';
  const [whole, cents] = new D(value).toFixed(2).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

export function formatPercent(value: string): string {
  return `${new D(value).toFixed()}%`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Decimal-safe equality for decimal text; falls back to string equality. */
export function decimalEquals(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  try { return new D(a).eq(b); } catch { return a === b; }
}

export function isPositive(value: string | null | undefined): boolean {
  return value != null && new D(value).gt(0);
}

export const LOAN_TYPE_LABELS = {
  subsidized: 'Federal Direct Subsidized',
  unsubsidized: 'Federal Direct Unsubsidized',
  private: 'Private',
  other: 'Other',
} as const;

/** User-facing payoff strategies from the engine registry (US-605: new strategies appear automatically). */
export function strategyOptions(): [string, string][] {
  return listStrategies().map(entry => [entry.id, entry.name]);
}

export const COST_CATEGORY_LABELS = {
  tuition: 'Tuition', fees: 'Fees', housing: 'Housing', food: 'Food', books: 'Books',
  transportation: 'Transportation', personal: 'Personal', other: 'Other',
} as const;

export const COST_PERIOD_LABELS = { annual: 'Whole year', fall: 'Fall', spring: 'Spring', summer: 'Summer' } as const;

export const RESOURCE_TYPE_LABELS = {
  grant: 'Grant', scholarship: 'Scholarship', job: 'Job income', savings: 'Savings', family: 'Family help', other: 'Other',
} as const;

export const EVENT_TYPE_LABELS = {
  income: 'Income change (new job, raise, job ends)',
  windfall: 'Windfall (bonus, refund, gift)',
  expense: 'School expense',
  aid: 'New school aid',
} as const;

export function strategyName(id: string): string {
  return listStrategies().find(entry => entry.id === id)?.name ?? id;
}
