import { useState, type DragEvent } from 'react';
import type { StrategyId } from '../../engine/planner-contracts';
import { usePlanner } from '../PlannerContext';
import { IntegerField, MoneyField, PercentField, SelectField } from '../fields/fields';
import { Explain } from '../common/common';
import { STRATEGY_LABELS, formatCurrency, isPositive } from '../format';
import { effectiveCustomOrder, moveInCustomOrder } from '../planUpdates';

const strategyOptions = Object.entries(STRATEGY_LABELS) as [StrategyId, string][];

export function RepaymentSection() {
  const { plan, update, projection } = usePlanner();
  return (
    <section id="repayment" className="panel" aria-labelledby="repayment-heading">
      <h2 id="repayment-heading">4. Life after graduation</h2>
      <p className="section-intro">Your expected salary and how much you can put toward loans each month drive the payoff projection.</p>
      <div className="field-grid">
        <MoneyField id="postGradIncome.annualSalary" label="Expected annual salary" value={plan.postGradIncome.annualSalary}
          onCommit={annualSalary => update(p => ({ ...p, postGradIncome: { ...p.postGradIncome, annualSalary } }))} />
        <MoneyField id="postGradIncome.monthlyDebtBudget" label="Monthly amount for all loans" hint="Total you can pay toward debt each month."
          value={plan.postGradIncome.monthlyDebtBudget}
          onCommit={monthlyDebtBudget => update(p => ({ ...p, postGradIncome: { ...p.postGradIncome, monthlyDebtBudget } }))} />
        <PercentField id="postGradIncome.raiseAllocationPercent" label="Share of future raises put toward debt" hint="Default for new income-change events."
          max="100" value={plan.postGradIncome.raiseAllocationPercent}
          onCommit={raiseAllocationPercent => update(p => ({ ...p, postGradIncome: { ...p.postGradIncome, raiseAllocationPercent } }))} />
        <SelectField id="repayment.strategyId" label="Payoff strategy" options={strategyOptions} value={plan.repayment.strategyId}
          hint="Where money beyond the minimums goes first."
          onCommit={strategyId => update(p => ({ ...p, repayment: { ...p.repayment, strategyId } }))} />
        <IntegerField id="repayment.maxMonths" label="Projection horizon (months)" hint="1–1200. 360 months = 30 years." min={1} max={1200}
          value={plan.repayment.maxMonths ?? 600}
          onCommit={maxMonths => update(p => ({ ...p, repayment: { ...p.repayment, maxMonths } }))} />
      </div>

      {projection && (
        <div className="computed-block">
          <p className="computed">Sum of minimum payments: <strong>{formatCurrency(projection.minimumTotal)}</strong> per month</p>
          {isPositive(projection.paymentShortfall) && (
            <div className="notice notice--warning" role="status">
              <span className="notice-icon" aria-hidden="true">!</span>
              <p>Your monthly amount is <strong>{formatCurrency(projection.paymentShortfall)}</strong> short of the minimum payments ({formatCurrency(projection.minimumTotal)}). The projection shows what happens if you pay only your monthly amount.</p>
            </div>
          )}
          <Explain>
            <p>Each month, every loan's minimum payment is paid first. Money left in your monthly amount goes to the loan your strategy picks: avalanche = highest rate first (ties: smallest balance), snowball = smallest balance first (ties: highest rate), custom = your order below. When a loan is paid off, its minimum rolls into the next target.</p>
            <p>Shortfall = max(0, sum of minimums − monthly amount). Monthly interest = balance × annual rate ÷ 12, rounded half-up to cents.</p>
          </Explain>
        </div>
      )}

      <CustomOrder />
    </section>
  );
}

function CustomOrder() {
  const { plan, update } = usePlanner();
  const [dragged, setDragged] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const order = effectiveCustomOrder(plan);
  const nameOf = (id: string) => plan.loans.find(loan => loan.id === id)?.name ?? 'Loan';

  function move(id: string, to: number, focusDirection?: 'up' | 'down') {
    const result = update(p => moveInCustomOrder(p, id, to));
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
      <h3 id="custom-order-heading">Custom payoff order</h3>
      <p>
        {plan.repayment.strategyId === 'custom'
          ? 'Extra payments follow this order exactly.'
          : 'Used when the payoff strategy is "Custom order".'} Drag a loan, or use the Move up and Move down buttons.
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
