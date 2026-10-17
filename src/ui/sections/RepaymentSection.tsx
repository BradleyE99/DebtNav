import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { PayoffTarget, PlannerPlan, VoluntaryStart } from '../../engine/planner-contracts';
import { D, money } from '../../engine/money';
import { addMonths } from '../../engine/dates';
import { baseMonthlyBudget } from '../../engine/planner';
import { usePlanner } from '../PlannerContext';
import { DateField, IntegerField, MoneyField, OptionalMoneyField, PercentField, SelectField } from '../fields/fields';
import { Explain } from '../common/common';
import { formatCurrency, formatDate, formatMonthYear, isPositive, plural, strategyName, strategyOptions } from '../format';
import { effectiveCustomOrder, moveInCustomOrder } from '../planUpdates';
import { onRevealRequest } from '../reveal';
import { navigateDashboard } from '../nav/navigation';
import { ResultFigure } from '../results/Readiness';
import { PaymentTiming } from '../results/PaymentTiming';
import './repayment.css';

const STRATEGY_OPTIONS = strategyOptions();
const DEFAULT_TARGET_MONTHS = 120;

type PostGrad = PlannerPlan['postGradIncome'];
const withIncome = (patch: Partial<PostGrad>) => (p: PlannerPlan): PlannerPlan => ({ ...p, postGradIncome: { ...p.postGradIncome, ...patch } });
const withTarget = (payoffTarget: PayoffTarget) => (p: PlannerPlan): PlannerPlan => ({ ...p, repayment: { ...p.repayment, payoffTarget } });
const withStart = (voluntaryStart: VoluntaryStart) => (p: PlannerPlan): PlannerPlan => ({ ...p, repayment: { ...p.repayment, voluntaryStart } });

/** "$120.00 more than your budget" / "$40.00 less than your budget" / "Same as your budget". */
export function differenceSentence(difference: string): string {
  const value = new D(difference);
  if (value.isZero()) return 'Same as your budget';
  return `${formatCurrency(value.abs().toFixed(2))} ${value.isNegative() ? 'less' : 'more'} than your budget`;
}

/**
 * US-501/506/507: the only editor of post-graduation earnings and the chosen monthly debt budget;
 * budget vs. payoff-target mode; when voluntary payments start; strategy, minimums and custom order.
 */
