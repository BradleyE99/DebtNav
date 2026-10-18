import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { PayoffTarget, PlannerPlan, VoluntaryStart } from '../../engine/planner-contracts';
import { D, money } from '../../engine/money';
import { addMonths } from '../../engine/dates';
import { baseMonthlyBudget } from '../../engine/planner';
import { usePlanner } from '../PlannerContext';
import { DateField, IntegerField, MoneyField, OptionalMoneyField, PercentField, SelectField } from '../fields/fields';
import { formatCurrency, formatDate, formatMonthYear, isPositive, plural, strategyName, strategyOptions } from '../format';
import { effectiveCustomOrder, moveInCustomOrder } from '../planUpdates';
import { PaymentTiming } from '../results/PaymentTiming';
import './repayment.css';

/*
 * Repayment inputs shown inside Results (US-501/506/507): earnings and the chosen monthly payment,
 * payoff order, when payments start, the optional payoff target and the default share of raises.
 * These are the only editors of these values.
 */

const STRATEGY_OPTIONS = strategyOptions();
const DEFAULT_TARGET_MONTHS = 120;

type PostGrad = PlannerPlan['postGradIncome'];
const withIncome = (patch: Partial<PostGrad>) => (p: PlannerPlan): PlannerPlan => ({ ...p, postGradIncome: { ...p.postGradIncome, ...patch } });
const withTarget = (payoffTarget: PayoffTarget) => (p: PlannerPlan): PlannerPlan => ({ ...p, repayment: { ...p.repayment, payoffTarget } });
const withStart = (voluntaryStart: VoluntaryStart) => (p: PlannerPlan): PlannerPlan => ({ ...p, repayment: { ...p.repayment, voluntaryStart } });

/** "$120.00 more than your budget" / "$40.00 less than your budget" / "Same as your budget". */
export function differenceSentence(difference: string): string {
  const value = new D(difference);
  if (value.isZero()) return 'Same as your monthly payment';
  return `${formatCurrency(value.abs().toFixed(2))} ${value.isNegative() ? 'less' : 'more'} than your monthly payment`;
}

/** The regular monthly amount used for loans: monthlyDebtBudget (+ a legacy extra monthly payment). */
export function totalMonthlyPayment(plan: PlannerPlan): string {
  try { return money(baseMonthlyBudget(plan)); } catch { return plan.postGradIncome.monthlyDebtBudget; }
}

/** Earnings & payment: salary, take-home, expenses, the chosen monthly payment, affordability and payoff order. */
export function EarningsAndPayment() {
  const { plan, update, readiness } = usePlanner();
  const income = plan.postGradIncome;
  const budgetIsDefault = readiness.items.some(item => item.id === 'budget.default');
  const extraBudget = isPositive(plan.repayment.extraMonthlyPayment) ? plan.repayment.extraMonthlyPayment : null;
  const totalBudget = totalMonthlyPayment(plan);
  return (
    <>
      <div className="field-grid">
        <MoneyField id="postGradIncome.monthlyDebtBudget" label="Monthly payment" value={income.monthlyDebtBudget}
          hint={<>Total for all loans.{budgetIsDefault && <> <strong>Default value</strong>: confirm or change it.</>}{extraBudget && <> Plus a saved extra {formatCurrency(extraBudget)}/mo = {formatCurrency(totalBudget)}/mo.</>}</>}
          onCommit={monthlyDebtBudget => update(withIncome({ monthlyDebtBudget }), 'Change monthly payment')} />
        <MoneyField id="postGradIncome.annualSalary" label="Salary (before tax)" value={income.annualSalary}
          hint="Starting point for income changes."
          onCommit={annualSalary => update(withIncome({ annualSalary }), 'Change salary')} />
        <OptionalMoneyField id="postGradIncome.monthlyTakeHome" label="Monthly take-home pay" value={income.monthlyTakeHome}
          hint="Optional."
          onCommit={monthlyTakeHome => update(withIncome({ monthlyTakeHome }), 'Change monthly take-home pay')} />
        <OptionalMoneyField id="postGradIncome.monthlyExpenses" label="Monthly living expenses" value={income.monthlyExpenses}
          hint="Optional. Not counting loans."
          onCommit={monthlyExpenses => update(withIncome({ monthlyExpenses }), 'Change monthly living expenses')} />
      </div>
      <Affordability payment={totalBudget} label="Your monthly payment" />
      <MinimumsCheck />
      <details className="explain payoff-order">
        <summary>Payoff order <span className="subtle">{strategyName(plan.repayment.strategyId)}</span></summary>
        <div className="field-grid">
          <SelectField id="repayment.strategyId" label="Payoff strategy" options={STRATEGY_OPTIONS} value={plan.repayment.strategyId}
            hint="Where money beyond the minimums goes first."
            onCommit={strategyId => update(p => ({ ...p, repayment: { ...p.repayment, strategyId } }), 'Change payoff strategy')} />
        </div>
        {plan.repayment.strategyId === 'custom' && <CustomOrder />}
      </details>
    </>
  );
}

