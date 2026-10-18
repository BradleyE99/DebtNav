import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Comparison } from '../../engine/planner-contracts';
import { wholeMonthsBetween } from '../../engine/dates';
import { budgetTimeline } from '../../engine/planner';
import { D, money, sum } from '../../engine/money';
import { ReadinessPanel, ResultFigure } from './Readiness';
import { usePlanner } from '../PlannerContext';
import { Explain, TableRegion } from '../common/common';
import { formatCurrency, formatDuration, formatMonthYear, plural, strategyName } from '../format';
import { onRevealRequest } from '../reveal';
import { BalanceChart } from './BalanceChart';
import { YearlyBreakdown } from './YearlyBreakdown';
import { EarningsAndPayment, PayoffTargetSection, RaiseDefaultField, RepaymentStart, totalMonthlyPayment } from '../sections/RepaymentSection';
import { EventList } from '../sections/EventsSection';
import './results.css';

/** "+$640.00 interest, +3 months" relative to the lowest-interest option (neutral wording, US-604). */
export function differenceText(comparison: Comparison): string {
  if (comparison.interestDifference === null) return 'Not comparable (no payoff within the modeled limit)';
  const interest = new D(comparison.interestDifference);
  const months = comparison.monthsDifference ?? 0;
  if (interest.isZero() && months === 0) return 'Lowest modeled interest';
  return `${interest.isNegative() ? '−' : '+'}${formatCurrency(interest.abs().toFixed(2))} interest, ${months < 0 ? '−' : '+'}${plural(Math.abs(months), 'month')}`;
}

/** Results: what is still needed, the five headline figures, then the repayment inputs in collapsed sections. */
export function ResultsSection() {
  const { plan, projection, projectionUpdating, repaymentUnavailable } = usePlanner();
  const windfalls = plan.lifeEvents.filter(event => event.type === 'windfall').length;
  const incomeChanges = plan.lifeEvents.filter(event => event.type === 'income').length;
  const target = plan.repayment.payoffTarget?.mode === 'target';
  return (
    <section id="results" className={projectionUpdating ? 'panel results is-recalculating' : 'panel results'} aria-labelledby="results-heading" aria-busy={projectionUpdating || undefined}>
      <h2 id="results-heading">Results</h2>
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
          <p><strong>Repayment can't be projected yet.</strong> Fix the values listed above to see repayment results.</p>
        </div>
      )}
      <Headline />
      <PlanWarnings />

      <div className="results-sections">
        <ResultsBlock id="earnings" title="Earnings & payment" meta={`${formatCurrency(totalMonthlyPayment(plan))}/mo`}
          owns={id => id.startsWith('postGradIncome.') && id !== 'postGradIncome.raiseAllocationPercent' || id === 'repayment.strategyId' || id.startsWith('order-')}>
          <EarningsAndPayment />
        </ResultsBlock>
        <ResultsBlock id="start" title="Repayment start" meta={projection ? `First payment ${formatMonthYear(projection.firstVoluntaryPaymentDate)}` : undefined}
          owns={id => id.startsWith('repayment.voluntaryStart')}>
          <RepaymentStart />
        </ResultsBlock>
        <ResultsBlock id="bonuses" title="Bonuses & extra payments" meta={windfalls ? plural(windfalls, 'item') : 'None'}
          owns={id => id === 'lifeEvents-add-windfall' || isEventField(plan.lifeEvents, id, 'windfall')}>
          <EventList types={['windfall']} add={[['windfall', 'Add bonus or extra payment']]}
            defaults={{ date: projection?.repayment?.firstPaymentDate ?? plan.settings.graduationDate }}
            empty="No bonuses or one-time payments." />
          <p className="field-hint">Applies from that month's payment. Before your first payment: added to the first one.</p>
        </ResultsBlock>
        <ResultsBlock id="income-changes" title="Income changes" meta={incomeChanges ? plural(incomeChanges, 'change') : 'None'}
          owns={id => id === 'lifeEvents-add-income' || id === 'postGradIncome.raiseAllocationPercent' || isEventField(plan.lifeEvents, id, 'income')}>
          <p className="field-hint">From its month, your payment changes by (new salary − previous salary) ÷ 12 × % to debt, never below $0.</p>
          <EventList types={['income']} add={[['income', 'Add income change']]} detail={event => <IncomeChangeEffect eventId={event.id} />}
            defaults={{ date: projection?.repayment?.firstPaymentDate ?? plan.settings.graduationDate }}
            empty="No raises or job changes." />
          <RaiseDefaultField />
        </ResultsBlock>
        <ResultsBlock id="target" title="Payoff target (optional)" meta={target ? 'On' : 'Off'} owns={id => id.startsWith('repayment.payoffTarget')}>
          <PayoffTargetSection />
        </ResultsBlock>
        <ResultsBlock id="breakdown" title="Yearly breakdown" meta="Payments, interest and balance by year"
          owns={id => id === 'schedule-loan' || id === 'breakdown-years'}>
          <YearlyBreakdown />
        </ResultsBlock>
        <ResultsBlock id="more" title="More" meta="Strategy comparison, balance chart">
          <More />
        </ResultsBlock>
      </div>
      <Explain>
        <p>Total debt = the amounts borrowed on all loans. Interest before repayment is part of total interest.</p>
        <p>Debt-free date = the month of the payment that brings every balance to $0.00. It is not shown if payments never cover the interest, or nothing pays off within 100 years (that is never forgiveness).</p>
        <p>Each month: interest = balance × annual rate ÷ 12, rounded half-up to cents. Required minimums are paid first; the rest follows your payoff order. The final payment is adjusted so the balance ends at exactly $0.00.</p>
        <p>These are estimates. Servicers may use daily interest and different payment application rules.</p>
      </Explain>
    </section>
  );
}