export function RepaymentSection() {
  const { plan, update, projection, readiness } = usePlanner();
  const minimumsReady = readiness.results.minimumPayments.state === 'complete' || readiness.results.minimumPayments.state === 'estimate';
  const [raisesOpen, setRaisesOpen] = useState(false);
  useEffect(() => onRevealRequest(id => { if (id === 'postGradIncome.raiseAllocationPercent') setRaisesOpen(true); }), []);
  const income = plan.postGradIncome;
  const budgetIsDefault = readiness.items.some(item => item.id === 'budget.default');
  const extraBudget = isPositive(plan.repayment.extraMonthlyPayment) ? plan.repayment.extraMonthlyPayment : null;
  let totalBudget = income.monthlyDebtBudget;
  try { totalBudget = money(baseMonthlyBudget(plan)); } catch { /* invalid text is reported elsewhere */ }

  return (
    <section id="repayment" className="panel" aria-labelledby="repayment-heading">
      <h2 id="repayment-heading">Repayment Plan</h2>
      <p className="section-intro">Your earnings after graduation, what you choose to pay toward loans each month, and how that money pays down your loans. Earnings while you are in school are under <a href="#income" onClick={event => { event.preventDefault(); navigateDashboard('income'); }}>How much I make</a>.</p>

      <section className="repayment-block" aria-labelledby="repayment-earnings-heading">
        <h3 id="repayment-earnings-heading">After graduation: earnings and monthly budget</h3>
        <p className="field-hint">Three different amounts: your gross salary is not your take-home pay, and neither is the amount that goes to loans. DebtNav does not estimate taxes and never assumes your whole salary is available.</p>
        <div className="field-grid">
          <MoneyField id="postGradIncome.annualSalary" label="Gross annual salary (before taxes)" value={income.annualSalary}
            hint="Pay before taxes and deductions. Not used to pay loans: it is only the starting point for income changes and raises in Life events."
            onCommit={annualSalary => update(withIncome({ annualSalary }), 'Change gross annual salary')} />
          <OptionalMoneyField id="postGradIncome.monthlyTakeHome" label="Monthly take-home pay (optional)" value={income.monthlyTakeHome}
            hint="What reaches your bank account each month after taxes and deductions. Enter your own figure. Used only for affordability context; leave blank to skip."
            onCommit={monthlyTakeHome => update(withIncome({ monthlyTakeHome }), 'Change monthly take-home pay')} />
          <OptionalMoneyField id="postGradIncome.monthlyExpenses" label="Monthly living expenses (optional)" value={income.monthlyExpenses}
            hint="Rent, food, transport and other costs, not counting student loans. Used only for affordability context; leave blank to skip."
            onCommit={monthlyExpenses => update(withIncome({ monthlyExpenses }), 'Change monthly living expenses')} />
          <MoneyField id="postGradIncome.monthlyDebtBudget" label="Monthly debt budget (your chosen payment)" value={income.monthlyDebtBudget}
            hint={<>The total you choose to pay toward all loans each month. Your debt-free date and total interest use it, and DebtNav never changes it for you.{budgetIsDefault && <> <strong>Default value</strong>: replace it with your own amount.</>}{extraBudget && <> Your saved plan also adds {formatCurrency(extraBudget)}/mo, so the total used is {formatCurrency(totalBudget)}/mo.</>}</>}
            onCommit={monthlyDebtBudget => update(withIncome({ monthlyDebtBudget }), 'Change monthly debt budget')} />
        </div>
        <details className="explain repayment-raises" open={raisesOpen} onToggle={event => setRaisesOpen(event.currentTarget.open)}>
          <summary>Default share of future raises for debt</summary>
          <PercentField id="postGradIncome.raiseAllocationPercent" label="Default share of raises put toward debt" max="100" value={income.raiseAllocationPercent}
            hint="Starting share for new income-change events in Life events. Each event keeps its own share; existing events do not change."
            onCommit={raiseAllocationPercent => update(withIncome({ raiseAllocationPercent }), 'Change default share of raises')} />
        </details>
        <Affordability payment={totalBudget} label="Your monthly debt budget" />
      </section>

      <PayoffMode />

      <section className="repayment-block" aria-labelledby="repayment-start-heading">
        <h3 id="repayment-start-heading">When you start paying</h3>
        <VoluntaryStartFields />
        <PaymentTiming headingLevel={4} />
      </section>

      <section className="repayment-block" aria-labelledby="repayment-strategy-heading">
        <h3 id="repayment-strategy-heading">Payoff strategy and minimum payments</h3>
        <div className="field-grid">
          <SelectField id="repayment.strategyId" label="Payoff strategy" options={STRATEGY_OPTIONS} value={plan.repayment.strategyId}
            hint="Where money beyond the minimums goes first."
            onCommit={strategyId => update(p => ({ ...p, repayment: { ...p.repayment, strategyId } }), 'Change payoff strategy')} />
        </div>
        {!minimumsReady && <p className="empty">Minimum payments appear once you add a loan with an amount borrowed.</p>}
        {projection && projection.minimumTotal !== null && minimumsReady && (
          <div className="computed-block">
            <p className="computed">Sum of minimum payments: <strong>{formatCurrency(projection.minimumTotal)}</strong> per month</p>
            {isPositive(projection.paymentShortfall) && (
              <div className="notice notice--warning" role="status">
                <span className="notice-icon" aria-hidden="true">!</span>
                <p>Your monthly debt budget is <strong>{formatCurrency(projection.paymentShortfall)}</strong> short of the minimum payments ({formatCurrency(projection.minimumTotal)}). The projection shows what happens if you pay only your budget.</p>
              </div>
            )}
            <Explain>
              <p>Each month, every loan's minimum payment is paid first. Money left in your monthly budget goes to the loan your strategy picks: avalanche = highest rate first (ties: smallest balance), snowball = smallest balance first (ties: highest rate), custom = your order below. When a loan is paid off, its minimum rolls into the next target.</p>
              <p>Shortfall = max(0, sum of minimums − monthly budget). Monthly interest = balance × annual rate ÷ 12, rounded half-up to cents.</p>
            </Explain>
          </div>
        )}
        <details open={plan.repayment.strategyId === 'custom'} className="explain">
          <summary>Set a custom payoff order</summary>
          <CustomOrder />
        </details>
      </section>
    </section>
  );
}

