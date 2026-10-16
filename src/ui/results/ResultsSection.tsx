import { useState } from 'react';
import type { Comparison } from '../../engine/planner-contracts';
import type { ResultKey, ResultState } from '../../data/readiness';
import { navigateDashboard } from '../nav/navigation';
import { NeedsCard, ReadinessPanel, ResultFigure } from './Readiness';
import { D, money, sum } from '../../engine/money';
import { usePlanner } from '../PlannerContext';
import { Explain, Metric, TableRegion } from '../common/common';
import { formatCurrency, formatDate, formatMonthYear, isPositive, plural, strategyName } from '../format';
import { BalanceChart } from './BalanceChart';
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

const VIEWS: { id: string; label: string; result: ResultKey }[] = [
  { id: 'summary', label: 'Summary', result: 'debtFreeDate' },
  { id: 'school', label: 'School years', result: 'borrowingGap' },
  { id: 'loans', label: 'Loan details', result: 'loanDetails' },
  { id: 'strategies', label: 'Strategies', result: 'strategyComparison' },
  { id: 'scenarios', label: 'Scenarios', result: 'scenarioComparison' },
  { id: 'chart', label: 'Balance chart', result: 'balanceChart' },
  { id: 'timeline', label: 'Timeline', result: 'timeline' },
  { id: 'schedule', label: 'Payment schedule', result: 'paymentSchedule' },
];
const readyState = (state: ResultState) => state === 'complete' || state === 'estimate';
/** Views that still render (with their own notes) when the plan does not pay off. */
const SHOWN_WHEN_NOT_PAID_OFF = new Set(['summary', 'strategies', 'scenarios', 'chart', 'schedule']);

export function ResultsSection() {
  const { projection, comparisons, comparisonsUpdating, projectionUpdating, repaymentUnavailable, readiness } = usePlanner();
  const [view, setView] = useState('summary');
  const current = VIEWS.find(item => item.id === view) ?? VIEWS[0];
  const status = readiness.results[current.result];
  const ready = status.state === 'complete' || status.state === 'estimate' || (status.state === 'nonPayoff' && SHOWN_WHEN_NOT_PAID_OFF.has(current.id));
  // Summary always renders: it shows each figure by its own readiness state.
  // Summary shows each figure by its own state; the school table still lists every year (empty years read
  // "No costs entered") while a needs card above it explains what is missing.
  const partial = current.id === 'school' && status.state === 'incomplete' && Boolean(projection);
  const showView = current.id === 'summary' ? Boolean(projection) : ready || partial;
  return (
    <section id="results" className={projectionUpdating ? 'panel results is-recalculating' : 'panel results'} aria-labelledby="results-heading" aria-busy={projectionUpdating || undefined}>
      <h2 id="results-heading">Your live results</h2>
      <p className="section-intro">Results update as you type. Anything still needed is listed first, with a button that takes you to the right field.</p>
      <ReadinessPanel />
      {!projection && (
        <div className="notice notice--warning">
          <span className="notice-icon" aria-hidden="true">!</span>
          <p><strong>Results can't be calculated yet.</strong> Fix the values listed above.</p>
        </div>
      )}
      {projection && repaymentUnavailable && (
        <div className="notice notice--warning">
          <span className="notice-icon" aria-hidden="true">!</span>
          <p><strong>Repayment can't be projected yet.</strong> Borrowing gaps and the school-year summary are still up to date. Fix the values listed above to see repayment results.</p>
        </div>
      )}
      <div className="dashboard-toolbar">
        <div className="field field--narrow">
          <label htmlFor="results-view">Explore results</label>
          <select id="results-view" value={current.id} onChange={event => setView(event.target.value)}>
            {VIEWS.map(item => <option key={item.id} value={item.id}>{item.label}{item.id === 'summary' ? '' : viewSuffix(readiness.results[item.result].state)}</option>)}
          </select>
        </div>
        <span className="field-hint">Choose a focused view for detailed tables, comparisons, or your payment schedule.</span>
      </div>
      {(!showView || partial) && (
        <NeedsCard result={current.result} title={current.label}>
          {current.id === 'scenarios' && status.state === 'notApplicable' && (
            <button type="button" onClick={() => navigateDashboard('scenarios')}>Create a scenario</button>
          )}
        </NeedsCard>
      )}
      {showView && (
        <>
          {current.id === 'summary' && <Summary />}
          {current.id === 'school' && <YearSummaryTable />}
          {current.id === 'loans' && <LoanTable />}
          {(current.id === 'strategies' || current.id === 'scenarios' || current.id === 'chart') && (
            <div className={comparisonsUpdating ? 'is-updating' : undefined} aria-busy={comparisonsUpdating}>
              {comparisonsUpdating && <p className="updating" aria-hidden="true">Updating comparisons…</p>}
              {current.id === 'strategies' && <StrategyComparison />}
              {current.id === 'scenarios' && <ScenarioComparison />}
              {current.id === 'chart' && comparisons && <BalanceChart />}
            </div>
          )}
          {current.id === 'timeline' && <Timeline />}
          {current.id === 'schedule' && <AmortizationSchedule />}
        </>
      )}
    </section>
  );
}

