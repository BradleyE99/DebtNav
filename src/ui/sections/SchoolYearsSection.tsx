import { useEffect, useRef, useState } from 'react';
import type { CostItem, CostPeriod, PlannerYear, Resource, YearSummary } from '../../engine/planner-contracts';
import { attributedYearIndex, borrowingStillNeeded, copyYearCosts, createLoanFromGap, resourceValue } from '../../engine/planner';
import { D, money, sum } from '../../engine/money';
import { usePlanner } from '../PlannerContext';
import {
  MoneyField, PercentField, SelectField, TextField,
} from '../fields/fields';
import { Explain } from '../common/common';
import {
  COST_CATEGORY_LABELS, COST_PERIOD_LABELS, RESOURCE_TYPE_LABELS, formatCurrency, formatDate, isPositive, schoolYearLabel,
} from '../format';
import { updateCost, updateResource, updateYear } from '../planUpdates';
import { newId } from '../ids';
import { SchoolDates, schoolDatesSummary } from './SetupSection';
import { WorkWhileInSchool, availableForSchool } from './IncomeSection';
import { EventList } from './EventsSection';
import { YearSummaryTable } from './YearSummaryTable';
import { onRevealRequest, revealField } from '../reveal';

const categoryOptions = Object.entries(COST_CATEGORY_LABELS) as [CostItem['category'], string][];
const periodOptions = Object.entries(COST_PERIOD_LABELS) as [CostPeriod, string][];
const resourceOptions = Object.entries(RESOURCE_TYPE_LABELS).filter(([type]) => type !== 'job') as [Resource['type'], string][];

/** Value a resource contributes after the unavailable share, from the engine (display text). */
export function resourceAmount(resource: Resource): string {
  try { return money(resourceValue(resource)); } catch { return '0.00'; }
}

export function SchoolYearsSection({ onLoanCreated, requestedFieldId }: { onLoanCreated(loanId: string): void; requestedFieldId?: string }) {
  const { plan, projection } = usePlanner();
  const [selectedYearId, setSelectedYearId] = useState(() => requestedFieldId?.startsWith('schoolYears.') ? requestedFieldId.split('.')[1] : plan.schoolYears[0]?.id);
  const [lastRequestedFieldId, setLastRequestedFieldId] = useState(requestedFieldId);
  if (lastRequestedFieldId !== requestedFieldId) {
    setLastRequestedFieldId(requestedFieldId);
    if (requestedFieldId?.startsWith('schoolYears.')) setSelectedYearId(requestedFieldId.split('.')[1]);
  }
  useEffect(() => onRevealRequest(id => {
    if (id.startsWith('schoolYears.')) setSelectedYearId(id.split('.')[1]);
    // A one-time aid or cost change is shown in the year it is attributed to.
    const event = plan.lifeEvents.find(item => id.startsWith(`lifeEvents.${item.id}.`));
    if (event && (event.type === 'aid' || event.type === 'expense')) {
      const index = attributedYearIndex(plan, event.schoolYearId, event.date);
      if (index >= 0) setSelectedYearId(plan.schoolYears[index].id);
    }
  }), [plan]);
  const index = Math.max(0, plan.schoolYears.findIndex(year => year.id === selectedYearId));
  const year = plan.schoolYears[index];
  return (
    <section id="school" className="panel" aria-labelledby="school-heading">
      <h2 id="school-heading">College Costs</h2>
      <div className="dashboard-toolbar">
        <div className="field field--narrow">
          <label htmlFor="costs-school-year">School year</label>
          <select id="costs-school-year" value={year?.id ?? ''} onChange={event => setSelectedYearId(event.target.value)}>
            {plan.schoolYears.map((item, i) => <option key={item.id} value={item.id}>{schoolYearLabel(item, i)}</option>)}
          </select>
        </div>
        <details className="editor-panel dates-control">
          <summary>Edit dates <span className="subtle">{schoolDatesSummary(plan)}</span></summary>
          <SchoolDates />
        </details>
      </div>
      {year && <YearCard key={year.id} year={year} index={index} previous={index > 0 ? plan.schoolYears[index - 1] : undefined} summary={projection?.years.find(item => item.yearId === year.id)} onLoanCreated={onLoanCreated} />}
      {plan.schoolYears.length > 1 && (
        <details className="editor-panel all-years">
          <summary>All years</summary>
          <YearSummaryTable />
        </details>
      )}
      <Explain>
        <p>Total cost = the year's cost items (whole-year and semester entries) + one-time cost changes for that year.</p>
        <p>Non-loan resources = grants, scholarships and savings × (1 − not available %) + work × % for school + one-time aid. Hourly work = wage × hours per week × weeks. Loans are never resources.</p>
        <p>Funding gap = max(0, total cost − non-loan resources). Loans for this year = loans assigned to this academic year. Still unfunded = max(0, funding gap − loans for this year).</p>
        <p>The optional buffer adds a cushion to the gap (gap × (1 + buffer % ÷ 100)) for a new loan; it is not part of what is still unfunded.</p>
      </Explain>
    </section>
  );
}

