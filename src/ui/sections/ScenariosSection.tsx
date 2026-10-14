import { useMemo, useState } from 'react';
import type { OverrideValue, PlannerPlan, Scenario } from '../../engine/planner-contracts';
import { clearScenarioOverride, getPathValue, overridablePaths, setScenarioOverride } from '../../engine/paths';
import { formatRatePercent } from '../../data/parse';
import { usePlanner } from '../PlannerContext';
import { DateField, IntegerField, MoneyField, PercentField, RateField, SelectField, TextField } from '../fields/fields';
import { formatCurrency, strategyName } from '../format';
import { listStrategies } from '../../engine/strategies/registry';
import { updateScenario } from '../planUpdates';
import { newId } from '../ids';

type PathInfo = ReturnType<typeof overridablePaths>[number];

const COMMON_PATHS = ['postGradIncome.annualSalary', 'postGradIncome.monthlyDebtBudget', 'repayment.strategyId'];

export function ScenariosSection() {
  const { plan, update } = usePlanner();
  function addScenario() {
    const id = newId();
    update(p => ({ ...p, scenarios: [...p.scenarios, { id, name: `Scenario ${p.scenarios.length + 1}`, overrides: {} }] }));
    requestAnimationFrame(() => document.getElementById(`scenarios.${id}.name`)?.focus());
  }
  return (
    <section id="scenarios" className="panel" aria-labelledby="scenarios-heading">
      <h2 id="scenarios-heading" tabIndex={-1}>6. What-if scenarios</h2>
      <p className="section-intro">A scenario starts identical to your plan. Only the fields you change are stored; everything else follows your base plan as you edit it.</p>
      {plan.scenarios.length === 0 && <p className="empty">No scenarios yet. Try a conservative one with a lower salary.</p>}
      {plan.scenarios.map(scenario => <ScenarioCard key={scenario.id} scenario={scenario} />)}
      <button type="button" className="button-primary" onClick={addScenario} disabled={plan.scenarios.length >= 20}>Add scenario</button>
    </section>
  );
}

function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const { plan, update, remove } = usePlanner();
  const paths = useMemo(() => overridablePaths(plan), [plan]);
  const [added, setAdded] = useState<string[]>([]);
  const [picked, setPicked] = useState('');
  const headingId = `scenarios.${scenario.id}-heading`;

  const extraPaths = [...new Set([...Object.keys(scenario.overrides), ...added])].filter(path => !COMMON_PATHS.includes(path));
  const pickable = paths.filter(info => !COMMON_PATHS.includes(info.path) && !extraPaths.includes(info.path));
  const overrideCount = Object.keys(scenario.overrides).length;

  function addPicked() {
    if (!picked) return;
    setAdded(list => [...list, picked]);
    const path = picked;
    setPicked('');
    requestAnimationFrame(() => document.getElementById(overrideId(scenario.id, path))?.focus());
  }

  return (
    <article className="scenario-card" aria-labelledby={headingId}>
      <h3 id={headingId}>{scenario.name} <span className="subtle">{overrideCount === 0 ? 'Same as base plan' : `${overrideCount} field${overrideCount === 1 ? '' : 's'} changed`}</span></h3>
      <TextField id={`scenarios.${scenario.id}.name`} label="Scenario name" value={scenario.name}
        onCommit={name => update(p => updateScenario(p, scenario.id, { name }))} className="field--wide" />

      <h4>Common assumptions</h4>
      <ul className="override-list">
        {COMMON_PATHS.map(path => {
          const info = paths.find(item => item.path === path) ?? fallbackInfo(path);
          return <OverrideRow key={path} scenario={scenario} info={info} />;
        })}
      </ul>

      <h4>Other changed fields</h4>
      {extraPaths.length === 0 && <p className="empty">None. Pick any field below to change it in this scenario.</p>}
      <ul className="override-list">
        {extraPaths.map(path => {
          const info = paths.find(item => item.path === path);
          return info
            ? <OverrideRow key={path} scenario={scenario} info={info} onReset={() => setAdded(list => list.filter(item => item !== path))} />
            : null;
        })}
      </ul>
      <div className="override-picker">
        <div className="field">
          <label htmlFor={`scenarios.${scenario.id}.picker`}>Change another field</label>
          <select id={`scenarios.${scenario.id}.picker`} value={picked} onChange={event => setPicked(event.target.value)}>
            <option value="">Choose a field…</option>
            {pickable.map(info => <option key={info.path} value={info.path}>{info.label}</option>)}
          </select>
        </div>
        <button type="button" onClick={addPicked} disabled={!picked}>Add field<span className="visually-hidden"> to {scenario.name}</span></button>
      </div>

      <div className="button-row">
        <button type="button" disabled={overrideCount === 0}
          onClick={() => { remove(`Reset "${scenario.name}" to base`, p => updateScenario(p, scenario.id, { overrides: {} })); setAdded([]); }}>
          Reset all to base
        </button>
        <button type="button" className="button-danger"
          onClick={() => {
            remove(`Remove scenario "${scenario.name}"`, p => ({ ...p, scenarios: p.scenarios.filter(item => item.id !== scenario.id) }));
            requestAnimationFrame(() => document.getElementById('scenarios-heading')?.focus());
          }}>
          Remove scenario<span className="visually-hidden"> {scenario.name}</span>
        </button>
      </div>
    </article>
  );
}

