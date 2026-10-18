import { useState, type ReactNode } from 'react';
import type { EventImpact, LifeEvent, LifeEventType, PlannerPlan } from '../../engine/planner-contracts';
import { D } from '../../engine/money';
import { windfallSplit } from '../../engine/planner';
import { usePlanner } from '../PlannerContext';
import { DateField, MoneyField, OptionalDateField, PercentField, SelectField, TextField } from '../fields/fields';
import { EVENT_TYPE_LABELS, formatCurrency, formatDate, plural } from '../format';
import { updateEvent } from '../planUpdates';
import { newId } from '../ids';
import './compact-records.css';

/** Neutral impact sentence for one life event (US-703). */
export function impactSentence(impact: EventImpact | undefined): string {
  if (!impact) return 'Calculating this event\'s effect…';
  if (impact.monthsSaved === null && impact.interestSaved === null) {
    return 'This event\'s effect can\'t be measured because the plan doesn\'t reach a debt-free date within the projection horizon.';
  }
  const months = impact.monthsSaved;
  const datePart = months === null ? 'has an unmeasurable effect on your debt-free date'
    : months === 0 ? 'doesn\'t change your debt-free date'
      : `moves your debt-free date ${months > 0 ? 'earlier' : 'later'} by ${plural(Math.abs(months), 'month')}`;
  const interest = impact.interestSaved === null ? null : new D(impact.interestSaved);
  const interestPart = interest === null ? 'has an unmeasurable effect on interest'
    : interest.isZero() ? 'doesn\'t change total interest'
      : interest.gt(0) ? `saves ${formatCurrency(interest.toFixed(2))} interest`
        : `adds ${formatCurrency(interest.abs().toFixed(2))} interest`;
  return `This event ${datePart} and ${interestPart}.`;
}

/** A new event of `type` with neutral starting values (dates follow the plan; amounts start at $0 except salary). */
export function newEvent(plan: PlannerPlan, type: LifeEventType, id: string, options: { date?: string; schoolYearId?: string } = {}): LifeEvent {
  const date = options.date ?? plan.settings.graduationDate;
  switch (type) {
    case 'income':
      return { id, name: 'Raise', type, date, amount: plan.postGradIncome.annualSalary, allocationPercent: plan.postGradIncome.raiseAllocationPercent };
    case 'windfall':
      return { id, name: 'Bonus', type, date, amount: '0.00', allocationPercent: '100', recurrence: 'once' };
    case 'aid':
      return { id, name: 'New aid', type, date, amount: '0.00', allocationPercent: '100', schoolYearId: options.schoolYearId };
    case 'expense':
      return { id, name: 'Extra cost', type, date, amount: '0.00', allocationPercent: '100', schoolYearId: options.schoolYearId };
  }
}

interface EventListProps {
  /** Events shown (and types offered in each card's type select). */
  types: readonly LifeEventType[];
  /** Extra filter, e.g. the selected school year. */
  include?(event: LifeEvent): boolean;
  /** Add buttons: [type, label]; the button id is `lifeEvents-add-<type>`. */
  add: readonly (readonly [LifeEventType, string])[];
  /** Values for new events (date, school year). */
  defaults?: { date?: string; schoolYearId?: string };
  empty: ReactNode;
  /** Per-card extra line (e.g. resulting payment for an income change). */
  detail?(event: LifeEvent): ReactNode;
}

/** Compact cards for a group of life events, plus add buttons. Removing an event is undoable. */
export function EventList({ types, include = () => true, add, defaults, empty, detail }: EventListProps) {
  const { plan, update } = usePlanner();
  const [newEventId, setNewEventId] = useState<string | null>(null);
  const events = plan.lifeEvents.filter(event => types.includes(event.type) && include(event));
  function addEvent(type: LifeEventType) {
    const id = newId();
    const result = update(p => ({ ...p, lifeEvents: [...p.lifeEvents, newEvent(p, type, id, defaults)] }));
    if (result.ok) {
      setNewEventId(id);
      requestAnimationFrame(() => document.getElementById(`lifeEvents.${id}.name`)?.focus());
    }
  }
  return (
    <div className="event-list">
      {events.length === 0 && <p className="empty">{empty}</p>}
      <div className="compact-record-grid">
        {events.map(event => (
          <EventCard key={event.id} event={event} types={types} initiallyOpen={event.id === newEventId} detail={detail?.(event)} />
        ))}
      </div>
      <div className="button-row">
        {add.map(([type, label]) => (
          <button key={type} type="button" id={`lifeEvents-add-${type}`} onClick={() => addEvent(type)} disabled={plan.lifeEvents.length >= 100}>{label}</button>
        ))}
      </div>
    </div>
  );
}

