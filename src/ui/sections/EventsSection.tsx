import type { EventImpact, LifeEvent, LifeEventType } from '../../engine/planner-contracts';
import { D } from '../../engine/money';
import { usePlanner } from '../PlannerContext';
import { DateField, MoneyField, OptionalDateField, PercentField, SelectField, TextField } from '../fields/fields';
import { Explain } from '../common/common';
import { EVENT_TYPE_LABELS, formatCurrency, plural } from '../format';
import { updateEvent } from '../planUpdates';
import { newId } from '../ids';

const typeOptions = Object.entries(EVENT_TYPE_LABELS) as [LifeEventType, string][];

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

export function EventsSection() {
  const { plan, update, projection } = usePlanner();
  function addEvent() {
    const id = newId();
    update(p => ({
      ...p,
      lifeEvents: [...p.lifeEvents, {
        id, name: 'New event', type: 'windfall', date: projection?.repayment.firstPaymentDate ?? p.settings.graduationDate,
        amount: '0.00', allocationPercent: '100', recurrence: 'once',
      }],
    }));
    requestAnimationFrame(() => document.getElementById(`lifeEvents.${id}.name`)?.focus());
  }
  return (
    <section id="events" className="panel" aria-labelledby="events-heading">
      <h2 id="events-heading" tabIndex={-1}>5. Life events</h2>
      <p className="section-intro">Add dated changes — a raise, a bonus, a new grant — and see how each one moves your plan.</p>
      {plan.lifeEvents.length === 0 && <p className="empty">No life events yet.</p>}
      {plan.lifeEvents.map(event => <EventCard key={event.id} event={event} />)}
      <button type="button" className="button-primary" onClick={addEvent} disabled={plan.lifeEvents.length >= 100}>Add life event</button>
      <Explain>
        <p>Income change: from its month, your monthly amount for loans changes by (new salary − previous salary) ÷ 12 × share to debt. A new salary of $0 models a job ending.</p>
        <p>Windfall: amount × share to debt is paid toward loans in that month by your strategy (in the first repayment month if it happens earlier). Yearly windfalls repeat each anniversary until the end date or payoff.</p>
        <p>School expense / aid: added to the cost or resources of the selected school year (or the year containing the date).</p>
        <p>Impact compares the plan with and without the event.</p>
      </Explain>
    </section>
  );
}

function EventCard({ event }: { event: LifeEvent }) {
  const { plan, update, remove, comparisons, comparisonsUpdating } = usePlanner();
  const base = `lifeEvents.${event.id}`;
  const patch = (value: Partial<LifeEvent>) => update(p => updateEvent(p, event.id, value));
  const impact = comparisons?.eventImpacts.find(item => item.eventId === event.id);
  const schoolEvent = event.type === 'expense' || event.type === 'aid';
  const yearOptions: [string, string][] = [['', 'Year containing the date'], ...plan.schoolYears.map((year, i): [string, string] => [year.id, `Year ${i + 1}`])];
  const headingId = `${base}-heading`;

  return (
    <article className="event-card" aria-labelledby={headingId}>
      <h3 id={headingId}>{event.name} <span className="subtle">{EVENT_TYPE_LABELS[event.type]}</span></h3>
      <div className="field-grid">
        <TextField id={`${base}.name`} label="Event name" value={event.name} onCommit={name => patch({ name })} />
        <SelectField id={`${base}.type`} label="Event type" options={typeOptions} value={event.type} onCommit={type => patch({ type })} />
        <DateField id={`${base}.date`} label="Date" value={event.date} onCommit={date => patch({ date })} />
        <MoneyField id={`${base}.amount`} label={event.type === 'income' ? 'New annual salary' : 'Amount'} value={event.amount} onCommit={amount => patch({ amount })} />
        {!schoolEvent && (
          <PercentField id={`${base}.allocationPercent`} label={event.type === 'income' ? 'Share of the change put toward debt' : 'Share put toward debt'} max="100"
            value={event.allocationPercent} onCommit={allocationPercent => patch({ allocationPercent })} />
        )}
        {event.type === 'windfall' && (
          <SelectField id={`${base}.recurrence`} label="Repeats" value={event.recurrence ?? 'once'}
            options={[['once', 'Once'], ['yearly', 'Every year']]} onCommit={recurrence => patch({ recurrence })} />
        )}
        {event.type === 'windfall' && event.recurrence === 'yearly' && (
          <OptionalDateField id={`${base}.recurrenceEndDate`} label="Last repeat on or before (optional)" hint="Leave blank to repeat until payoff."
            value={event.recurrenceEndDate} onCommit={recurrenceEndDate => patch({ recurrenceEndDate })} />
        )}
        {schoolEvent && (
          <SelectField id={`${base}.schoolYearId`} label="School year" options={yearOptions} value={event.schoolYearId ?? ''}
            onCommit={schoolYearId => patch({ schoolYearId: schoolYearId || undefined })} />
        )}
      </div>
      {!schoolEvent && (
        <p className={comparisonsUpdating ? 'impact is-updating' : 'impact'} aria-live="polite">{impactSentence(impact)}</p>
      )}
      <button type="button" className="button-danger"
        onClick={() => {
          remove(`Remove event "${event.name}"`, p => ({ ...p, lifeEvents: p.lifeEvents.filter(item => item.id !== event.id) }));
          requestAnimationFrame(() => document.getElementById('events-heading')?.focus());
        }}>
        Remove event<span className="visually-hidden"> {event.name}</span>
      </button>
    </article>
  );
}
