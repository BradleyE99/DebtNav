import { useRef, useState } from 'react';
import type { CostItem, CostPeriod, PlannerYear, Resource, YearSummary } from '../../engine/planner-contracts';
import { copyYearCosts, createLoanFromGap } from '../../engine/planner';
import { D, money, sum } from '../../engine/money';
import { usePlanner } from '../PlannerContext';
import {
  MoneyField, PercentField, QuantityField, SelectField, TextField,
} from '../fields/fields';
import { Explain } from '../common/common';
import {
  COST_CATEGORY_LABELS, COST_PERIOD_LABELS, RESOURCE_TYPE_LABELS, formatCurrency, formatDate, isPositive,
} from '../format';
import { updateCost, updateResource, updateYear } from '../planUpdates';
import { newId } from '../ids';

const categoryOptions = Object.entries(COST_CATEGORY_LABELS) as [CostItem['category'], string][];
const periodOptions = Object.entries(COST_PERIOD_LABELS) as [CostPeriod, string][];
const resourceOptions = Object.entries(RESOURCE_TYPE_LABELS) as [Resource['type'], string][];

/** Value a resource contributes after the unavailable share (display helper; engine is authoritative). */
export function resourceValue(resource: Resource): string {
  try {
    const gross = resource.type === 'job' && resource.incomeMode === 'hourly'
      ? new D(resource.hourlyWage).times(resource.hoursPerWeek).times(resource.weeksWorked)
      : new D(resource.amount);
    return money(gross.times(new D(1).minus(new D(resource.unavailablePercent).div(100))));
  } catch {
    return '0.00';
  }
}

