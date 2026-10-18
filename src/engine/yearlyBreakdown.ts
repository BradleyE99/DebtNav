/**
 * C11 yearly breakdown: a pure summary of the projection's monthly schedule (no second engine).
 *
 * Rows group the monthly rows either by calendar year of the payment date ('calendar', the default)
 * or in consecutive 12-payment blocks from the first payment ('repayment'). Per row:
 *   startBalance = owed before the row's first payment (row 1: owedAtVoluntaryStart; later: the
 *                  previous row's endBalance)
 *   newBorrowing = Σ newBorrowing (loans that join the projection during the row)
 *   payments     = Σ payment; of which bonus = Σ windfallApplied (part of payments, never added again)
 *   interest     = Σ interestCharged
 *   principal    = payments − interest (negative when the balance grew)
 *   endBalance   = remainingBalance of the row's last month
 * Invariant (exact to the cent): endBalance = startBalance + newBorrowing + interest − payments.
 * How many rows are displayed is a UI choice; it never changes these values.
 */
import type Decimal from 'decimal.js';
import type { Money, Projection } from './contracts';
import { D, money } from './money';

export type BreakdownBasis = 'calendar' | 'repayment';

export interface BreakdownRow {
  /** Calendar year (2031) or repayment year number (1, 2, …). */
  year: number;
  /** Dates of the row's first and last payment. */
  firstDate: string;
  lastDate: string;
  /** Monthly payments in the row (< 12 for a partial first or last year). */
  months: number;
  startBalance: Money;
  newBorrowing: Money;
  payments: Money;
  /** Part of `payments` that came from bonuses / windfalls. */
  bonus: Money;
  interest: Money;
  /** payments − interest; negative when the balance grew. */
  principal: Money;
  endBalance: Money;
}

export interface YearlyBreakdown {
  basis: BreakdownBasis;
  rows: BreakdownRow[];
  /** Σ over all rows (all of the projection, regardless of how many rows are displayed). */
  totals: { payments: Money; bonus: Money; interest: Money; principal: Money; newBorrowing: Money };
  /** True when the projection reaches $0.00; otherwise the rows stop at the last simulated month. */
  paidOff: boolean;
  /** Owed after the last row (0.00 when paid off). */
  remainingBalance: Money;
}

export function yearlyBreakdown(projection: Projection, basis: BreakdownBasis = 'calendar'): YearlyBreakdown {
  const rows: BreakdownRow[] = [];
  const zero = new D(0);
  let start = new D(projection.owedAtVoluntaryStart);
  let current: { key: number; firstDate: string; lastDate: string; months: number; newBorrowing: Decimal; payments: Decimal; bonus: Decimal; interest: Decimal; end: Decimal } | null = null;
  const totals = { payments: zero, bonus: zero, interest: zero, newBorrowing: zero };
  const close = () => {
    if (!current) return;
    rows.push({
      year: current.key, firstDate: current.firstDate, lastDate: current.lastDate, months: current.months,
      startBalance: money(start), newBorrowing: money(current.newBorrowing), payments: money(current.payments), bonus: money(current.bonus),
      interest: money(current.interest), principal: money(current.payments.minus(current.interest)), endBalance: money(current.end),
    });
    start = current.end;
    current = null;
  };
  projection.amortizationSchedule.forEach((month, index) => {
    const key = basis === 'calendar' ? Number(month.date.slice(0, 4)) : Math.floor(index / 12) + 1; // money-lint-allow: year number from a date / row index
    if (current && current.key !== key) close();
    current ??= { key, firstDate: month.date, lastDate: month.date, months: 0, newBorrowing: zero, payments: zero, bonus: zero, interest: zero, end: zero };
    current.lastDate = month.date;
    current.months += 1;
    current.newBorrowing = current.newBorrowing.plus(month.newBorrowing);
    current.payments = current.payments.plus(month.payment);
    current.bonus = current.bonus.plus(month.windfallApplied);
    current.interest = current.interest.plus(month.interestCharged);
    current.end = new D(month.remainingBalance);
    totals.newBorrowing = totals.newBorrowing.plus(month.newBorrowing);
    totals.payments = totals.payments.plus(month.payment);
    totals.bonus = totals.bonus.plus(month.windfallApplied);
    totals.interest = totals.interest.plus(month.interestCharged);
  });
  close();
  return {
    basis,
    rows,
    totals: {
      payments: money(totals.payments), bonus: money(totals.bonus), interest: money(totals.interest),
      principal: money(totals.payments.minus(totals.interest)), newBorrowing: money(totals.newBorrowing),
    },
    paidOff: projection.status === 'paidOff',
    remainingBalance: rows.length ? rows[rows.length - 1].endBalance : projection.owedAtVoluntaryStart,
  };
}