/** D5: "$400.00 → $900.00/mo from Jul 2032", with a flag when the payment drops to $0. */
function IncomeChangeEffect({ eventId }: { eventId: string }) {
  const { plan } = usePlanner();
  const step = useMemo(() => budgetTimeline(plan), [plan]).find(item => item.eventId === eventId);
  if (!step) return null;
  const toZero = new D(step.after).isZero();
  return (
    <span className={toZero ? 'income-effect income-effect--zero' : 'income-effect'}>
      Payment {formatCurrency(step.before)} → {formatCurrency(step.after)}/mo from {formatMonthYear(step.from)}{toZero ? ' (nothing goes to your loans)' : ''}
    </span>
  );
}

const isEventField = (events: { id: string; type: string }[], id: string, type: string) =>
  events.some(event => event.type === type && id.startsWith(`lifeEvents.${event.id}.`));

/**
 * One collapsed Results section (native <details>, so a revealed field opens it). `owns` lists the
 * field ids inside, so a readiness link or old bookmark opens the right section.
 */
function ResultsBlock({ id, title, meta, defaultOpen = false, owns, children }: {
  id: string; title: string; meta?: string; defaultOpen?: boolean; owns?(fieldId: string): boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => onRevealRequest(fieldId => { if (owns?.(fieldId)) setOpen(true); }), [owns]);
  return (
    <details id={`results-${id}`} className="results-block" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>
        <h3 id={`results-${id}-heading`}>{title}</h3>
        {meta && <span className="results-block__meta">{meta}</span>}
      </summary>
      <div className="results-block__body">{children}</div>
    </details>
  );
}