function viewSuffix(state: ResultState): string {
  if (state === 'incomplete') return ' (needs information)';
  if (state === 'invalid') return ' (needs a fix)';
  if (state === 'notApplicable') return ' (not used yet)';
  return '';
}

function Summary() {
  const { plan, projection, readiness } = usePlanner();
  if (!projection) return null;
  const repayment = projection.repayment;
  const hasDebt = readiness.results.totalBorrowed.state === 'complete';
  // Only a projection that stops (status notAmortizing) has no debt-free date; temporary negative
  // amortization (e.g. until a raise) is shown as the engine's own warning next to the date.
  const negative = repayment?.status === 'notAmortizing';
  const isAmortizationWarning = (code: string) => code === 'NEGATIVE_AMORTIZATION' || code === 'NON_AMORTIZING';
  const totalBorrowed = money(sum(plan.loans.map(loan => loan.principal)));
  const debtFree = repayment?.debtFreeDate ? formatMonthYear(repayment.debtFreeDate) : 'No debt-free date';
  return (
    <div className="summary">
      <h3>Summary</h3>
      <dl className="metrics">
        <Metric label="Debt-free date" value={<ResultFigure result="debtFreeDate" value={debtFree} nonPayoffValue="No debt-free date" />}
          detail={repayment?.debtFreeDate && readyState(readiness.results.debtFreeDate.state) ? `${plural(repayment.amortizationSchedule.length, 'payment')} from ${formatMonthYear(repayment.firstPaymentDate)}` : undefined} />
        <Metric label="Total interest" value={<ResultFigure result="totalInterest" value={formatCurrency(repayment?.totalInterestPaid)} />}
          detail={readyState(readiness.results.totalInterest.state) ? 'In-school and repayment interest' : undefined} />
        <Metric label="Total borrowing gap" value={<ResultFigure result="borrowingGap" value={formatCurrency(money(sum(projection.years.map(year => year.gap))))} />}
          detail={readyState(readiness.results.borrowingGap.state) ? 'Costs not covered by your resources, all school years' : undefined} />
        <Metric label="Total borrowed" value={<ResultFigure result="totalBorrowed" value={formatCurrency(totalBorrowed)} />} />
        <Metric label="Balance when repayment starts" value={<ResultFigure result="loanDetails" value={formatCurrency(repayment?.balanceAtRepaymentStart)} action={false} />}
          detail={repayment && readyState(readiness.results.loanDetails.state) ? formatDate(repayment.repaymentStartDate) : undefined} />
      </dl>
      {hasDebt && negative && (
        <div className="notice notice--warning" role="alert">
          <span className="notice-icon" aria-hidden="true">!</span>
          <p><strong>Your payments don't cover the interest.</strong> At least one balance grows instead of shrinking, so there is no debt-free date. Increase your monthly amount or change the loan terms.</p>
        </div>
      )}
      {hasDebt && repayment?.warnings.filter(warning => !(negative && isAmortizationWarning(warning.code))).map(warning => (
        <p key={`${warning.code}-${warning.loanId ?? ''}`} className="notice notice--warning">{warning.message}</p>
      ))}
      {hasDebt && isPositive(projection.paymentShortfall) && (
        <p className="notice notice--warning">Your monthly budget is {formatCurrency(projection.paymentShortfall)} short of the minimum payments ({formatCurrency(projection.minimumTotal)}/mo). The projection assumes you pay only your budget.</p>
      )}
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
  const { projection, readiness } = usePlanner();
  const noCosts = (yearId: string) => readiness.items.some(item => item.id === `costs.year.${yearId}.empty`);
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
                <td>{noCosts(year.yearId) ? <span className="placeholder">No costs entered</span> : formatCurrency(year.costs)}</td><td>{formatCurrency(year.resources)}</td><td>{noCosts(year.yearId) ? <span className="placeholder">—</span> : formatCurrency(year.gap)}</td>
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
