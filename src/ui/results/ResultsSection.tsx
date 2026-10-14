import type { Comparison } from '../../engine/planner-contracts';
import { revealField } from '../reveal';
import { D, money, sum } from '../../engine/money';
import { usePlanner } from '../PlannerContext';
import { Explain, Metric, TableRegion } from '../common/common';
import { formatCurrency, formatDate, formatMonthYear, plural, strategyName } from '../format';
import { BalanceChart } from './BalanceChart';
import { fieldIdForPath } from '../planUpdates';
import { projectable } from './comparison';
import { AmortizationSchedule } from './AmortizationSchedule';

/** "+$640.00 interest, +3 months" relative to the lowest-interest option (neutral wording, US-604). */
export function differenceText(comparison: Comparison): string {
  if (comparison.interestDifference === null) return 'Not comparable (no payoff within the horizon)';
  const interest = new D(comparison.interestDifference);
  const months = comparison.monthsDifference ?? 0;
  if (interest.isZero() && months === 0) return 'Lowest modeled interest';
  return `${interest.isNegative() ? '−' : '+'}${formatCurrency(interest.abs().toFixed(2))} interest, ${months < 0 ? '−' : '+'}${plural(Math.abs(months), 'month')}`;
}

export function ResultsSection() {
  const { plan, projection, projectionErrors, comparisons, comparisonsUpdating, projectionUpdating, repaymentUnavailable } = usePlanner();
  const hasRepayment = Boolean(projection?.repayment);
  return (
    <section id="results" className={projectionUpdating ? 'panel results is-recalculating' : 'panel results'} aria-labelledby="results-heading" aria-busy={projectionUpdating || undefined}>
      <h2 id="results-heading">Your live results</h2>
      <p className="section-intro">Results update as you type. If a field shows an error, results use its last valid value.</p>
      {!projection && (
        <div className="notice notice--warning" role="alert">
          <p><strong>Results can't be calculated yet.</strong></p>
          <ul>{projectionErrors.map(error => <ProjectionErrorItem key={`${error.path}-${error.message}`} path={error.path} message={error.message} />)}</ul>
        </div>
      )}
      {projection && repaymentUnavailable && (
        <div className="notice notice--warning" role="alert">
          <span className="notice-icon" aria-hidden="true">!</span>
          <div className="notice-body">
            <p><strong>Repayment can't be projected yet.</strong> Borrowing gaps and the school-year summary below are still up to date.</p>
            <ul>{projectionErrors.map(error => <ProjectionErrorItem key={`${error.path}-${error.message}`} path={error.path} message={error.message} />)}</ul>
          </div>
        </div>
      )}
      {projection && (
        <>
          {hasRepayment && <Summary />}
          <YearSummaryTable />
          {hasRepayment && (
            <>
              <LoanTable />
              <div className={comparisonsUpdating ? 'is-updating' : undefined} aria-busy={comparisonsUpdating}>
                {comparisonsUpdating && <p className="updating" aria-hidden="true">Updating comparisons…</p>}
                <StrategyComparison />
                {plan.scenarios.length > 0 && <ScenarioComparison />}
                {comparisons && <BalanceChart />}
              </div>
            </>
          )}
          <Timeline />
          {hasRepayment && <AmortizationSchedule />}
        </>
      )}
    </section>
  );
}

/** One projection error, named after the record it belongs to and linked to its field. */
function ProjectionErrorItem({ path, message }: { path: string; message: string }) {
  const { plan } = usePlanner();
  const fieldId = fieldIdForPath(plan, path);
  const loan = plan.loans.find(item => fieldId.startsWith(`loans.${item.id}.`));
  // Link to record fields (loans, years, events, settings); the element is looked up when clicked.
  const linkable = /^(loans|schoolYears|lifeEvents|settings|postGradIncome|repayment)\./.test(fieldId);
  return (
    <li>
      {loan && !message.includes(loan.name) ? <><strong>{loan.name}:</strong> </> : null}{message}{' '}
      {linkable && (
        <a href={`#${fieldId}`} onClick={event => {
          // Expands a collapsed loan card if needed, then focuses the field.
          if (revealField(fieldId)) event.preventDefault();
        }}>
          Go to the field
        </a>
      )}
    </li>
  );
}