/** Total debt · Monthly payment · Debt-free · Time until debt-free · Total interest (never $0 or a date when inputs are missing). */
function Headline() {
  const { plan, projection, readiness, today } = usePlanner();
  const repayment = projection?.repayment;
  const totalDebt = money(sum(plan.loans.map(loan => loan.principal)));
  const budgetIsDefault = readiness.items.some(item => item.id === 'budget.default');
  const debtFree = repayment?.debtFreeDate ?? null;
  const debtFreeText = debtFree ? formatMonthYear(debtFree) : 'No debt-free date';
  const months = debtFree ? wholeMonthsBetween(today, debtFree) : null;
  return (
    <dl className="results-headline" aria-label="Headline results">
      <div>
        <dt>Total debt</dt>
        <dd>
          <ResultFigure result="totalBorrowed" value={formatCurrency(totalDebt)} testId="headline-total-debt" />
          {repayment && readiness.results.totalBorrowed.state === 'complete' && (
            <span className="headline-detail" data-testid="headline-owed-at-start">Owed when payments start: {formatCurrency(repayment.owedAtVoluntaryStart)}</span>
          )}
        </dd>
      </div>
      <div>
        <dt>Monthly payment</dt>
        <dd>
          <span className="figure-value" data-testid="headline-payment">{formatCurrency(totalMonthlyPayment(plan))}</span>
          {budgetIsDefault && <span className="chip chip--estimate">Default</span>}
        </dd>
      </div>
      <div>
        <dt>Debt-free</dt>
        <dd><ResultFigure result="debtFreeDate" value={debtFreeText} nonPayoffValue="No debt-free date" testId="headline-debt-free" reason={false} /></dd>
      </div>
      <div>
        <dt>Time until debt-free</dt>
        <dd><ResultFigure result="debtFreeDate" action={false} reason={false} nonPayoffValue="Not paid off" testId="headline-time"
          value={months === null ? 'Not paid off' : `${formatDuration(months)} from today`} /></dd>
      </div>
      <div>
        <dt>Total interest</dt>
        <dd><ResultFigure result="totalInterest" value={formatCurrency(repayment?.totalInterestPaid)} testId="headline-interest" reason={false} action={false} /></dd>
      </div>
    </dl>
  );
}

/**
 * Engine warnings, one message per condition (not one per loan or month). Not paying off, a shortfall
 * and missed required payments are already in the checklist above, so they are not repeated here.
 */
function PlanWarnings() {
  const { plan, projection, readiness } = usePlanner();
  const repayment = projection?.repayment;
  if (!projection || !repayment || readiness.results.totalBorrowed.state !== 'complete') return null;
  const nonPayoffListed = readiness.items.some(item => item.id === 'repayment.nonPayoff');
  const byCode = new Map<string, { message: string; date?: string; loans: Set<string> }>();
  for (const warning of repayment.warnings) {
    if (warning.code === 'MISSED_REQUIRED_PAYMENT' || warning.code === 'HORIZON_EXCEEDED') continue;
    const amortization = warning.code === 'NEGATIVE_AMORTIZATION' || warning.code === 'NON_AMORTIZING';
    if (amortization && nonPayoffListed) continue;
    const key = amortization ? 'amortization' : warning.code;
    const entry = byCode.get(key) ?? { message: warning.message, date: warning.date, loans: new Set<string>() };
    if (warning.loanId) entry.loans.add(warning.loanId);
    if (warning.date && (!entry.date || warning.date < entry.date)) entry.date = warning.date;
    byCode.set(key, entry);
  }
  const loanName = (id: string) => plan.loans.find(loan => loan.id === id)?.name.trim() || 'Unnamed loan';
  return (
    <>
      {[...byCode.entries()].map(([key, entry]) => (
        <p key={key} className="notice notice--warning">
          {key === 'amortization'
            ? `${entry.date ? `From ${formatMonthYear(entry.date)}, payments` : 'Payments'} don't cover the interest on ${entry.loans.size === 1 ? loanName([...entry.loans][0]) : plural(entry.loans.size, 'loan')}, so the balance grows until payments increase.`
            : entry.message}
        </p>
      ))}
      {projection.notices.map(notice => <p key={notice} className="field-hint">{notice}</p>)}
    </>
  );
}

/** Strategy comparison and balance chart (secondary). */
function More() {
  const { comparisons, comparisonsUpdating, readiness } = usePlanner();
  const ready = (['complete', 'estimate', 'nonPayoff'] as const).includes(readiness.results.strategyComparison.state as 'complete');
  if (!ready || !comparisons) return <p className="empty">{readiness.results.strategyComparison.summary ?? 'Available once repayment can be projected.'}</p>;
  return (
    <div className={comparisonsUpdating ? 'is-updating' : undefined} aria-busy={comparisonsUpdating}>
      {comparisonsUpdating && <p className="updating" aria-hidden="true">Updating comparisons…</p>}
      <StrategyComparison />
      <BalanceChart />
    </div>
  );
}

function StrategyComparison() {
  const { plan, comparisons } = usePlanner();
  if (!comparisons) return null;
  return (
    <>
      <h4>Strategy comparison</h4>
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
    </>
  );
}
