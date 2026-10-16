import { useEffect, useRef, useState } from 'react';
import type { Resource } from '../../engine/planner-contracts';
import { D, money, sum } from '../../engine/money';
import { usePlanner } from '../PlannerContext';
import { MoneyField, PercentField, QuantityField, SelectField, TextField } from '../fields/fields';
import { formatCurrency, formatDate, isPositive } from '../format';
import { newId } from '../ids';
import { updateResource, updateYear } from '../planUpdates';
import { onRevealRequest } from '../reveal';
import { navigateDashboard } from '../nav/navigation';
import { baseMonthlyBudget, resourceGrossValue, resourceValue } from '../../engine/planner';
import './income.css';

/** Gross annual earnings and the share available for school, both from the engine. */
const annualEarnings = (resource: Resource): string => money(resourceGrossValue(resource));
const availableForSchool = (resource: Resource): string => money(resourceValue(resource));

/** Uses the existing job resources and post-graduation budget; there is one source of truth. */
export function IncomeSection({ requestedFieldId }: { requestedFieldId?: string }) {
  const { plan, projection, projectionUpdating, update, remove, readiness } = usePlanner();
  const requestedParts = requestedFieldId?.split('.');
  const [selectedYearId, setSelectedYearId] = useState(requestedParts?.[0] === 'schoolYears' ? requestedParts[1] : plan.schoolYears[0]?.id ?? '');
  const [openJobId, setOpenJobId] = useState<string | null>(requestedParts?.[2] === 'resources' ? requestedParts[3] : null);
  const [revealedFieldId, setRevealedFieldId] = useState(requestedFieldId);
  const [raisesOpen, setRaisesOpen] = useState(requestedFieldId === 'postGradIncome.raiseAllocationPercent');
  const addRef = useRef<HTMLButtonElement>(null);
  const year = plan.schoolYears.find(item => item.id === selectedYearId) ?? plan.schoolYears[0];
  const jobs = year?.resources.filter(resource => resource.type === 'job') ?? [];
  const yearSummary = projection?.years.find(item => item.yearId === year?.id);
  const budgetIsDefault = readiness.items.some(item => item.id === 'budget.default');
  const extraBudget = isPositive(plan.repayment.extraMonthlyPayment) ? plan.repayment.extraMonthlyPayment : null;
  const totalBudget = money(baseMonthlyBudget(plan));

  useEffect(() => onRevealRequest(id => {
    setRevealedFieldId(id);
    if (id === 'postGradIncome.raiseAllocationPercent') setRaisesOpen(true);
    const parts = id.split('.');
    if (parts[0] === 'schoolYears' && parts[2] === 'resources') {
      setSelectedYearId(parts[1]);
      setOpenJobId(parts[3]);
    }
  }), []);

  function addEarnings() {
    if (!year) return;
    const id = newId();
    const result = update(p => updateYear(p, year.id, current => ({ ...current, resources: [...current.resources, {
      id, type: 'job', label: 'School-year earnings', amount: '0.00', incomeMode: 'hourly',
      hourlyWage: '0.00', hoursPerWeek: '15', weeksWorked: '30', unavailablePercent: '0',
    }] })));
    if (result.ok) {
      setOpenJobId(id);
      requestAnimationFrame(() => document.getElementById('schoolYears.' + year.id + '.resources.' + id + '.hourlyWage')?.focus());
    }
  }

  return (
    <section id="income" className="panel" aria-labelledby="income-heading">
      <h2 id="income-heading">Income &amp; Earnings</h2>
      <p className="section-intro">Two separate things live here: earnings that help pay school costs while you study, and the monthly amount you can put toward loans after graduation.</p>
      <div className="income-columns">
        <section className="income-pane" aria-labelledby="school-income-heading">
          <h3 id="school-income-heading">While in school</h3>
          {year ? <>
            <SelectField id="income-school-year" label="School year" value={year.id}
              options={plan.schoolYears.map((item, index) => [item.id, 'Year ' + (index + 1) + ' · ' + formatDate(item.startDate) + ' – ' + formatDate(item.endDate)] as const)}
              onCommit={id => { setSelectedYearId(id); setOpenJobId(null); setRevealedFieldId(undefined); }} />
            <dl className="income-totals" aria-label="Selected school year earnings">
              <div><dt>Annual earnings</dt><dd>{formatCurrency(money(sum(jobs.map(annualEarnings))))}</dd></div>
              <div><dt>Available for school</dt><dd>{formatCurrency(money(sum(jobs.map(availableForSchool))))}</dd></div>
              <div><dt>Borrowing gap</dt><dd aria-busy={projectionUpdating}>{yearSummary ? formatCurrency(yearSummary.gap) : 'Unavailable'}</dd></div>
            </dl>
            <p className="field-hint">Only the share available for school counts toward this year's resources. Loans already created from a gap keep their entered amounts.</p>
            {jobs.length === 0 && <p className="empty">No earnings entered for this school year (optional). Add hourly work or a fixed annual amount if a job helps pay school costs.</p>}
            <div className="income-jobs">
              {jobs.map(resource => <details key={resource.id} className="income-job" open={openJobId === resource.id}
                onToggle={event => {
                  if (event.currentTarget.open) setOpenJobId(resource.id);
                  else setOpenJobId(current => current === resource.id ? null : current);
                }}>
                <summary><span>{resource.label || 'School-year earnings'}</span><span className="income-job-summary">{formatCurrency(annualEarnings(resource))} / year · {formatCurrency(availableForSchool(resource))} for school</span><span className="income-edit-label">Edit earnings</span></summary>
                <EarningsFields yearId={year.id} resource={resource} requestedFieldId={revealedFieldId} />
                <button type="button" className="button-danger" onClick={() => {
                  remove('Remove earnings "' + resource.label + '"', p => updateYear(p, year.id, current => ({ ...current, resources: current.resources.filter(item => item.id !== resource.id) })));
                  addRef.current?.focus();
                }}>Remove earnings<span className="visually-hidden"> {resource.label}</span></button>
              </details>)}
            </div>
            <button type="button" id="income-add-earnings" ref={addRef} onClick={addEarnings} disabled={year.resources.length >= 100}>Add earnings</button>
          </> : <p className="empty">Set your school dates in Plan setup to enter earnings by school year.</p>}
        </section>
        <section className="income-pane" aria-labelledby="postgrad-income-heading">
          <h3 id="postgrad-income-heading">After graduation</h3>
          <div className="field-grid income-postgrad-fields">
            <MoneyField id="postGradIncome.monthlyDebtBudget" label="Monthly amount available for loan payments" value={plan.postGradIncome.monthlyDebtBudget}
              hint={<>This is what actually pays your loans each month: the total for all loans, after taxes, living costs and other needs. Your debt-free date and total interest use it.{budgetIsDefault && <> <strong>Default value</strong>: replace it with your own amount.</>}{extraBudget && <> Your saved plan also adds {formatCurrency(extraBudget)}/mo, so the total used is {formatCurrency(totalBudget)}/mo.</>}</>}
              onCommit={monthlyDebtBudget => update(p => ({ ...p, postGradIncome: { ...p.postGradIncome, monthlyDebtBudget } }))} />
            <MoneyField id="postGradIncome.annualSalary" label="Expected annual salary" value={plan.postGradIncome.annualSalary}
              hint="Optional. Not used to pay loans: it is only the starting point for income changes and raises you add in Life events."
              onCommit={annualSalary => update(p => ({ ...p, postGradIncome: { ...p.postGradIncome, annualSalary } }))} />
          </div>
          <p className="field-hint">Example: a $55,000 salary does not mean $55,000 goes to loans. Only the monthly amount above is paid toward debt; a raise adds its chosen share to that amount from the raise date.</p>
          <details className="income-raises" open={raisesOpen} onToggle={event => setRaisesOpen(event.currentTarget.open)}>
            <summary>Default share of future raises for debt</summary>
            <PercentField id="postGradIncome.raiseAllocationPercent" label="Default share of raises put toward debt" max="100" value={plan.postGradIncome.raiseAllocationPercent}
              hint="Starting share for new income-change events. Each event keeps its own share; existing events do not change."
              onCommit={raiseAllocationPercent => update(p => ({ ...p, postGradIncome: { ...p.postGradIncome, raiseAllocationPercent } }))} />
          </details>
          <div className="income-actions">
            <button type="button" onClick={() => navigateDashboard('events')}>Manage income changes &amp; raises</button>
            <button type="button" onClick={() => navigateDashboard('repayment')}>Review repayment plan</button>
          </div>
          <p className="field-hint">Add a new job, raise, or job ending in Life events. The event's chosen share changes your monthly loan budget from its date.</p>
        </section>
      </div>
    </section>
  );
}