function Summary() {
  const { plan, projection } = usePlanner();
  const repayment = projection?.repayment;
  if (!projection || !repayment) return null;
  // Only a projection that stops (status notAmortizing) has no debt-free date; temporary negative
  // amortization (e.g. until a raise) is shown as the engine's own warning next to the date.
  const negative = repayment.status === 'notAmortizing';
  const isAmortizationWarning = (code: string) => code === 'NEGATIVE_AMORTIZATION' || code === 'NON_AMORTIZING';
  const totalBorrowed = money(sum(plan.loans.map(loan => loan.principal)));
  const debtFree = repayment.debtFreeDate
    ? formatMonthYear(repayment.debtFreeDate)
    : negative ? 'No debt-free date' : 'Not within the horizon';
  return (
    <div className="summary">
      <h3>Summary</h3>
      <dl className="metrics">
        <Metric label="Debt-free date" value={debtFree} detail={repayment.debtFreeDate ? `${plural(repayment.amortizationSchedule.length, 'payment')} from ${formatMonthYear(repayment.firstPaymentDate)}` : undefined} />
        <Metric label="Total interest" value={repayment.totalInterestPaid === null ? 'Not available' : formatCurrency(repayment.totalInterestPaid)}
          detail={repayment.totalInterestPaid === null ? 'Shown only when the plan reaches payoff.' : 'In-school and repayment interest'} />
        <Metric label="Total borrowed" value={formatCurrency(totalBorrowed)} />
        <Metric label="Balance when repayment starts" value={formatCurrency(repayment.balanceAtRepaymentStart)} detail={formatDate(repayment.repaymentStartDate)} />
      </dl>
      {negative && (
        <div className="notice notice--warning" role="alert">
          <span className="notice-icon" aria-hidden="true">!</span>
          <p><strong>Your payments don't cover the interest.</strong> At least one balance grows instead of shrinking, so there is no debt-free date. Increase your monthly amount or change the loan terms.</p>
        </div>
      )}
      {repayment.warnings.filter(warning => !(negative && isAmortizationWarning(warning.code))).map(warning => (
        <p key={`${warning.code}-${warning.loanId ?? ''}`} className="notice notice--warning">{warning.message}</p>
      ))}
      {projection.notices.map(notice => <p key={notice} className="field-hint">{notice}</p>)}
      <Explain>
        <p>Debt-free date = date of the final payment that brings every balance to $0.00. It is not shown if payments never cover interest (negative amortization) or payoff is beyond your projection horizon.</p>
        <p>Total interest = interest accrued during school and grace (counted once, whether paid or capitalized) + interest charged during repayment.</p>
        <p>Balance at repayment = principal + capitalized interest. Each month: interest = balance × annual rate ÷ 12, rounded half-up to cents; minimums are paid first, then extra money follows your strategy; the final payment is adjusted so the balance ends at exactly $0.00.</p>
        <p>These are estimates. Servicers may use daily interest and different payment application rules.</p>
      </Explain>
    </div>
  );
}

