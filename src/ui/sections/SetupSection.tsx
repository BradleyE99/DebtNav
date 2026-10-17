import { useState } from 'react';
import type { PlannerPlan } from '../../engine/planner-contracts';
import { reconcileSchoolYears } from '../../engine/planner';
import { pruneDanglingReferences } from '../../engine/paths';
import { usePlanner } from '../PlannerContext';
import { DateField } from '../fields/fields';
import { Explain } from '../common/common';
import { formatDate, plural } from '../format';
import { yearHasData } from '../planUpdates';
import { navigateDashboard } from '../nav/navigation';

export function SetupSection() {
  const { plan, update, projection } = usePlanner();
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

  const firstPayment = projection?.firstVoluntaryPaymentDate ?? null;

  return (
    <section id="setup" className="panel" aria-labelledby="setup-heading">
      <h2 id="setup-heading">School timeline</h2>
      <p className="section-intro">Enter when school starts and when you expect to graduate. DebtNav creates one school year per academic year and keeps the data of every year that still exists when you change these dates.</p>
      <div className="field-grid">
        <DateField id="settings.startDate" label="School start date" settle value={plan.settings.startDate} onCommit={value => commitDate('startDate', value)} />
        <DateField id="settings.graduationDate" label="Expected graduation date" settle value={plan.settings.graduationDate} onCommit={value => commitDate('graduationDate', value)} />
      </div>
      {removedNotice && (
        <p className="notice notice--warning" role="status">{removedNotice} Use <strong>Undo</strong> at the top of the page to restore them.</p>
      )}
      <p className="computed">
        {plural(plan.schoolYears.length, 'school year')} · Graduation <strong>{formatDate(plan.settings.graduationDate)}</strong>
        {firstPayment && <> · Your first payment <strong>{formatDate(firstPayment)}</strong></>}
      </p>
      <p className="field-hint">
        When payments start is set in two places: when you choose to start paying is under{' '}
        <a href="#repayment" onClick={event => { event.preventDefault(); navigateDashboard('repayment', 'repayment.voluntaryStart.months'); }}>Repayment Plan</a>,
        and when each lender requires payments is on that loan's card under{' '}
        <a href="#loans" onClick={event => { event.preventDefault(); navigateDashboard('loans'); }}>Loans</a>.
      </p>
      <Explain>
        <p>School years run from each anniversary of your start date; a graduation date that falls on an anniversary adds no extra year.</p>
        <p>There is no single grace period for every loan: federal Direct loans are estimated to require payments starting 6 months after graduation, and private loans follow the lender's terms you enter on each loan.</p>
      </Explain>
    </section>
  );
}
