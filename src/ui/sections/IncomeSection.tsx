import { useEffect, useRef, useState } from 'react';
import type { PlannerYear, Resource } from '../../engine/planner-contracts';
import { D, money } from '../../engine/money';
import { usePlanner } from '../PlannerContext';
import { MoneyField, PercentField, QuantityField, SelectField, TextField } from '../fields/fields';
import { formatCurrency } from '../format';
import { newId } from '../ids';
import { updateResource, updateYear } from '../planUpdates';
import { onRevealRequest } from '../reveal';
import { resourceGrossValue, resourceValue } from '../../engine/planner';
import './income.css';

/** Gross annual earnings and the share available for school, both from the engine. */
export const annualEarnings = (resource: Resource): string => { try { return money(resourceGrossValue(resource)); } catch { return '0.00'; } };
export const availableForSchool = (resource: Resource): string => { try { return money(resourceValue(resource)); } catch { return '0.00'; } };

/** Work while in school for one year (job resources). They count toward that year's resources. */
export function WorkWhileInSchool({ year }: { year: PlannerYear }) {
  const { update, remove } = usePlanner();
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [revealedFieldId, setRevealedFieldId] = useState<string>();
  const addRef = useRef<HTMLButtonElement>(null);
  const jobs = year.resources.filter(resource => resource.type === 'job');

  useEffect(() => onRevealRequest(id => {
    setRevealedFieldId(id);
    const parts = id.split('.');
    if (parts[0] === 'schoolYears' && parts[1] === year.id && parts[2] === 'resources') setOpenJobId(parts[3]);
  }), [year.id]);

  function addEarnings() {
    const id = newId();
    const result = update(p => updateYear(p, year.id, current => ({ ...current, resources: [...current.resources, {
      id, type: 'job', label: 'Work', amount: '0.00', incomeMode: 'hourly',
      hourlyWage: '0.00', hoursPerWeek: '15', weeksWorked: '30', unavailablePercent: '0',
    }] })));
    if (result.ok) {
      setOpenJobId(id);
      requestAnimationFrame(() => document.getElementById('schoolYears.' + year.id + '.resources.' + id + '.hourlyWage')?.focus());
    }
  }

  return (
    <>
      {jobs.length === 0 && <p className="empty">No work entered for this year.</p>}
      <div className="income-jobs">
        {jobs.map(resource => <details key={resource.id} className="income-job" open={openJobId === resource.id}
          onToggle={event => {
            if (event.currentTarget.open) setOpenJobId(resource.id);
            else setOpenJobId(current => current === resource.id ? null : current);
          }}>
          <summary><span>{resource.label || 'Work'}</span><span className="income-job-summary">{formatCurrency(annualEarnings(resource))} / year · {formatCurrency(availableForSchool(resource))} for school</span><span className="income-edit-label">Edit</span></summary>
          <EarningsFields yearId={year.id} resource={resource} requestedFieldId={revealedFieldId} />
          <button type="button" className="button-danger" onClick={() => {
            remove('Remove work "' + resource.label + '"', p => updateYear(p, year.id, current => ({ ...current, resources: current.resources.filter(item => item.id !== resource.id) })));
            addRef.current?.focus();
          }}>Remove<span className="visually-hidden"> work {resource.label}</span></button>
        </details>)}
      </div>
      <button type="button" id="income-add-earnings" ref={addRef} onClick={addEarnings} disabled={year.resources.length >= 100}>Add work</button>
    </>
  );
}

function EarningsFields({ yearId, resource, requestedFieldId }: { yearId: string; resource: Resource; requestedFieldId?: string }) {
  const { update } = usePlanner();
  const base = 'schoolYears.' + yearId + '.resources.' + resource.id;
  const patch = (value: Partial<Resource>) => update(p => updateResource(p, yearId, resource.id, value));
  const revealHourly = ['hourlyWage', 'hoursPerWeek', 'weeksWorked'].some(field => requestedFieldId === base + '.' + field);
  const revealFixed = requestedFieldId === base + '.amount';
  return <div className="field-grid income-earnings-fields">
    <TextField id={base + '.label'} label="Description" value={resource.label} onCommit={label => patch({ label })} />
    <SelectField id={base + '.incomeMode'} label="Enter as" value={resource.incomeMode}
      options={[[ 'hourly', 'Hourly wage × hours × weeks' ], [ 'fixed', 'Fixed amount per year' ]]}
      onCommit={incomeMode => patch({ incomeMode })} />
    {(resource.incomeMode === 'hourly' || revealHourly) && <>
      <MoneyField id={base + '.hourlyWage'} label="Hourly wage" max="10000" value={resource.hourlyWage} onCommit={hourlyWage => patch({ hourlyWage })} />
      <QuantityField id={base + '.hoursPerWeek'} label="Hours per week" max="168" noun="hours" value={resource.hoursPerWeek} onCommit={hoursPerWeek => patch({ hoursPerWeek })} />
      <QuantityField id={base + '.weeksWorked'} label="Weeks per year" max="53" noun="weeks" value={resource.weeksWorked} onCommit={weeksWorked => patch({ weeksWorked })} />
      {resource.incomeMode !== 'hourly' && <p className="field-hint">Saved but unused while a fixed amount is selected.</p>}
    </>}
    {(resource.incomeMode === 'fixed' || revealFixed) && <MoneyField id={base + '.amount'} label="Fixed amount per year" value={resource.amount}
      hint={resource.incomeMode !== 'fixed' ? 'Saved but unused while hourly is selected.' : undefined}
      onCommit={amount => patch({ amount })} />}
    <PercentField id={base + '.unavailablePercent'} label="% for school" max="100"
      value={new D(100).minus(resource.unavailablePercent).toFixed()}
      onCommit={availablePercent => patch({ unavailablePercent: new D(100).minus(availablePercent).toFixed() })} />
  </div>;
}