export function SchoolYearsSection({ onLoanCreated }: { onLoanCreated(loanId: string): void }) {
  const { plan, projection } = usePlanner();
  return (
    <section id="school" className="panel" aria-labelledby="school-heading">
      <h2 id="school-heading">2. School costs and resources</h2>
      <p className="section-intro">Enter each year's costs and the money you have to pay them. The borrowing gap is a calculation, not a recommendation — you decide how much to borrow.</p>
      {plan.schoolYears.map((year, index) => (
        <YearCard
          key={year.id}
          year={year}
          index={index}
          previous={index > 0 ? plan.schoolYears[index - 1] : undefined}
          summary={projection?.years.find(item => item.yearId === year.id)}
          onLoanCreated={onLoanCreated}
        />
      ))}
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
  const { plan, update, remove } = usePlanner();
  const yearName = `Year ${index + 1}`;
  const headingId = `year-${year.id}-heading`;
  const addCostRef = useRef<HTMLButtonElement>(null);
  const addResourceRef = useRef<HTMLButtonElement>(null);

  const subtotals = periodOptions.map(([period, label]) => ({
    period, label, total: money(sum(year.costItems.filter(item => item.semester === period).map(item => item.amount))),
    count: year.costItems.filter(item => item.semester === period).length,
  }));
  const itemsTotal = money(sum(year.costItems.map(item => item.amount)));

  function addCost() {
    const id = newId();
    update(p => updateYear(p, year.id, y => ({ ...y, costItems: [...y.costItems, { id, category: 'tuition', label: 'Tuition', amount: '0.00', semester: 'annual' }] })));
    focusLater(`schoolYears.${year.id}.costItems.${id}.amount`);
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
      <h3 id={headingId}>{yearName} <span className="subtle">{formatDate(year.startDate)} – {formatDate(year.endDate)}</span></h3>

      {previous && <CopyForward year={year} previous={previous} index={index} />}

      <h4>Costs</h4>
      {year.costItems.length === 0 && <p className="empty">No costs yet for {yearName}.</p>}
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
      <button type="button" ref={addCostRef} onClick={addCost} disabled={year.costItems.length >= 100}>Add cost<span className="visually-hidden"> to {yearName}</span></button>
      <dl className="subtotals" aria-label={`${yearName} cost totals`}>
        {subtotals.filter(item => item.count > 0 && item.period !== 'annual').map(item => (
          <div key={item.period}><dt>{item.label} subtotal</dt><dd>{formatCurrency(item.total)}</dd></div>
        ))}
        <div className="subtotal-total"><dt>{yearName} cost total</dt><dd>{formatCurrency(itemsTotal)}</dd></div>
      </dl>

      <h4>Resources</h4>
      {year.resources.length === 0 && <p className="empty">No grants, scholarships, job income, savings, or family help yet.</p>}
      <ul className="record-list">
        {year.resources.map(resource => (
          <ResourceRow key={resource.id} yearId={year.id} resource={resource}
            onRemove={() => { remove(`Remove resource "${resource.label}"`, p => updateYear(p, year.id, y => ({ ...y, resources: y.resources.filter(r => r.id !== resource.id) }))); addResourceRef.current?.focus(); }} />
        ))}
      </ul>
      <button type="button" ref={addResourceRef} onClick={addResource} disabled={year.resources.length >= 100}>Add resource<span className="visually-hidden"> to {yearName}</span></button>

      <div className="gap-box">
        <h4>Borrowing gap</h4>
        {summary ? (
          <dl className="gap-figures">
            <div><dt>Cost of attendance</dt><dd>{formatCurrency(summary.costs)}</dd></div>
            <div><dt>Resources</dt><dd>{formatCurrency(summary.resources)}</dd></div>
            <div className="gap-main"><dt>Borrowing gap <span className="subtle">(a calculation, not a recommendation)</span></dt><dd>{formatCurrency(summary.gap)}</dd></div>
            {isPositive(summary.surplus) && <div><dt>Surplus (resources beyond costs)</dt><dd>{formatCurrency(summary.surplus)}</dd></div>}
            <div><dt>Gap + your buffer</dt><dd>{formatCurrency(summary.bufferedGap)}</dd></div>
            <div><dt>Already borrowed for this year</dt><dd>{formatCurrency(summary.borrowed)}</dd></div>
          </dl>
        ) : <p>Totals appear when every amount in your plan is valid.</p>}
        <PercentField id={`schoolYears.${year.id}.bufferPercent`} label="Borrowing buffer" hint="Extra cushion on top of the gap, 0–100%." max="100"
          value={year.bufferPercent} onCommit={bufferPercent => update(p => updateYear(p, year.id, y => ({ ...y, bufferPercent })))} className="field--narrow" />
        <button type="button" onClick={createLoan} disabled={!summary}>Create loan from gap<span className="visually-hidden"> for {yearName}</span></button>
        <p className="field-hint">Creates a loan pre-filled with the gap + buffer and this year's start date. You can edit it under Loans; it never changes automatically.</p>
        <Explain>
          <p>Cost of attendance = sum of all cost items (whole-year and semester entries) + school expense events for this year.</p>
          <p>Resources = Σ resource amount × (1 − unavailable % ÷ 100) + school aid events. Hourly job income = wage × hours per week × weeks worked.</p>
          <p>Gap = max(0, cost − resources). Surplus = max(0, resources − cost), shown separately. Gap + buffer = gap × (1 + buffer % ÷ 100), rounded to cents.</p>
        </Explain>
      </div>
      {plan.loans.length > 0 && summary && summary.mismatchLoanIds.length > 0 && (
        <p className="notice notice--warning">The gap + buffer for {yearName} no longer matches {summary.mismatchLoanIds.length === 1 ? 'a loan' : 'loans'} created from it. See Loans.</p>
      )}
    </article>
  );
}

function ResourceRow({ yearId, resource, onRemove }: { yearId: string; resource: Resource; onRemove(): void }) {
  const { update } = usePlanner();
  const base = `schoolYears.${yearId}.resources.${resource.id}`;
  const patch = (value: Partial<Resource>) => update(p => updateResource(p, yearId, resource.id, value));
  const hourly = resource.type === 'job' && resource.incomeMode === 'hourly';
  return (
    <li className="record">
      <SelectField id={`${base}.type`} label="Type" options={resourceOptions} value={resource.type} onCommit={type => patch({ type })} />
      <TextField id={`${base}.label`} label="Description" value={resource.label} onCommit={label => patch({ label })} />
      {resource.type === 'job' && (
        <SelectField id={`${base}.incomeMode`} label="Job income entered as" value={resource.incomeMode}
          options={[['fixed', 'Fixed yearly amount'], ['hourly', 'Hourly wage × hours × weeks']]} onCommit={incomeMode => patch({ incomeMode })} />
      )}
      {hourly ? (
        <>
          <MoneyField id={`${base}.hourlyWage`} label="Hourly wage" max="10000" value={resource.hourlyWage} onCommit={hourlyWage => patch({ hourlyWage })} />
          <QuantityField id={`${base}.hoursPerWeek`} label="Hours per week" max="168" noun="hours" value={resource.hoursPerWeek} onCommit={hoursPerWeek => patch({ hoursPerWeek })} />
          <QuantityField id={`${base}.weeksWorked`} label="Weeks worked" max="53" noun="weeks" value={resource.weeksWorked} onCommit={weeksWorked => patch({ weeksWorked })} />
        </>
      ) : (
        <MoneyField id={`${base}.amount`} label="Amount for the year" value={resource.amount} onCommit={amount => patch({ amount })} />
      )}
      <PercentField id={`${base}.unavailablePercent`} label="Not available for school" hint="Share already used elsewhere, e.g. living costs." max="100"
        value={resource.unavailablePercent} onCommit={unavailablePercent => patch({ unavailablePercent })} />
      <p className="record-result">Counts as <strong>{formatCurrency(resourceValue(resource))}</strong></p>
      <button type="button" className="button-danger record-remove" onClick={onRemove}>
        Remove<span className="visually-hidden"> resource {resource.label}</span>
      </button>
    </li>
  );
}

function CopyForward({ year, previous, index }: { year: PlannerYear; previous: PlannerYear; index: number }) {
  const { update, store } = usePlanner();
  const [increase, setIncrease] = useState('0');
  const [message, setMessage] = useState<string | null>(null);
  const id = `copy-${year.id}-increase`;
  function copy() {
    if (year.costItems.length) store.markUndoable(`Copy Year ${index} costs into Year ${index + 1}`);
    const result = update(p => copyYearCosts(p, previous.id, year.id, increase));
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
