import { useMemo, useState } from 'react';
import { yearlyBreakdown, type BreakdownBasis, type BreakdownRow } from '../../engine/yearlyBreakdown';
import { usePlanner } from '../PlannerContext';
import { TableRegion } from '../common/common';
import { formatCurrency, formatMonthYear, isPositive, plural } from '../format';
import { AmortizationSchedule } from './AmortizationSchedule';

type Count = '5' | '10' | 'all';
const COUNT_KEY = 'debtnav.breakdown.years';
const BASIS_KEY = 'debtnav.breakdown.basis';

function readPreference<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value as T) ? value as T : fallback;
  } catch { return fallback; }
}
function writePreference(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* per-viewer convenience only */ }
}

/** "−$120.00" for a negative amount (the balance grew), otherwise the plain amount. */
const signed = (value: string) => value.startsWith('-') ? `−${formatCurrency(value.slice(1))}` : formatCurrency(value);

function rowLabel(row: BreakdownRow, basis: BreakdownBasis): string {
  const span = row.firstDate.slice(0, 7) === row.lastDate.slice(0, 7) ? formatMonthYear(row.firstDate) : `${formatMonthYear(row.firstDate)} – ${formatMonthYear(row.lastDate)}`;
  const base = basis === 'calendar' ? String(row.year) : `Year ${row.year}`;
  return row.months < 12 ? `${base} (${plural(row.months, 'month')}: ${span})` : basis === 'calendar' ? base : `${base} (${span})`;
}

/**
 * C11: the monthly projection summarized by calendar or repayment year. The number of years shown
 * only limits the rows displayed; totals, dates and the projection never change.
 */
export function YearlyBreakdown() {
  const { projection } = usePlanner();
  const repayment = projection?.repayment;
  const [count, setCount] = useState<Count>(() => readPreference<Count>(COUNT_KEY, ['5', '10', 'all'], '5'));
  const [basis, setBasis] = useState<BreakdownBasis>(() => readPreference<BreakdownBasis>(BASIS_KEY, ['calendar', 'repayment'], 'calendar'));
  const breakdown = useMemo(() => repayment ? yearlyBreakdown(repayment, basis) : null, [repayment, basis]);
  if (!repayment || !breakdown) return <p className="empty">Available once repayment can be projected.</p>;
  const visible = count === 'all' ? breakdown.rows : breakdown.rows.slice(0, Number(count));
  const hidden = breakdown.rows.length - visible.length;
  const months = repayment.amortizationSchedule.length;
  return (
    <div className="yearly-breakdown">
      <div className="breakdown-controls">
        <div className="field field--narrow">
          <label htmlFor="breakdown-years">Show</label>
          <select id="breakdown-years" value={count} onChange={event => { const value = event.target.value as Count; setCount(value); writePreference(COUNT_KEY, value); }}>
            <option value="5">5 years</option>
            <option value="10">10 years</option>
            <option value="all">{breakdown.paidOff ? 'Until debt-free' : 'All projected years'}</option>
          </select>
        </div>
        <fieldset className="segmented">
          <legend>Years</legend>
          {([['calendar', 'Calendar years'], ['repayment', 'Repayment years']] as const).map(([value, label]) => (
            <label key={value}>
              <input type="radio" name="breakdown-basis" value={value} checked={basis === value}
                onChange={() => { setBasis(value); writePreference(BASIS_KEY, value); }} />
              {label}
            </label>
          ))}
        </fieldset>
      </div>
      <TableRegion label="Yearly breakdown table">
        <table>
          <caption>
            {basis === 'calendar' ? 'By calendar year of the payment' : 'By repayment year (12 payments from your first payment)'}
            {hidden > 0 ? `: first ${plural(visible.length, 'year')} of ${breakdown.rows.length}` : ''}
          </caption>
          <thead>
            <tr><th scope="col">Year</th><th scope="col">Start balance</th><th scope="col">Payments</th><th scope="col">Interest</th><th scope="col">Principal</th><th scope="col">End balance</th></tr>
          </thead>
          <tbody>
            {visible.map(row => (
              <tr key={`${basis}-${row.year}`} data-partial={row.months < 12 || undefined}>
                <th scope="row">{rowLabel(row, basis)}</th>
                <td>{formatCurrency(row.startBalance)}{isPositive(row.newBorrowing) && <span className="cell-note">+{formatCurrency(row.newBorrowing)} new loans</span>}</td>
                <td>{formatCurrency(row.payments)}{isPositive(row.bonus) && <span className="cell-note">incl. {formatCurrency(row.bonus)} bonus</span>}</td>
                <td>{formatCurrency(row.interest)}</td>
                <td>{row.principal.startsWith('-') ? <>{signed(row.principal)}<span className="cell-note">balance grew</span></> : formatCurrency(row.principal)}</td>
                <td>{formatCurrency(row.endBalance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{breakdown.paidOff ? 'All years' : 'All years so far'}</th>
              <td></td>
              <td>{formatCurrency(breakdown.totals.payments)}{isPositive(breakdown.totals.bonus) && <span className="cell-note">incl. {formatCurrency(breakdown.totals.bonus)} bonus</span>}</td>
              <td>{formatCurrency(breakdown.totals.interest)}</td>
              <td>{signed(breakdown.totals.principal)}</td>
              <td>{formatCurrency(breakdown.remainingBalance)}</td>
            </tr>
          </tfoot>
        </table>
      </TableRegion>
      {breakdown.paidOff
        ? <p className="field-hint">{plural(months, 'month')} of payments from {formatMonthYear(repayment.firstPaymentDate)}. Interest here is charged during repayment; interest before your first payment is part of the start balance.</p>
        : <p className="notice notice--warning">Not paid off: {formatCurrency(breakdown.remainingBalance)} is still owed after {plural(months, 'month')} of payments{repayment.status === 'horizonExceeded' ? ' (the 100-year modeled limit; this is not forgiveness)' : ', because payments don\'t cover the interest'}.</p>}
      <details className="explain">
        <summary>Monthly schedule</summary>
        <AmortizationSchedule />
      </details>
    </div>
  );
}
