import { useState, type DragEvent } from 'react';
import { usePlanner } from '../PlannerContext';
import { IntegerField, SelectField } from '../fields/fields';
import { Explain } from '../common/common';
import { formatCurrency, isPositive, strategyName, strategyOptions } from '../format';
import { effectiveCustomOrder, moveInCustomOrder } from '../planUpdates';
import { revealField } from '../reveal';

const STRATEGY_OPTIONS = strategyOptions();

export function RepaymentSection() {
  const { plan, update, projection, readiness } = usePlanner();
  const minimumsReady = readiness.results.minimumPayments.state === 'complete' || readiness.results.minimumPayments.state === 'estimate';
  return (
    <section id="repayment" className="panel" aria-labelledby="repayment-heading">
      <h2 id="repayment-heading">Repayment plan</h2>
      <p className="section-intro">Choose how your monthly loan budget pays down debt. The budget itself is set in Income &amp; Earnings.</p>
      <div className="computed-block">
        <p className="computed">Monthly loan payment budget: <strong>{formatCurrency(plan.postGradIncome.monthlyDebtBudget)}</strong></p>
        <button type="button" onClick={() => revealField('postGradIncome.monthlyDebtBudget')}>Edit income &amp; payment budget</button>
      </div>
      <div className="field-grid">
        <SelectField id="repayment.strategyId" label="Payoff strategy" options={STRATEGY_OPTIONS} value={plan.repayment.strategyId}
          hint="Where money beyond the minimums goes first."
          onCommit={strategyId => update(p => ({ ...p, repayment: { ...p.repayment, strategyId } }))} />
        <IntegerField id="repayment.maxMonths" label="Projection horizon (months)" hint="1–1200. 360 months = 30 years." min={1} max={1200}
          value={plan.repayment.maxMonths ?? 600}
          onCommit={maxMonths => update(p => ({ ...p, repayment: { ...p.repayment, maxMonths } }))} />
      </div>

      {!minimumsReady && <p className="empty">Minimum payments appear once you add a loan with an amount borrowed.</p>}
      {projection && projection.minimumTotal !== null && minimumsReady && (
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

      <details open={plan.repayment.strategyId === 'custom'} className="explain">
        <summary>Set a custom payoff order</summary>
        <CustomOrder />
      </details>
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