interface YearCardProps {
  year: PlannerYear;
  index: number;
  previous?: PlannerYear;
  summary?: YearSummary;
  onLoanCreated(loanId: string): void;
}

function YearCard({ year, index, previous, summary, onLoanCreated }: YearCardProps) {
  const { plan, update, remove, readiness } = usePlanner();
  const yearName = `Year ${index + 1}`;
  const noCosts = year.costItems.length === 0 && !(summary && isPositive(summary.costs));
  // The button offers what the year still needs: gap + buffer minus loans already allocated to it.
  const stillNeeded = summary ? borrowingStillNeeded(summary) : '0.00';
  const canCreate = isPositive(stillNeeded);
  const headingId = `year-${year.id}-heading`;
  const addCostRef = useRef<HTMLButtonElement>(null);
  const addResourceRef = useRef<HTMLButtonElement>(null);
  const grants = year.resources.filter(resource => resource.type !== 'job');
  const jobs = year.resources.filter(resource => resource.type === 'job');
  const yearEvents = plan.lifeEvents.filter(event => (event.type === 'aid' || event.type === 'expense') && attributedYearIndex(plan, event.schoolYearId, event.date) === index);

  const subtotals = periodOptions.map(([period, label]) => ({
    period, label, total: money(sum(year.costItems.filter(item => item.semester === period).map(item => item.amount))),
    count: year.costItems.filter(item => item.semester === period).length,
  }));
  const itemsTotal = money(sum(year.costItems.map(item => item.amount)));
  // One-time cost changes are part of the year's total cost (engine summary); shown as a line.
  const eventDelta = summary ? new D(summary.costs).minus(itemsTotal) : null;
  const eventCosts = eventDelta && eventDelta.gt(0) ? money(eventDelta) : null;
  const grantsTotal = money(sum(grants.map(resourceAmount)));
  const workTotal = money(sum(jobs.map(availableForSchool)));

  function addCost() {
    const id = newId();
    update(p => updateYear(p, year.id, y => ({ ...y, costItems: [...y.costItems, { id, category: 'tuition', label: 'Tuition', amount: '0.00', semester: 'annual' }] })));
    focusLater(`schoolYears.${year.id}.costItems.${id}.amount`);
  }

  /** Empty-year call to action outside the collapsed editor: adds a cost, opens the editor and focuses its amount. */
  function addFirstCost() {
    const id = newId();
    const result = update(p => updateYear(p, year.id, y => ({ ...y, costItems: [...y.costItems, { id, category: 'tuition', label: 'Tuition', amount: '0.00', semester: 'annual' }] })));
    if (result.ok) revealField(`schoolYears.${year.id}.costItems.${id}.amount`);
  }

  function addResource() {
    const id = newId();
    update(p => updateYear(p, year.id, y => ({
      ...y,
      resources: [...y.resources, { id, type: 'grant', label: 'Grant', amount: '0.00', incomeMode: 'fixed', hourlyWage: '15.00', hoursPerWeek: '15', weeksWorked: '30', unavailablePercent: '0' }],
    })));
    focusLater(`schoolYears.${year.id}.resources.${id}.amount`);
  }

  function createLoan() {
    const id = newId();
    const result = update(p => {
      const loan = createLoanFromGap(p, year.id, id);
      return { ...p, loans: [...p.loans, loan], repayment: { ...p.repayment, customOrder: [...p.repayment.customOrder, id] } };
    });
    if (result.ok) onLoanCreated(id);
  }

  return (
    <article className="year-card" aria-labelledby={headingId}>
      <h3 id={headingId}>{schoolYearLabel(year, index)} <span className="subtle">{formatDate(year.startDate)} – {formatDate(year.endDate)}</span></h3>
      <div className="gap-box">
        {noCosts && (
          <div className="empty-cta">
            <p><strong>No costs for {yearName}.</strong>{readiness.items.some(item => item.id === 'costs.none') ? ' Skip this if you only plan repayment of loans you already have.' : ''}</p>
            <button type="button" onClick={addFirstCost}>Add {yearName} costs</button>
          </div>
        )}
        {summary ? (
          <dl className="gap-figures" aria-label={`${yearName} totals`}>
            <div><dt>Total cost</dt><dd>{noCosts ? <span className="placeholder">—</span> : formatCurrency(summary.costs)}</dd></div>
            <div><dt>Non-loan resources</dt><dd>{formatCurrency(summary.resources)}</dd></div>
            <div className="gap-main"><dt>Funding gap</dt><dd>{noCosts ? <span className="placeholder">Needs costs</span> : formatCurrency(summary.gap)}</dd></div>
            <div><dt>Loans for this year</dt><dd>{formatCurrency(summary.borrowed)}</dd></div>
            <div className="gap-remaining"><dt>Still unfunded</dt><dd>{noCosts ? <span className="placeholder">Needs costs</span> : formatCurrency(summary.remaining)}</dd></div>
            {isPositive(summary.surplus) && <div><dt>Surplus</dt><dd>{formatCurrency(summary.surplus)}</dd></div>}
          </dl>
        ) : <p>Totals appear when every amount in your plan is valid.</p>}
        <div className="button-row">
          <button type="button" id={`schoolYears.${year.id}.createLoan`} onClick={createLoan} disabled={!canCreate} aria-describedby={`schoolYears.${year.id}.createLoan-hint`}>
            {canCreate ? `Create loan for ${formatCurrency(stillNeeded)}` : noCosts || !summary ? 'Create loan' : 'Fully funded'}<span className="visually-hidden"> for {yearName}</span>
          </button>
          <span className="field-hint" id={`schoolYears.${year.id}.createLoan-hint`}>{canCreate
            ? 'Gap + buffer minus loans for this year. Adds it to Loan Amounts; it never changes automatically.'
            : noCosts ? 'Available once costs exceed resources.'
              : summary && isPositive(summary.bufferedGap) ? 'Loans for this year already cover the gap + buffer.' : 'Nothing to borrow: resources cover the costs.'}</span>
        </div>
        <details className="buffer-control">
          <summary>Borrowing buffer <span className="subtle">{year.bufferPercent}%</span></summary>
          <PercentField id={`schoolYears.${year.id}.bufferPercent`} label="Buffer on top of the gap" max="100"
            value={year.bufferPercent} onCommit={bufferPercent => update(p => updateYear(p, year.id, y => ({ ...y, bufferPercent })))} className="field--narrow" />
          {summary && <p className="computed">Gap + buffer: <strong>{formatCurrency(summary.bufferedGap)}</strong></p>}
        </details>
      </div>

      <div className="year-edit-grid">
        <details className="editor-panel">
          <summary>Costs ({year.costItems.length}) <span className="subtle">{formatCurrency(summary ? summary.costs : itemsTotal)}</span></summary>
          {year.costItems.length === 0 && <p className="empty">No costs for {yearName}.</p>}
          <ul className="record-list">
            {year.costItems.map(item => {
              const base = `schoolYears.${year.id}.costItems.${item.id}`;
              return (
                <li key={item.id} className="record">
                  <SelectField id={`${base}.category`} label="Category" options={categoryOptions} value={item.category}
                    onCommit={category => update(p => updateCost(p, year.id, item.id, { category }))} />
                  <TextField id={`${base}.label`} label="Description" value={item.label}
                    onCommit={label => update(p => updateCost(p, year.id, item.id, { label }))} />
                  <MoneyField id={`${base}.amount`} label="Amount" value={item.amount}
                    onCommit={amount => update(p => updateCost(p, year.id, item.id, { amount }))} />
                  <SelectField id={`${base}.semester`} label="Period" options={periodOptions} value={item.semester}
                    onCommit={semester => update(p => updateCost(p, year.id, item.id, { semester }))} />
                  <button type="button" className="button-danger record-remove"
                    onClick={() => { remove(`Remove cost "${item.label}"`, p => updateYear(p, year.id, y => ({ ...y, costItems: y.costItems.filter(c => c.id !== item.id) }))); addCostRef.current?.focus(); }}>
                    Remove<span className="visually-hidden"> cost {item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" id={`schoolYears.${year.id}.costItems-add`} ref={addCostRef} onClick={addCost} disabled={year.costItems.length >= 100}>Add cost<span className="visually-hidden"> to {yearName}</span></button>
          <dl className="subtotals" aria-label={`${yearName} cost totals`}>
            {subtotals.filter(item => item.count > 0 && item.period !== 'annual').map(item => (
              <div key={item.period}><dt>{item.label} subtotal</dt><dd>{formatCurrency(item.total)}</dd></div>
            ))}
            {eventCosts && <div><dt>Cost items</dt><dd>{formatCurrency(itemsTotal)}</dd></div>}
            {eventCosts && <div><dt>One-time cost changes</dt><dd>+{formatCurrency(eventCosts)}</dd></div>}
            <div className="subtotal-total"><dt>{yearName} cost total</dt><dd>{formatCurrency(summary && eventCosts ? summary.costs : itemsTotal)}</dd></div>
          </dl>
          {previous && <CopyForward year={year} previous={previous} index={index} />}
        </details>
        <details className="editor-panel">
          <summary>Grants &amp; savings ({grants.length}) <span className="subtle">{formatCurrency(grantsTotal)}</span></summary>
          {grants.length === 0 && <p className="empty">No grants, scholarships, savings or family help yet.</p>}
          <ul className="record-list">
            {grants.map(resource => (
              <ResourceRow key={resource.id} yearId={year.id} resource={resource}
                onRemove={() => { remove(`Remove resource "${resource.label}"`, p => updateYear(p, year.id, y => ({ ...y, resources: y.resources.filter(r => r.id !== resource.id) }))); addResourceRef.current?.focus(); }} />
            ))}
          </ul>
          <button type="button" id={`schoolYears.${year.id}.resources-add`} ref={addResourceRef} onClick={addResource} disabled={year.resources.length >= 100}>Add grant or savings<span className="visually-hidden"> to {yearName}</span></button>
        </details>
        <details className="editor-panel">
          <summary>Work while in school ({jobs.length}) <span className="subtle">{formatCurrency(workTotal)}</span></summary>
          <WorkWhileInSchool year={year} />
        </details>
        <details className="editor-panel">
          <summary>One-time aid or cost changes ({yearEvents.length})</summary>
          <EventList types={['aid', 'expense']} include={event => yearEvents.includes(event)}
            add={[['aid', 'Add aid'], ['expense', 'Add cost change']]} defaults={{ date: year.startDate, schoolYearId: year.id }}
            empty="None for this year." />
        </details>
      </div>

      {plan.loans.length > 0 && summary && summary.mismatchLoanIds.length > 0 && (
        <p className="notice notice--warning">The gap + buffer for {yearName} no longer matches {summary.mismatchLoanIds.length === 1 ? 'a loan' : 'loans'} created from it. See Loan Amounts.</p>
      )}
    </article>
  );
}

function ResourceRow({ yearId, resource, onRemove }: { yearId: string; resource: Resource; onRemove(): void }) {
  const { update } = usePlanner();
  const base = `schoolYears.${yearId}.resources.${resource.id}`;
  const patch = (value: Partial<Resource>) => update(p => updateResource(p, yearId, resource.id, value));
  return (
    <li className="record">
      <SelectField id={`${base}.type`} label="Type" options={resourceOptions} value={resource.type} onCommit={type => patch({ type })} />
      <TextField id={`${base}.label`} label="Description" value={resource.label} onCommit={label => patch({ label })} />
      <MoneyField id={`${base}.amount`} label="Amount for the year" value={resource.amount} onCommit={amount => patch({ amount })} />
      <PercentField id={`${base}.unavailablePercent`} label="% not available for school" max="100"
        value={resource.unavailablePercent} onCommit={unavailablePercent => patch({ unavailablePercent })} />
      <p className="record-result">Counts as <strong>{formatCurrency(resourceAmount(resource))}</strong></p>
      <button type="button" className="button-danger record-remove" onClick={onRemove}>
        Remove<span className="visually-hidden"> resource {resource.label}</span>
      </button>
    </li>
  );
}

function CopyForward({ year, previous, index }: { year: PlannerYear; previous: PlannerYear; index: number }) {
  const { update } = usePlanner();
  const [increase, setIncrease] = useState('0');
  const [message, setMessage] = useState<string | null>(null);
  const id = `copy-${year.id}-increase`;
  function copy() {
    const result = update(p => copyYearCosts(p, previous.id, year.id, increase), `Copy Year ${index} costs into Year ${index + 1}`);
    setMessage(result.ok
      ? `Copied ${previous.costItems.length} cost item${previous.costItems.length === 1 ? '' : 's'} from Year ${index} with a ${increase}% increase.`
      : result.errors[0]?.message ?? 'Could not copy costs.');
  }
  return (
    <div className="copy-forward">
      <PercentField id={id} label={`Increase when copying Year ${index} costs`} max="1000" value={increase}
        onCommit={value => { setIncrease(value); }} className="field--narrow" />
      <button type="button" onClick={copy} disabled={previous.costItems.length === 0}>
        Copy Year {index} costs into Year {index + 1}
      </button>
      {year.costItems.length > 0 && previous.costItems.length > 0 && <p className="field-hint">Copying replaces this year's {year.costItems.length} cost item{year.costItems.length === 1 ? '' : 's'}. You can undo it.</p>}
      <p role="status" className="field-hint">{message}</p>
      <Explain>
        <p>Each copied amount = Year {index} amount × (1 + increase % ÷ 100), rounded half-up to cents. Copying replaces this year's cost items; resources are not copied.</p>
      </Explain>
    </div>
  );
}

/** Focuses an element once it is rendered (after a record is added). */
function focusLater(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}