/** Sum of minimums and a shortfall warning (one message). */
function MinimumsCheck() {
  const { projection, readiness } = usePlanner();
  const ready = readiness.results.minimumPayments.state === 'complete' || readiness.results.minimumPayments.state === 'estimate';
  if (!projection || projection.minimumTotal === null || !ready) return null;
  return isPositive(projection.paymentShortfall) ? (
    <div className="notice notice--warning" role="status">
      <span className="notice-icon" aria-hidden="true">!</span>
      <p>Your monthly payment is <strong>{formatCurrency(projection.paymentShortfall)}</strong> short of the required minimums ({formatCurrency(projection.minimumTotal)}/mo).</p>
    </div>
  ) : (
    <p className="field-hint">Required minimums: {formatCurrency(projection.minimumTotal)}/mo.</p>
  );
}

/**
 * Affordability context, only when take-home pay is entered (US-501): one line with the share of
 * take-home and what is left. Never a recommendation and never changes the payment.
 */
function Affordability({ payment, label }: { payment: string; label: string }) {
  const { plan } = usePlanner();
  const { monthlyTakeHome, monthlyExpenses } = plan.postGradIncome;
  if (monthlyTakeHome === undefined) return null;
  let left: string | null = null;
  let share: string | null = null;
  try {
    const takeHome = new D(monthlyTakeHome);
    left = money(takeHome.minus(monthlyExpenses ?? '0').minus(payment));
    share = takeHome.gt(0) ? new D(payment).div(takeHome).times(100).toDecimalPlaces(1).toFixed(1) : null;
  } catch { return null; }
  const negative = new D(left).isNegative();
  const leftText = negative ? `−${formatCurrency(new D(left).abs().toFixed(2))}` : formatCurrency(left);
  return (
    <p className={negative ? 'affordability affordability--short' : 'affordability'}>
      {share && <>{label} is <strong>{share}%</strong> of take-home. </>}
      Leaves <strong>{leftText}/mo</strong>{monthlyExpenses !== undefined ? ' after expenses' : ' before living expenses'}.
      {negative && <> More than {monthlyExpenses !== undefined ? 'what is left after expenses' : 'your take-home pay'}.</>}
    </p>
  );
}

/** Repayment start: when you choose to start paying, plus each loan's required payment dates. */
export function RepaymentStart() {
  return (
    <>
      <VoluntaryStartFields />
      <PaymentTiming headingLevel={4} />
    </>
  );
}

/** "Default % for new income changes" (prefills new income changes only; existing ones keep theirs). */
export function RaiseDefaultField() {
  const { plan, update } = usePlanner();
  return (
    <PercentField id="postGradIncome.raiseAllocationPercent" label="Default % to debt for new income changes" max="100" className="field--narrow"
      value={plan.postGradIncome.raiseAllocationPercent} hint="Prefills new changes only."
      onCommit={raiseAllocationPercent => update(withIncome({ raiseAllocationPercent }), 'Change default share of raises')} />
  );
}