/**
 * Affordability context, shown only when the user entered take-home pay (US-501). Never a
 * recommendation and never changes the budget.
 */
function Affordability({ payment, label }: { payment: string; label: string }) {
  const { plan } = usePlanner();
  const { monthlyTakeHome, monthlyExpenses } = plan.postGradIncome;
  if (monthlyTakeHome === undefined) {
    return <p className="field-hint">Add your monthly take-home pay (and expenses) to compare payments with what you bring home.</p>;
  }
  let left: string | null = null;
  let share: string | null = null;
  try {
    const takeHome = new D(monthlyTakeHome);
    left = money(takeHome.minus(monthlyExpenses ?? '0').minus(payment));
    share = takeHome.gt(0) ? new D(payment).div(takeHome).times(100).toDecimalPlaces(1).toFixed(1) : null;
  } catch { return null; }
  const negative = new D(left).isNegative();
  return (
    <div className={negative ? 'affordability affordability--short' : 'affordability'}>
      <h4>Affordability check</h4>
      <dl className="inline-figures">
        <div><dt>Monthly take-home pay</dt><dd>{formatCurrency(monthlyTakeHome)}</dd></div>
        {monthlyExpenses !== undefined && <div><dt>Monthly living expenses</dt><dd>−{formatCurrency(monthlyExpenses)}</dd></div>}
        <div><dt>{label}</dt><dd>−{formatCurrency(payment)}</dd></div>
        <div><dt>{monthlyExpenses !== undefined ? 'Left each month' : 'Left before living expenses'}</dt><dd>{negative ? `−${formatCurrency(new D(left).abs().toFixed(2))}` : formatCurrency(left)}</dd></div>
      </dl>
      {share && <p className="field-hint">{label} is {share}% of your take-home pay.</p>}
      {negative && <p className="notice notice--warning"><span className="notice-icon" aria-hidden="true">!</span>This payment is more than {monthlyExpenses !== undefined ? 'what is left after your expenses' : 'your take-home pay'}.</p>}
    </div>
  );
}