function YearSummaryTable() {
  const { projection } = usePlanner();
  if (!projection) return null;
  return (
    <>
      <h3>School years</h3>
      <TableRegion label="School year summary table">
        <table>
          <caption>Cost, resources, gap, and amount borrowed per school year</caption>
          <thead>
            <tr><th scope="col">Year</th><th scope="col">Cost</th><th scope="col">Resources</th><th scope="col">Gap</th><th scope="col">Surplus</th><th scope="col">Gap + buffer</th><th scope="col">Borrowed</th></tr>
          </thead>
          <tbody>
            {projection.years.map((year, index) => (
              <tr key={year.yearId}>
                <th scope="row">Year {index + 1}</th>
                <td>{formatCurrency(year.costs)}</td><td>{formatCurrency(year.resources)}</td><td>{formatCurrency(year.gap)}</td>
                <td>{formatCurrency(year.surplus)}</td><td>{formatCurrency(year.bufferedGap)}</td><td>{formatCurrency(year.borrowed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>
      <Explain>
        <p>Cost = sum of the year's cost items (whole-year and semester entries) + school expense events. Resources = Σ resource amount × (1 − unavailable % ÷ 100) + school aid events.</p>
        <p>Gap = max(0, cost − resources); surplus = max(0, resources − cost). Gap + buffer = gap × (1 + buffer % ÷ 100). Borrowed = principal of loans created from this year's gap or disbursed during the year.</p>
      </Explain>
    </>
  );
}

function LoanTable() {
  const { plan, projection } = usePlanner();
  if (!projection?.repayment || projection.repayment.loans.length === 0) return null;
  const name = (id: string) => plan.loans.find(loan => loan.id === id)?.name ?? 'Loan';
  return (
    <>
      <h3>Loans at repayment</h3>
      <TableRegion label="Loans at repayment table">
        <table>
          <caption>Balance and minimum monthly payment for each loan when repayment starts</caption>
          <thead>
            <tr><th scope="col">Loan</th><th scope="col">Principal</th><th scope="col">In-school interest</th><th scope="col">Capitalized</th><th scope="col">Paid in school</th><th scope="col">Balance at repayment</th><th scope="col">Minimum payment</th></tr>
          </thead>
          <tbody>
            {projection.repayment.loans.map(loan => (
              <tr key={loan.loanId}>
                <th scope="row">{name(loan.loanId)}</th>
                <td>{formatCurrency(loan.originalPrincipal)}</td><td>{formatCurrency(loan.accruedInterest)}</td><td>{formatCurrency(loan.capitalizedInterest)}</td>
                <td>{formatCurrency(loan.inSchoolInterestPaid)}</td><td>{formatCurrency(loan.balanceAtRepaymentStart)}</td><td>{formatCurrency(loan.minimumMonthlyPayment)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th scope="row">All loans</th><td colSpan={5}></td><td>{formatCurrency(projection.minimumTotal)}</td></tr>
          </tfoot>
        </table>
      </TableRegion>
      <Explain>
        <p>Minimum payment M = P × r ÷ (1 − (1 + r)^−n), where P = balance at repayment, r = annual rate ÷ 12, n = term in months (P ÷ n at 0%). A fixed payment you enter replaces the calculated minimum.</p>
        <p>In-school interest = principal × annual rate × days ÷ 365 from disbursement to repayment start (none for subsidized loans).</p>
      </Explain>
    </>
  );
}

function StrategyComparison() {
  const { plan, comparisons } = usePlanner();
  if (!comparisons) return null;
  return (
    <>
      <h3>Strategy comparison</h3>
      <TableRegion label="Strategy comparison table">
        <table>
          <caption>Same plan, different payoff orders. Differences are measured from the lowest-interest strategy.</caption>
          <thead>
            <tr><th scope="col">Strategy</th><th scope="col">Debt-free date</th><th scope="col">Total interest</th><th scope="col">Months to first payoff</th><th scope="col">Difference</th></tr>
          </thead>
          <tbody>
            {comparisons.strategyComparisons.map(item => (
              <tr key={item.id} className={item.id === plan.repayment.strategyId ? 'is-current' : undefined}>
                <th scope="row">{strategyName(item.id)}{item.id === plan.repayment.strategyId && <span className="badge">Your choice</span>}</th>
                <td>{item.projection.debtFreeDate ? formatMonthYear(item.projection.debtFreeDate) : 'No debt-free date'}</td>
                <td>{formatCurrency(item.projection.totalInterestPaid)}</td>
                <td>{item.firstPayoffMonth ?? '—'}</td>
                <td>{differenceText(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>
      <Explain>
        <p>Each strategy is projected on the same plan. "Difference" = this strategy's total interest and payoff months minus those of the strategy with the lowest modeled interest. Fewer months to the first payoff can feel motivating even when total interest is higher — the choice is yours.</p>
      </Explain>
    </>
  );
}

/** "Debt-free between Mar 2033 and Nov 2034" (US-802). */
export function rangeSentence(earliest: string | null, latest: string | null): string {
  if (!earliest) return 'No plan reaches a debt-free date within the projection horizon.';
  if (!latest) return `Debt-free as early as ${formatMonthYear(earliest)}; at least one plan doesn't pay off within the projection horizon.`;
  if (earliest === latest) return `Debt-free in ${formatMonthYear(earliest)} in every scenario that pays off.`;
  return `Debt-free between ${formatMonthYear(earliest)} and ${formatMonthYear(latest)}.`;
}

function ScenarioComparison() {
  const { projection, comparisons } = usePlanner();
  if (!projection || !comparisons) return null;
  return (
    <>
      <h3>Scenario comparison</h3>
      <p className="range-sentence"><strong>{rangeSentence(comparisons.scenarioRange.earliest, comparisons.scenarioRange.latest)}</strong></p>
      <TableRegion label="Scenario comparison table">
        <table>
          <caption>Base plan and each scenario</caption>
          <thead>
            <tr><th scope="col">Plan</th><th scope="col">Debt-free date</th><th scope="col">Total interest</th><th scope="col">Compared with base</th></tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Base plan</th>
              <td>{projection.repayment?.debtFreeDate ? formatMonthYear(projection.repayment.debtFreeDate) : 'No debt-free date'}</td>
              <td>{formatCurrency(projection.repayment?.totalInterestPaid)}</td>
              <td>—</td>
            </tr>
            {comparisons.scenarioFailures.map(failure => (
              <tr key={failure.id}>
                <th scope="row">{failure.name}</th>
                <td colSpan={3}>Can't be projected: {failure.reason}</td>
              </tr>
            ))}
            {comparisons.scenarioComparisons.filter(projectable).map(item => (
              <tr key={item.id}>
                <th scope="row">{item.name}</th>
                <td>{item.projection.debtFreeDate ? formatMonthYear(item.projection.debtFreeDate) : 'No debt-free date'}</td>
                <td>{formatCurrency(item.projection.totalInterestPaid)}</td>
                <td>{item.interestDifference === null ? 'Not comparable' : differenceText(item).replace('Lowest modeled interest', 'Same as base')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>
      <Explain>
        <p>Each scenario is your base plan with only its changed fields replaced, projected with the same rules. The range runs from the earliest to the latest debt-free date among the base plan and scenarios that pay off.</p>
        <p>"Compared with base" = scenario total interest and payoff months minus the base plan's.</p>
      </Explain>
    </>
  );
}

function Timeline() {
  const { projection } = usePlanner();
  if (!projection) return null;
  const entries = [...projection.timeline].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <>
      <h3>Your timeline</h3>
      <ol className="timeline">
        {entries.map(entry => (
          <li key={`${entry.type}-${entry.id}`} className={`timeline-${entry.type}`}>
            <time dateTime={entry.date}>{formatDate(entry.date)}</time>
            <span>{entry.label}</span>
          </li>
        ))}
      </ol>
      <Explain>
        <p>School years run from your start date; repayment starts at graduation + grace months; the first payment is one month later. Loan payoff and debt-free dates come from the month-by-month projection. Items are listed in date order.</p>
      </Explain>
    </>
  );
}
