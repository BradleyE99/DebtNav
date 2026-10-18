import { useId, type ReactNode } from 'react';
import type { ReadinessItem, ResultKey } from '../../data/readiness';
import { readinessStatusText } from '../../data/readiness';
import { usePlanner } from '../PlannerContext';
import { goToTarget } from '../nav/navigation';
import './readiness.css';

const PAYMENT_PROBLEMS = new Set(['repayment.nonPayoff', 'budget.shortfall']);

/** One checklist row: what is needed, why it matters, and a button that opens the field. */
function ReadinessRow({ item }: { item: ReadinessItem }) {
  const labelId = useId();
  return (
    <li className={`readiness-item readiness-item--${item.severity}`} data-readiness-id={item.id} data-severity={item.severity}>
      <div className="readiness-text">
        <strong id={labelId}>{item.label}</strong>
        <p>{item.why}</p>
      </div>
      <div className="readiness-actions">
        <button type="button" className="readiness-action" aria-describedby={labelId} onClick={() => goToTarget(item.target)}>
          {item.actionLabel}
        </button>
        {item.secondaryAction && (
          <button type="button" className="readiness-action readiness-action--secondary" aria-describedby={labelId}
            onClick={() => goToTarget(item.secondaryAction!.target)}>
            {item.secondaryAction.actionLabel}
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Status line + "Your plan needs…" checklist + collapsible assumptions. Rendered from the single
 * shared readiness result (usePlanner().readiness); updates live as values are entered.
 */
export function ReadinessPanel({ compact = false }: { compact?: boolean }) {
  const { readiness } = usePlanner();
  const headingId = useId();
  const needs = readiness.items.filter(item => item.severity === 'missing' || item.severity === 'invalid');
  // A plan that does not pay off, or a budget below the minimums, is a problem to see now, not an assumption.
  const problems = readiness.items.filter(item => PAYMENT_PROBLEMS.has(item.id));
  const checks = readiness.items.filter(item => (item.severity === 'warning' || item.severity === 'assumption') && !PAYMENT_PROBLEMS.has(item.id));
  const problemsId = `${headingId}-problems`;
  return (
    <div className={compact ? 'readiness readiness--compact' : 'readiness'}>
      <p className="readiness-status" role="status" aria-live="polite">{readinessStatusText(readiness)}</p>
      {needs.length > 0 && (
        <section className="readiness-needs" aria-labelledby={headingId}>
          <h3 id={headingId}>Your plan needs…</h3>
          <ol className="readiness-list">{needs.map(item => <ReadinessRow key={item.id} item={item} />)}</ol>
        </section>
      )}
      {problems.length > 0 && (
        <section className="readiness-needs readiness-problems" aria-labelledby={problemsId}>
          <h3 id={problemsId}>Check your payment plan</h3>
          <ul className="readiness-list">{problems.map(item => <ReadinessRow key={item.id} item={item} />)}</ul>
        </section>
      )}
      {checks.length > 0 && (
        <details className="readiness-checks">
          <summary>Check these assumptions ({checks.length})</summary>
          <p className="field-hint">Results are shown, but they rest on these values. Optional details stay optional.</p>
          <ul className="readiness-list">{checks.map(item => <ReadinessRow key={item.id} item={item} />)}</ul>
        </details>
      )}
    </div>
  );
}

interface ResultFigureProps {
  result: ResultKey;
  /** The formatted value, used when the result is complete or an estimate. */
  value: ReactNode;
  /** Text for the non-payoff state (default "Not paid off"). */
  nonPayoffValue?: string;
  testId?: string;
  /** Show the action button for incomplete / invalid / non-payoff states. */
  action?: boolean;
  /** Show the non-payoff reason next to the value (off where the checklist already states it). */
  reason?: boolean;
}

/**
 * Renders one figure by its readiness state: never a $0.00 or a date when its inputs are missing.
 * complete → value; estimate → value + "Estimate" chip; incomplete/invalid → placeholder + action;
 * nonPayoff → "Not paid off" + reason + action; notApplicable → neutral note.
 */
export function ResultFigure({ result, value, nonPayoffValue = 'Not paid off', testId, action = true, reason = true }: ResultFigureProps) {
  const { readiness } = usePlanner();
  const status = readiness.results[result];
  const item = readiness.items.find(entry => entry.id === status.itemIds[0]);
  const engineBlocked = status.state === 'invalid' && status.itemIds.every(id => id.startsWith('engine.'));
  const text = status.state === 'complete' || status.state === 'estimate' ? value
    : status.state === 'nonPayoff' ? nonPayoffValue
      : status.state === 'invalid' && engineBlocked ? 'Can\'t be projected'
        : status.summary ?? 'Not available';
  return (
    <span className={`result-figure result-figure--${status.state}`} data-state={status.state}>
      <span className="figure-value" data-testid={testId} data-state={status.state}>{text}</span>
      {status.state === 'estimate' && <span className="chip chip--estimate" title={status.summary}>Estimate<span className="visually-hidden">: {status.summary?.replace(/^Estimate: /, '')}</span></span>}
      {reason && status.state === 'nonPayoff' && status.summary && <span className="figure-reason">{status.summary.replace(/^Not paid off: /, '')}</span>}
      {action && item && (status.state === 'incomplete' || status.state === 'invalid' || status.state === 'nonPayoff') && (
        <button type="button" className="link-button figure-action" onClick={() => goToTarget(item.target)}>{item.actionLabel}</button>
      )}
    </span>
  );
}

/** Short card shown in place of a Results view whose inputs are not ready. */
export function NeedsCard({ result, title, children }: { result: ResultKey; title: string; children?: ReactNode }) {
  const { readiness } = usePlanner();
  const status = readiness.results[result];
  const items = readiness.items.filter(item => status.itemIds.includes(item.id));
  return (
    <div className="needs-card" data-state={status.state}>
      <h3>{title}</h3>
      <p>{status.state === 'notApplicable' ? `${status.summary ?? 'Not part of your plan'}.`
        : status.state === 'invalid' ? 'This view can\'t be shown until these values are fixed:'
          : 'This view needs:'}</p>
      {items.length > 0 && <ul className="readiness-list">{items.map(item => <ReadinessRow key={item.id} item={item} />)}</ul>}
      {children}
    </div>
  );
}