function PayoffMode() {
  const { plan, update, projection, target, comparisonsUpdating, readiness } = usePlanner();
  const current = plan.repayment.payoffTarget ?? { mode: 'budget' };
  const [lastTarget, setLastTarget] = useState<Exclude<PayoffTarget, { mode: 'budget' }> | null>(current.mode === 'target' ? current : null);
  // Remember the last target so switching back to target mode restores it (adjusted during render).
  if (current.mode === 'target' && current !== lastTarget) setLastTarget(current);
  const repayment = projection?.repayment;
  const anchor = projection?.firstVoluntaryPaymentDate ?? addMonths(plan.settings.graduationDate, 7);

  function setMode(mode: 'budget' | 'target') {
    if (mode === current.mode) return;
    update(withTarget(mode === 'budget' ? { mode: 'budget' } : lastTarget ?? { mode: 'target', kind: 'duration', months: DEFAULT_TARGET_MONTHS }),
      mode === 'budget' ? 'Switch to choosing a monthly budget' : 'Switch to choosing a payoff target');
  }
  function setKind(kind: 'date' | 'duration') {
    if (current.mode !== 'target' || current.kind === kind) return;
    update(withTarget(kind === 'date'
      ? { mode: 'target', kind: 'date', date: addMonths(anchor, (current.kind === 'duration' ? current.months : DEFAULT_TARGET_MONTHS) - 1) }
      : { mode: 'target', kind: 'duration', months: DEFAULT_TARGET_MONTHS }), kind === 'date' ? 'Pay off by a date' : 'Pay off within a time');
  }

  return (
    <section className="repayment-block" aria-labelledby="repayment-mode-heading">
      <h3 id="repayment-mode-heading">How do you want to plan payoff?</h3>
      <RadioGroup name="repayment.payoffTarget.mode" legend="Planning mode" value={current.mode} onChange={setMode}
        options={[
          ['budget', 'Choose a monthly budget → see payoff'],
          ['target', 'Choose a payoff target → see the required monthly payment'],
        ]} />
      {current.mode === 'budget' ? (
        <dl className="inline-figures payoff-outcome" aria-label="Projected outcome with your monthly budget">
          <div><dt>Monthly debt budget</dt><dd>{formatCurrency(plan.postGradIncome.monthlyDebtBudget)}</dd></div>
          <div><dt>Debt-free date</dt><dd><ResultFigure result="debtFreeDate" nonPayoffValue="No debt-free date" value={repayment?.debtFreeDate ? formatMonthYear(repayment.debtFreeDate) : 'No debt-free date'} /></dd></div>
          <div><dt>Total interest</dt><dd><ResultFigure result="totalInterest" value={formatCurrency(repayment?.totalInterestPaid)} /></dd></div>
        </dl>
      ) : (
        <>
          <RadioGroup name="repayment.payoffTarget.kind" legend="Payoff target" value={current.kind} onChange={setKind}
            options={[['date', 'Pay off by date'], ['duration', 'Pay off within years and months']]} />
          {current.kind === 'date'
            ? <DateField id="repayment.payoffTarget.date" label="Pay off by" className="field--narrow" value={current.date}
                hint="The month of your last payment must be on or before this date."
                onCommit={date => update(withTarget({ mode: 'target', kind: 'date', date }), 'Change payoff target date')} />
            : <DurationFields months={current.months} />}
          <TargetResult />
        </>
      )}
      {current.mode === 'target' && readiness.results.targetPayment.state === 'incomplete' && !comparisonsUpdating && target === null && (
        <p className="field-hint">Add a loan with an amount borrowed to calculate the required payment.</p>
      )}
      <Explain>
        <p>The required payment is the smallest monthly budget, rounded up to the cent, that pays every loan off by your target in the same month-by-month projection as everything else: your strategy, loan dates, minimum payments and required-payment dates.</p>
        <p>Life events in your plan are included: income changes add their chosen share from their date and windfalls are applied in their month, on top of the required payment. The result is checked by running the projection again with that payment.</p>
        <p>"Within N years and months" counts from your first payment. The projection stops after 100 years; if no payment reaches the target within that limit, it says so — that is never forgiveness.</p>
      </Explain>
    </section>
  );
}

/** Years + months editor for repayment.payoffTarget.months (1–1200 months in total). */
function DurationFields({ months }: { months: number }) {
  const { update } = usePlanner();
  const years = Math.floor(months / 12);
  const rest = months % 12;
  // A part entered but rejected (e.g. Years 0 while Months is still 0 on the way from 1y 0m to 0y 11m) still
  // shows in its field, so the other part combines with it. Ignored once the stored target changes.
  const entered = useRef<{ base: number; years?: number; rest?: number }>({ base: months });
  const commit = (part: { years?: number; rest?: number }, focusId: string) => {
    const draft = { ...(entered.current.base === months ? entered.current : {}), ...part, base: months };
    entered.current = draft;
    const total = (draft.years ?? years) * 12 + (draft.rest ?? rest);
    if (total < 1 || total > 1200) {
      return { ok: false as const, errors: [{ path: focusId, code: 'OUT_OF_RANGE' as const, message: 'Choose from 1 month to 100 years in total.' }] };
    }
    return update(withTarget({ mode: 'target', kind: 'duration', months: total }), 'Change payoff target time');
  };
  return (
    <fieldset className="duration-fields">
      <legend>Pay off within</legend>
      <IntegerField id="repayment.payoffTarget.months" label="Years" min={0} max={100} value={years} className="field--narrow"
        onCommit={value => commit({ years: value }, 'repayment.payoffTarget.months')} />
      <IntegerField id="repayment.payoffTarget.months-part" label="Months" min={0} max={11} value={rest} className="field--narrow"
        onCommit={value => commit({ rest: value }, 'repayment.payoffTarget.months-part')} />
      <p className="field-hint">Counted from your first payment. Total: {plural(months, 'month')}.</p>
    </fieldset>
  );
}

