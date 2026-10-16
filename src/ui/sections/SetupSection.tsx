import { useState } from 'react';
import type { PlannerPlan } from '../../engine/planner-contracts';
import { reconcileSchoolYears } from '../../engine/planner';
import { pruneDanglingReferences } from '../../engine/paths';
import { addMonths } from '../../engine/dates';
import { usePlanner } from '../PlannerContext';
import { DateField, IntegerField } from '../fields/fields';
import { Explain } from '../common/common';
import { formatDate, plural } from '../format';
import { yearHasData } from '../planUpdates';

export function SetupSection() {
  const { plan, update, store } = usePlanner();
  const [removedNotice, setRemovedNotice] = useState<string | null>(null);

  /** Applies a date change, keeping data in surviving years (US-101) and offering undo for removed years. */
  function commitDate(key: 'startDate' | 'graduationDate', value: string) {
    const withDate = (current: PlannerPlan): PlannerPlan =>
      reconcileSchoolYears({ ...current, settings: { ...current.settings, [key]: value } });
    const candidate = withDate(plan);
    const keptIds = new Set(candidate.schoolYears.map(year => year.id));
    const lost = plan.schoolYears.filter(year => !keptIds.has(year.id) && yearHasData(plan, year));
    if (lost.length) store.markUndoable(`Change school dates (removed ${plural(lost.length, 'school year')} with data)`);
    const result = update(current => pruneDanglingReferences(withDate(current)));
    setRemovedNotice(result.ok && lost.length
      ? `${plural(lost.length, 'school year')} with costs, resources, or linked records ${lost.length === 1 ? 'was' : 'were'} removed by this date change.`
      : null);
    return result;
  }

  const repaymentStart = addMonths(plan.settings.graduationDate, plan.settings.graceMonths);

  return (
    <section id="setup" className="panel" aria-labelledby="setup-heading">
      <h2 id="setup-heading">School timeline</h2>
      <p className="section-intro">Enter when school starts and when you expect to graduate. DebtNav creates one school year per academic year and keeps the data of every year that still exists when you change these dates.</p>
      <div className="field-grid">
        <DateField id="settings.startDate" label="School start date" settle value={plan.settings.startDate} onCommit={value => commitDate('startDate', value)} />
        <DateField id="settings.graduationDate" label="Expected graduation date" settle value={plan.settings.graduationDate} onCommit={value => commitDate('graduationDate', value)} />
        <IntegerField
          id="settings.graceMonths"
          label="Grace period (months)"
          hint="0–12 months. Federal Direct Loans usually have 6."
          min={0}
          max={12}
          value={plan.settings.graceMonths}
          onCommit={graceMonths => update(p => ({ ...p, settings: { ...p.settings, graceMonths } }))}
        />
      </div>
      {removedNotice && store.undo && (
        <p className="notice notice--warning" role="status">{removedNotice} Choose <strong>Undo</strong> above to restore them.</p>
      )}
      <p className="computed">
        {plural(plan.schoolYears.length, 'school year')} · Repayment starts <strong>{formatDate(repaymentStart)}</strong>
      </p>
      <Explain>
        <p>Repayment start = graduation date + grace months ({formatDate(plan.settings.graduationDate)} + {plural(plan.settings.graceMonths, 'month')}).</p>
        <p>School years run from each anniversary of your start date; a graduation date that falls on an anniversary adds no extra year.</p>
      </Explain>
    </section>
  );
}