function EventCard({ event, types, initiallyOpen, detail }: { event: LifeEvent; types: readonly LifeEventType[]; initiallyOpen: boolean; detail?: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  const { plan, update, remove, comparisons, comparisonsUpdating } = usePlanner();
  const base = `lifeEvents.${event.id}`;
  const patch = (value: Partial<LifeEvent>) => update(p => updateEvent(p, event.id, value));
  const impact = comparisons?.eventImpacts.find(item => item.eventId === event.id);
  const schoolEvent = event.type === 'expense' || event.type === 'aid';
  const typeOptions = types.map(type => [type, EVENT_TYPE_LABELS[type]] as [LifeEventType, string]);
  const yearOptions: [string, string][] = [['', 'Year containing the date'], ...plan.schoolYears.map((year, i): [string, string] => [year.id, `Year ${i + 1}`])];
  const headingId = `${base}-heading`;

  return (
    <details className="event-card compact-record-card" aria-labelledby={headingId} open={open} onToggle={e => setOpen(e.currentTarget.open)}>
      <summary>
        <h4 id={headingId}>{event.name}</h4>
        <span className="compact-record-meta">{formatDate(event.date)}{event.type === 'windfall' && event.recurrence === 'yearly' ? ' · every year' : ''}</span>
        <strong>{formatCurrency(event.amount)}{event.type === 'income' ? ' salary' : ''}</strong>
        {event.type === 'windfall' && <WindfallSummary event={event} />}
        {detail && <span className="compact-record-meta">{detail}</span>}
        <span className="compact-record-edit">Edit</span>
      </summary>
      <div className="compact-record-body">
        <div className="field-grid">
          <TextField id={`${base}.name`} label="Name" value={event.name} onCommit={name => patch({ name })} />
          {typeOptions.length > 1 && (
            <SelectField id={`${base}.type`} label="Type" options={typeOptions} value={event.type}
              onCommit={type => patch(type === 'income' && event.type !== 'income'
                ? { type, allocationPercent: plan.postGradIncome.raiseAllocationPercent }
                : { type })} />
          )}
          <DateField id={`${base}.date`} label="Date" value={event.date} onCommit={date => patch({ date })} />
          <MoneyField id={`${base}.amount`} label={event.type === 'income' ? 'New salary (before tax)' : 'Amount'} value={event.amount} onCommit={amount => patch({ amount })} />
          {!schoolEvent && (
            <PercentField id={`${base}.allocationPercent`} label={event.type === 'income' ? '% of the change to debt' : '% to debt'} max="100"
              value={event.allocationPercent} onCommit={allocationPercent => patch({ allocationPercent })} />
          )}
          {event.type === 'windfall' && (
            <SelectField id={`${base}.recurrence`} label="Repeats" value={event.recurrence ?? 'once'}
              options={[['once', 'Once'], ['yearly', 'Every year']]} onCommit={recurrence => patch({ recurrence })} />
          )}
          {event.type === 'windfall' && event.recurrence === 'yearly' && (
            <OptionalDateField id={`${base}.recurrenceEndDate`} label="Last repeat (optional)" hint="Blank: repeats until payoff."
              value={event.recurrenceEndDate} onCommit={recurrenceEndDate => patch({ recurrenceEndDate })} />
          )}
          {schoolEvent && (
            <SelectField id={`${base}.schoolYearId`} label="School year" options={yearOptions} value={event.schoolYearId ?? ''}
              onCommit={schoolYearId => patch({ schoolYearId: schoolYearId || undefined })} />
          )}
        </div>
        {event.type === 'windfall' && <WindfallSplit event={event} />}
        {!schoolEvent && (
          <p className={comparisonsUpdating ? 'impact is-updating' : 'impact'} aria-live="polite">{impactSentence(impact)}</p>
        )}
        <button type="button" className="button-danger"
          onClick={() => remove(`Remove event "${event.name}"`, p => ({ ...p, lifeEvents: p.lifeEvents.filter(item => item.id !== event.id) }))}>
          Remove<span className="visually-hidden"> event {event.name}</span>
        </button>
      </div>
    </details>
  );
}

/** "To debt $X · Kept $Y" for a bonus (engine split; nothing when the amount is invalid). */
function WindfallSplit({ event }: { event: LifeEvent }) {
  let split: ReturnType<typeof windfallSplit> | null = null;
  try { split = windfallSplit(event); } catch { /* invalid amount is reported at the field */ }
  if (!split) return null;
  return <p className="computed">To debt: <strong>{formatCurrency(split.toDebt)}</strong> · Kept: {formatCurrency(split.kept)}</p>;
}

function WindfallSummary({ event }: { event: LifeEvent }) {
  let toDebt: string | null = null;
  try { toDebt = windfallSplit(event).toDebt; } catch { /* invalid amount is reported at the field */ }
  return toDebt === null ? null : <span className="compact-record-meta">{formatCurrency(toDebt)} to debt</span>;
}
