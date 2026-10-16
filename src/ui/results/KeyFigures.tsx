import { navigateDashboard } from '../nav/navigation';
import { money, sum } from '../../engine/money';
import { usePlanner } from '../PlannerContext';
import { formatCurrency, formatMonthYear, isPositive } from '../format';
import { ReadinessPanel, ResultFigure } from './Readiness';

/**
 * Compact live summary (Overview). Every figure is rendered from the shared readiness result, so a
 * figure whose inputs are missing shows what it needs instead of $0.00 or a date.
 */
export function KeyFigures() {
  const { plan, projection, projectionUpdating, repaymentUnavailable } = usePlanner();
  const repayment = projection?.repayment;
  const totalGap = projection ? money(sum(projection.years.map(year => year.gap))) : null;
  const totalBorrowed = money(sum(plan.loans.map(loan => loan.principal)));
  return (
    <div className={projectionUpdating ? 'key-figures is-recalculating' : 'key-figures'} aria-busy={projectionUpdating || undefined}>
      <h2 className="key-figures-title">At a glance</h2>
      <ReadinessPanel compact />
      <dl>
        <div><dt>Debt-free</dt><dd><ResultFigure result="debtFreeDate" testId="key-debt-free" nonPayoffValue="No debt-free date"
          value={repayment?.debtFreeDate ? formatMonthYear(repayment.debtFreeDate) : 'No debt-free date'} /></dd></div>
        <div><dt>Total interest</dt><dd><ResultFigure result="totalInterest" testId="key-interest" value={formatCurrency(repayment?.totalInterestPaid)} /></dd></div>
        <div><dt>Total borrowing gap</dt><dd><ResultFigure result="borrowingGap" testId="key-gap" value={formatCurrency(totalGap)} /></dd></div>
        <div><dt>Total borrowed</dt><dd><ResultFigure result="totalBorrowed" value={formatCurrency(totalBorrowed)} action={false} /></dd></div>
        <div><dt>Minimum payments</dt><dd><ResultFigure result="minimumPayments" value={`${formatCurrency(projection?.minimumTotal)}/mo`} action={false} /></dd></div>
        {isPositive(projection?.paymentShortfall) && <div className="key-warn"><dt>Budget shortfall</dt><dd>{formatCurrency(projection?.paymentShortfall)}/mo</dd></div>}
      </dl>
      {repaymentUnavailable && <p className="field-hint">{repaymentUnavailable.reason}</p>}
      <details className="explain">
        <summary>How is this calculated?</summary>
        <div className="explain-body">
          <p>Total borrowing gap = Σ max(0, cost − resources) over school years. Total borrowed = Σ loan principals. Minimum payments = Σ M = P × r ÷ (1 − (1 + r)^−n). Debt-free date and total interest come from the month-by-month projection under Results.</p>
          <p>A figure marked "Estimate" uses a default value you have not changed yet. A figure that needs more information shows what is missing instead of $0.00.</p>
        </div>
      </details>
      <a href="#results" className="key-figures-link" onClick={event => { event.preventDefault(); navigateDashboard('results'); }}>See all results</a>
    </div>
  );
}