function EarningsFields({ yearId, resource, requestedFieldId }: { yearId: string; resource: Resource; requestedFieldId?: string }) {
  const { update } = usePlanner();
  const base = 'schoolYears.' + yearId + '.resources.' + resource.id;
  const patch = (value: Partial<Resource>) => update(p => updateResource(p, yearId, resource.id, value));
  const revealHourly = ['hourlyWage', 'hoursPerWeek', 'weeksWorked'].some(field => requestedFieldId === base + '.' + field);
  const revealFixed = requestedFieldId === base + '.amount';
  return <div className="field-grid income-earnings-fields">
    <TextField id={base + '.label'} label="Earnings description" value={resource.label} onCommit={label => patch({ label })} />
    <SelectField id={base + '.incomeMode'} label="Enter earnings as" value={resource.incomeMode}
      options={[[ 'hourly', 'Hourly wage × hours × weeks' ], [ 'fixed', 'Fixed annual earnings' ]]}
      onCommit={incomeMode => patch({ incomeMode })} />
    {(resource.incomeMode === 'hourly' || revealHourly) && <>
      <MoneyField id={base + '.hourlyWage'} label="Hourly wage" max="10000" value={resource.hourlyWage} onCommit={hourlyWage => patch({ hourlyWage })} />
      <QuantityField id={base + '.hoursPerWeek'} label="Hours worked per week" max="168" noun="hours" value={resource.hoursPerWeek} onCommit={hoursPerWeek => patch({ hoursPerWeek })} />
      <QuantityField id={base + '.weeksWorked'} label="Weeks worked per year" max="53" noun="weeks" value={resource.weeksWorked} onCommit={weeksWorked => patch({ weeksWorked })} />
      {resource.incomeMode !== 'hourly' && <p className="field-hint">These hourly assumptions are saved but unused while fixed annual earnings is selected.</p>}
    </>}
    {(resource.incomeMode === 'fixed' || revealFixed) && <MoneyField id={base + '.amount'} label="Fixed annual earnings" value={resource.amount}
      hint={resource.incomeMode !== 'fixed' ? 'Saved as an alternative; unused while hourly earnings is selected.' : undefined}
      onCommit={amount => patch({ amount })} />}
    <PercentField id={base + '.unavailablePercent'} label="Percentage available to pay school costs" max="100"
      value={new D(100).minus(resource.unavailablePercent).toFixed()}
      hint="The remainder is reserved for other expenses."
      onCommit={availablePercent => patch({ unavailablePercent: new D(100).minus(availablePercent).toFixed() })} />
  </div>;
}
