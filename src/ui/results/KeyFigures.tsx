import { money, sum } from '../../engine/money';
import { usePlanner } from '../PlannerContext';
import { formatCurrency, formatMonthYear, isPositive } from '../format';

/** Compact live summary kept next to the inputs so every edit visibly updates results. */
export function KeyFigures() {
  const { plan, projection, projectionUpdating, repaymentUnavailable } = usePlanner();
  const totalGap = projection ? money(sum(projection.years.map(year => year.gap))) : null;
  const totalBorrowed = money(sum(plan.loans.map(loan => loan.principal)));
  return (
    <div className={projectionUpdating ? 'key-figures is-recalculating' : 'key-figures'} aria-busy={projectionUpdating || undefined}>
      <h2 className="key-figures-title">At a glance</h2>
      {!projection ? <p>Complete the highlighted fields to see results.</p> : (
        <dl>
          {projection.repayment ? (
            <>
              <div><dt>Debt-free</dt><dd data-testid="key-debt-free">{projection.repayment.debtFreeDate ? formatMonthYear(projection.repayment.debtFreeDate) : 'No debt-free date'}</dd></div>
              <div><dt>Total interest</dt><dd data-testid="key-interest">{formatCurrency(projection.repayment.totalInterestPaid)}</dd></div>
            </>
          ) : (
            <div className="key-warn"><dt>Repayment</dt><dd data-testid="key-debt-free">Can't be projected</dd></div>
          )}
          <div><dt>Total borrowing gap</dt><dd data-testid="key-gap">{formatCurrency(totalGap)}</dd></div>
          <div><dt>Total borrowed</dt><dd>{formatCurrency(totalBorrowed)}</dd></div>
          {projection.minimumTotal !== null && <div><dt>Minimum payments</dt><dd>{formatCurrency(projection.minimumTotal)}/mo</dd></div>}
          {isPositive(projection.paymentShortfall) && <div className="key-warn"><dt>Budget shortfall</dt><dd>{formatCurrency(projection.paymentShortfall)}/mo</dd></div>}
        </dl>
      )}
      {repaymentUnavailable && <p className="field-hint">{repaymentUnavailable.reason}</p>}
      <details className="explain">
        <summary>How is this calculated?</summary>
        <div className="explain-body">
          <p>Total borrowing gap = Σ max(0, cost − resources) over school years. Total borrowed = Σ loan principals. Minimum payments = Σ M = P × r ÷ (1 − (1 + r)^−n). Debt-free date and total interest come from the month-by-month projection under Results.</p>
        </div>
      </details>
      <a href="#results" className="key-figures-link">See all results</a>
    </div>
  );
}