/** Optional payoff target: date or duration → the required monthly payment. Never changes the chosen payment. */
export function PayoffTargetSection() {
  const { plan, update, projection, target, comparisonsUpdating, readiness } = usePlanner();
  const current = plan.repayment.payoffTarget ?? { mode: 'budget' };
  const [lastTarget, setLastTarget] = useState<Exclude<PayoffTarget, { mode: 'budget' }> | null>(current.mode === 'target' ? current : null);
  // Remember the last target so switching back to target mode restores it (adjusted during render).
  if (current.mode === 'target' && current !== lastTarget) setLastTarget(current);
  const anchor = projection?.firstVoluntaryPaymentDate ?? addMonths(plan.settings.graduationDate, 7);

  function setMode(mode: 'budget' | 'target') {
    if (mode === current.mode) return;
    update(withTarget(mode === 'budget' ? { mode: 'budget' } : lastTarget ?? { mode: 'target', kind: 'duration', months: DEFAULT_TARGET_MONTHS }),
      mode === 'budget' ? 'Turn off payoff target' : 'Set a payoff target');
  }
  function setKind(kind: 'date' | 'duration') {
    if (current.mode !== 'target' || current.kind === kind) return;
    update(withTarget(kind === 'date'
      ? { mode: 'target', kind: 'date', date: addMonths(anchor, (current.kind === 'duration' ? current.months : DEFAULT_TARGET_MONTHS) - 1) }
      : { mode: 'target', kind: 'duration', months: DEFAULT_TARGET_MONTHS }), kind === 'date' ? 'Pay off by a date' : 'Pay off within a time');
  }

  return (
    <>
      <RadioGroup name="repayment.payoffTarget.mode" legend="Payoff target" value={current.mode} onChange={setMode}
        options={[
          ['budget', 'No target: use my monthly payment'],
          ['target', 'Show the payment needed to be debt-free by a target'],
        ]} />
      {current.mode === 'target' && (
        <>
          <RadioGroup name="repayment.payoffTarget.kind" legend="Target" value={current.kind} onChange={setKind}
            options={[['date', 'Pay off by date'], ['duration', 'Pay off within years and months']]} />
          {current.kind === 'date'
            ? <DateField id="repayment.payoffTarget.date" label="Pay off by" className="field--narrow" value={current.date}
                hint="Month of the last payment, at the latest."
                onCommit={date => update(withTarget({ mode: 'target', kind: 'date', date }), 'Change payoff target date')} />
            : <DurationFields months={current.months} />}
          <TargetResult />
        </>
      )}
      {current.mode === 'target' && readiness.results.targetPayment.state === 'incomplete' && !comparisonsUpdating && target === null && (
        <p className="field-hint">Add a loan with an amount borrowed to calculate the required payment.</p>
      )}
    </>
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
      <p className="field-hint">From your first payment. Total: {plural(months, 'month')}.</p>
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
        <Figure label="Your monthly payment" value={formatCurrency(target.chosenMonthlyBudget)} detail="Not changed by this calculation" />
        <Figure label="Difference" value={differenceSentence(target.difference)} />
        <Figure label="At the required payment" value={`Debt-free ${formatMonthYear(target.verifiedDebtFreeDate)}`} detail={`${formatCurrency(target.totalInterest)} total interest`} />
      </dl>
      {target.limitedByMinimum && <p className="field-hint">Your loans' required minimums alone reach this target.</p>}
      <Affordability payment={required} label="The required payment" />
      {!same && (
        <div className="button-row">
          <button type="button" onClick={() => update(withIncome({ monthlyDebtBudget: required }), 'Use the required payment as my monthly payment')}>
            Use {formatCurrency(required)} as my monthly payment
          </button>
          <span className="field-hint">Optional. You can undo it.</span>
        </div>
      )}
      {plan.lifeEvents.some(event => event.type === 'income' || event.type === 'windfall') && (
        <p className="field-hint">Includes your income changes and bonuses from their dates.</p>
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
        options={[['afterGraduation', 'Months after graduation'], ['date', 'From a date']]} />
      {start.kind === 'afterGraduation'
        ? <IntegerField id="repayment.voluntaryStart.months" label="Months after graduation" min={0} max={60} value={start.months} className="field--narrow"
            hint={`0–60, after ${formatDate(graduation)}. First payment one month later.`}
            onCommit={months => update(withStart({ kind: 'afterGraduation', months }), 'Change when payments start')} />
        : <DateField id="repayment.voluntaryStart.date" label="Start paying from" value={start.date} className="field--narrow"
            hint="First payment one month later."
            onCommit={date => update(withStart({ kind: 'date', date }), 'Change when payments start')} />}
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
      <h5 id="custom-order-heading">Custom payoff order</h5>
      <p className="field-hint">Drag a loan, or use Move up and Move down.</p>
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