function TargetResult() {
  const { plan, update, target, comparisonsUpdating } = usePlanner();
  if (!target) {
    return comparisonsUpdating ? <p className="updating" role="status">Calculating the required monthly payment…</p> : null;
  }
  if (target.status !== 'feasible') {
    return (
      <div className={`notice notice--warning target-result${comparisonsUpdating ? ' is-updating' : ''}`} role="status" data-status={target.status}>
        <span className="notice-icon" aria-hidden="true">!</span>
        <p><strong>{target.status === 'invalid' ? 'This target can\'t be calculated.' : 'This target can\'t be reached.'}</strong> {target.message}</p>
      </div>
    );
  }
  const required = target.requiredMonthlyBudget;
  const same = new D(target.difference).isZero();
  return (
    <div className={`target-result${comparisonsUpdating ? ' is-updating' : ''}`} aria-busy={comparisonsUpdating || undefined} data-status="feasible">
      <dl className="metrics">
        <Figure label="Required monthly payment" value={formatCurrency(required)} detail={`To be debt-free by ${formatMonthYear(target.targetDate)}`} />
        <Figure label="Your chosen budget" value={formatCurrency(target.chosenMonthlyBudget)} detail="Not changed by this calculation" />
        <Figure label="Difference" value={differenceSentence(target.difference)} />
        <Figure label="Projected outcome at the required payment" value={`Debt-free ${formatMonthYear(target.verifiedDebtFreeDate)}`} detail={`${formatCurrency(target.totalInterest)} total interest`} />
      </dl>
      <Affordability payment={required} label="The required payment" />
      {!same && (
        <div className="button-row">
          <button type="button" onClick={() => update(withIncome({ monthlyDebtBudget: required }), 'Use the required payment as my budget')}>
            Use {formatCurrency(required)} as my monthly budget
          </button>
          <span className="field-hint">Optional. Your budget only changes if you choose this; you can undo it.</span>
        </div>
      )}
      {plan.lifeEvents.some(event => event.type === 'income' || event.type === 'windfall') && (
        <p className="field-hint">Includes your life events: income changes and windfalls add to the required payment from their dates.</p>
      )}
    </div>
  );
}

function Figure({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd><span className="metric-value">{value}</span>{detail && <span className="metric-detail">{detail}</span>}</dd>
    </div>
  );
}

function VoluntaryStartFields() {
  const { plan, update } = usePlanner();
  const start = plan.repayment.voluntaryStart ?? { kind: 'afterGraduation', months: 6 };
  const graduation = plan.settings.graduationDate;
  return (
    <>
      <RadioGroup name="repayment.voluntaryStart.kind" legend="Start my payments" value={start.kind}
        onChange={kind => {
          if (kind === start.kind) return;
          update(withStart(kind === 'date'
            ? { kind: 'date', date: addMonths(graduation, start.kind === 'afterGraduation' ? start.months : 6) }
            : { kind: 'afterGraduation', months: 6 }), 'Change when payments start');
        }}
        options={[['afterGraduation', 'A number of months after graduation'], ['date', 'From a specific date']]} />
      {start.kind === 'afterGraduation'
        ? <IntegerField id="repayment.voluntaryStart.months" label="Months after graduation" min={0} max={60} value={start.months} className="field--narrow"
            hint={`0–60. Follows your graduation date (${formatDate(graduation)}). Your first payment is one month after the start.`}
            onCommit={months => update(withStart({ kind: 'afterGraduation', months }), 'Change when payments start')} />
        : <DateField id="repayment.voluntaryStart.date" label="Start paying from" value={start.date} className="field--narrow"
            hint="Your first payment is one month after this date. It can't be before your earliest loan disbursement."
            onCommit={date => update(withStart({ kind: 'date', date }), 'Change when payments start')} />}
      <p className="field-hint">This is when you choose to start paying. Lenders set when payments are required: if your start is later, the required payments are still owed and are listed below.</p>
    </>
  );
}