const overrideId = (scenarioId: string, path: string) => `scenarios.${scenarioId}.overrides.${path}`;

function fallbackInfo(path: string): PathInfo {
  if (path === 'repayment.strategyId') return { path, label: 'Payoff strategy', kind: 'choice', options: listStrategies().map(entry => entry.id) };
  return { path, label: path === 'postGradIncome.annualSalary' ? 'Annual salary' : 'Monthly amount for all loans', kind: 'money' };
}

function displayValue(info: PathInfo, value: OverrideValue | undefined): string {
  if (value === undefined) return 'not set';
  if (info.kind === 'money') return formatCurrency(String(value));
  if (info.kind === 'rate') return `${formatRatePercent(String(value))}%`;
  if (info.kind === 'percent') return `${value}%`;
  if (info.path === 'repayment.strategyId') return strategyName(String(value));
  return String(value);
}

function OverrideRow({ scenario, info, onReset }: { scenario: Scenario; info: PathInfo; onReset?: () => void }) {
  const { plan, update } = usePlanner();
  const id = overrideId(scenario.id, info.path);
  const baseValue = getPathValue(plan, info.path);
  const overridden = Object.hasOwn(scenario.overrides, info.path);
  const value = overridden ? scenario.overrides[info.path] : baseValue;
  const commit = (next: OverrideValue) => update((p: PlannerPlan) => setScenarioOverride(p, scenario.id, info.path, next));
  const hint = overridden ? `Changed in this scenario · base plan: ${displayValue(info, baseValue)}` : 'Inherited from your base plan';
  const common = { id, label: info.label, hint };

  let field;
  switch (info.kind) {
    case 'money': field = <MoneyField {...common} value={String(value ?? '0')} onCommit={commit} />; break;
    case 'percent': field = <PercentField {...common} value={String(value ?? '0')} onCommit={commit} />; break;
    case 'rate': field = <RateField {...common} value={String(value ?? '0')} onCommit={commit} />; break;
    case 'integer': field = <IntegerField {...common} min={0} max={1200} value={Number(value ?? 0)} onCommit={commit} />; break;
    case 'date': field = <DateField {...common} value={String(value ?? '')} onCommit={commit} />; break;
    case 'choice': field = (
      <SelectField {...common} value={String(value ?? '')} onCommit={commit}
        options={(info.options ?? []).map(option => [option, info.path.endsWith('strategyId') ? strategyName(option) : option] as const)} />
    ); break;
    default: field = <TextField {...common} value={String(value ?? '')} onCommit={commit} />;
  }

  return (
    <li className={overridden ? 'override-row is-overridden' : 'override-row'}>
      {field}
      <span className={overridden ? 'badge badge--changed' : 'badge'}>{overridden ? 'Changed' : 'Inherited'}</span>
      {(overridden || onReset) && (
        <button type="button"
          onClick={() => { update(p => clearScenarioOverride(p, scenario.id, info.path)); onReset?.(); }}>
          Reset to base<span className="visually-hidden"> for {info.label}</span>
        </button>
      )}
    </li>
  );
}
