import { useState } from 'react';
import type { PlannerPlan } from '../../engine/planner-contracts';
import { reconcileSchoolYears } from '../../engine/planner';
import { pruneDanglingReferences } from '../../engine/paths';
import { usePlanner } from '../PlannerContext';
import { DateField } from '../fields/fields';
import { formatDate, plural } from '../format';
import { yearHasData } from '../planUpdates';

/** School start and graduation dates (College Costs → Edit dates). One school year per academic year. */
export function SchoolDates() {
  const { plan, update } = usePlanner();
  const [removedNotice, setRemovedNotice] = useState<string | null>(null);

  /** Applies a date change, keeping data in surviving years (US-101); removed years can be undone from the history. */
  function commitDate(key: 'startDate' | 'graduationDate', value: string) {
    const withDate = (current: PlannerPlan): PlannerPlan =>
      reconcileSchoolYears({ ...current, settings: { ...current.settings, [key]: value } });
    const candidate = withDate(plan);
    const keptIds = new Set(candidate.schoolYears.map(year => year.id));
    const lost = plan.schoolYears.filter(year => !keptIds.has(year.id) && yearHasData(plan, year));
    const label = lost.length
      ? `Change school dates (removed ${plural(lost.length, 'school year')} with data)`
      : key === 'startDate' ? 'Change school start date' : 'Change graduation date';
    const result = update(current => pruneDanglingReferences(withDate(current)), label);
    setRemovedNotice(result.ok && lost.length
      ? `${plural(lost.length, 'school year')} with costs, resources, or linked records ${lost.length === 1 ? 'was' : 'were'} removed by this date change.`
      : null);
    return result;
  }

  return (
    <div className="school-dates">
      <div className="field-grid">
        <DateField id="settings.startDate" label="School start date" settle value={plan.settings.startDate} onCommit={value => commitDate('startDate', value)} />
        <DateField id="settings.graduationDate" label="Expected graduation date" settle value={plan.settings.graduationDate} onCommit={value => commitDate('graduationDate', value)} />
      </div>
      {removedNotice && (
        <p className="notice notice--warning" role="status">{removedNotice} Use <strong>Undo</strong> to restore them.</p>
      )}
    </div>
  );
}

/** "4 school years · Aug 2026 – May 2030" (summary line of the collapsed dates control). */
export function schoolDatesSummary(plan: PlannerPlan): string {
  return `${plural(plan.schoolYears.length, 'school year')} · ${formatDate(plan.settings.startDate)} – ${formatDate(plan.settings.graduationDate)}`;
}