/** Native radio group in a fieldset (keyboard: Tab into the group, arrow keys to choose). */
function RadioGroup<V extends string>({ name, legend, value, options, onChange }: {
  name: string; legend: string; value: V; options: readonly (readonly [V, string])[]; onChange(value: V): void;
}) {
  return (
    <fieldset className="segmented radio-group" id={name}>
      <legend>{legend}</legend>
      {options.map(([key, label]) => (
        <label key={key}>
          <input type="radio" name={name} id={`${name}-${key}`} value={key} checked={value === key} onChange={() => onChange(key)} />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

function CustomOrder() {
  const { plan, update } = usePlanner();
  const [dragged, setDragged] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const order = effectiveCustomOrder(plan);
  const nameOf = (id: string) => plan.loans.find(loan => loan.id === id)?.name ?? 'Loan';

  function move(id: string, to: number, focusDirection?: 'up' | 'down') {
    const result = update(p => moveInCustomOrder(p, id, to), `Move ${nameOf(id)} in custom order`);
    if (result.ok) {
      setAnnouncement(`${nameOf(id)} moved to position ${to + 1} of ${order.length}.`);
      if (focusDirection) {
        requestAnimationFrame(() => {
          const button = document.getElementById(`order-${id}-${focusDirection}`) as HTMLButtonElement | null;
          (button && !button.disabled ? button : document.getElementById(`order-${id}-${focusDirection === 'up' ? 'down' : 'up'}`))?.focus();
        });
      }
    }
  }

  return (
    <div className="custom-order">
      <h4 id="custom-order-heading">Custom payoff order</h4>
      <p>
        {plan.repayment.strategyId === 'custom'
          ? 'Extra payments follow this order exactly.'
          : `Used when the payoff strategy is "${strategyName('custom')}".`} Drag a loan, or use the Move up and Move down buttons.
      </p>
      {order.length === 0 ? <p className="empty">Add loans to set a custom order.</p> : (
        <ol className="order-list" aria-labelledby="custom-order-heading">
          {order.map((id, index) => (
            <li
              key={id}
              draggable
              className={dragged === id ? 'is-dragging' : undefined}
              onDragStart={(event: DragEvent) => { setDragged(id); event.dataTransfer?.setData('text/plain', id); }}
              onDragOver={event => event.preventDefault()}
              onDrop={event => { event.preventDefault(); if (dragged) move(dragged, index); setDragged(null); }}
              onDragEnd={() => setDragged(null)}
            >
              <span className="order-handle" aria-hidden="true">⋮⋮</span>
              <span className="order-name">{index + 1}. {nameOf(id)}</span>
              <span className="order-buttons">
                <button type="button" id={`order-${id}-up`} disabled={index === 0} onClick={() => move(id, index - 1, 'up')}>
                  Move up<span className="visually-hidden"> {nameOf(id)}</span>
                </button>
                <button type="button" id={`order-${id}-down`} disabled={index === order.length - 1} onClick={() => move(id, index + 1, 'down')}>
                  Move down<span className="visually-hidden"> {nameOf(id)}</span>
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="visually-hidden" role="status">{announcement}</p>
    </div>
  );
}
