import { useState, type MouseEvent } from 'react';
import type { Projection } from '../../engine/planner-contracts';
import { usePlanner } from '../PlannerContext';
import { Explain, TableRegion } from '../common/common';
import { formatCurrency, strategyName } from '../format';

/** Categorical series colors in fixed order (never cycled); identity is also carried by dash + legend. */
const SERIES = [
  { color: '#2a78d6', dash: undefined },
  { color: '#eb6834', dash: '8 4' },
  { color: '#1baf7a', dash: '2 4' },
  { color: '#eda100', dash: '12 4 2 4' },
  { color: '#e87ba4', dash: '4 4' },
  { color: '#008300', dash: '10 6' },
  { color: '#6250d6', dash: '1 3' },
  { color: '#e34948', dash: '14 3' },
] as const;

interface Line { key: string; name: string; projection: Projection }

const WIDTH = 720, HEIGHT = 300, LEFT = 72, RIGHT = 16, TOP = 16, BOTTOM = 40;

/** Balance at month m (0 = repayment start); null after the schedule ends unless paid off. */
function balanceAt(projection: Projection, month: number): string | null {
  if (month === 0) return projection.balanceAtRepaymentStart;
  const row = projection.amortizationSchedule[month - 1];
  if (row) return row.remainingBalance;
  return projection.status === 'paidOff' ? '0.00' : null;
}

/** Plot coordinate only (never used for money math). */
const toNumber = (value: string | null) => (value === null ? 0 : Number.parseFloat(value));

function niceMax(value: number): number {
  if (value <= 0) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find(s => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

export function BalanceChart() {
  const { plan, projection, comparisons } = usePlanner();
  const [mode, setMode] = useState<'strategy' | 'scenario'>('strategy');
  const [hoverMonth, setHoverMonth] = useState<number | null>(null);
  if (!projection || !comparisons) return null;

  const effectiveMode = mode === 'scenario' && plan.scenarios.length === 0 ? 'strategy' : mode;
  const lines: Line[] = effectiveMode === 'strategy'
    ? comparisons.strategyComparisons.map(item => ({ key: item.id, name: strategyName(item.id), projection: item.projection }))
    : [{ key: 'base', name: 'Base plan', projection: projection.repayment },
      ...comparisons.scenarioComparisons.map(item => ({ key: item.id, name: item.name, projection: item.projection }))];
  const charted = lines.slice(0, SERIES.length);
  const months = Math.max(1, ...charted.map(line => line.projection.amortizationSchedule.length));
  const maxBalance = niceMax(Math.max(0, ...charted.flatMap(line => [toNumber(line.projection.balanceAtRepaymentStart), ...line.projection.amortizationSchedule.map(row => toNumber(row.remainingBalance))])));
  const x = (month: number) => LEFT + (month / months) * (WIDTH - LEFT - RIGHT);
  const y = (balance: number) => TOP + (1 - balance / maxBalance) * (HEIGHT - TOP - BOTTOM);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => f * maxBalance);
  const yearStep = Math.max(1, Math.ceil(months / 12 / 8));
  const xTicks = Array.from({ length: Math.floor(months / 12 / yearStep) + 1 }, (_, i) => i * yearStep * 12);
  const sampleMonths = [...new Set([...Array.from({ length: Math.floor(months / 12) + 1 }, (_, i) => i * 12), months])];

  function onMove(event: MouseEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    setHoverMonth(Math.max(0, Math.min(months, Math.round(ratio * months))));
  }

  const firstYear = Number(projection.repayment.firstPaymentDate.slice(0, 4));
  const description = charted.map(line => `${line.name}: ${formatCurrency(line.projection.balanceAtRepaymentStart)} at repayment start, ${line.projection.debtFreeDate ? `paid off after ${line.projection.amortizationSchedule.length} months` : 'not paid off within the horizon'}`).join('; ');

  return (
    <>
      <h3>Balance over time</h3>
      {plan.scenarios.length > 0 && (
        <fieldset className="segmented">
          <legend>Compare</legend>
          <label><input type="radio" name="chart-mode" checked={effectiveMode === 'strategy'} onChange={() => setMode('strategy')} /> Payoff strategies</label>
          <label><input type="radio" name="chart-mode" checked={effectiveMode === 'scenario'} onChange={() => setMode('scenario')} /> Scenarios</label>
        </fieldset>
      )}
      <ul className="chart-legend" aria-label="Chart legend">
        {charted.map((line, index) => (
          <li key={line.key}>
            <svg width="32" height="10" aria-hidden="true"><line x1="0" y1="5" x2="32" y2="5" stroke={SERIES[index].color} strokeWidth="3" strokeDasharray={SERIES[index].dash} /></svg>
            {line.name}
          </li>
        ))}
      </ul>
      <figure className="chart">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby="balance-chart-title balance-chart-desc" className="balance-chart">
          <title id="balance-chart-title">Total loan balance over time</title>
          <desc id="balance-chart-desc">{description}. The table below lists the same values.</desc>
          {yTicks.map(tick => (
            <g key={tick}>
              <line x1={LEFT} x2={WIDTH - RIGHT} y1={y(tick)} y2={y(tick)} className="chart-grid" />
              <text x={LEFT - 8} y={y(tick) + 4} textAnchor="end" className="chart-axis">{tick >= 1000 ? `$${Math.round(tick / 1000)}k` : `$${Math.round(tick)}`}</text>
            </g>
          ))}
          {xTicks.map(tick => (
            <text key={tick} x={x(tick)} y={HEIGHT - BOTTOM + 18} textAnchor="middle" className="chart-axis">{Number.isFinite(firstYear) ? firstYear + tick / 12 : `${tick / 12}y`}</text>
          ))}
          <line x1={LEFT} x2={WIDTH - RIGHT} y1={y(0)} y2={y(0)} className="chart-baseline" />
          {charted.map((line, index) => {
            const points = Array.from({ length: line.projection.amortizationSchedule.length + 1 }, (_, m) => `${x(m).toFixed(1)},${y(toNumber(balanceAt(line.projection, m))).toFixed(1)}`).join(' ');
            return <polyline key={line.key} points={points} fill="none" stroke={SERIES[index].color} strokeWidth="2" strokeDasharray={SERIES[index].dash} strokeLinejoin="round" />;
          })}
          {hoverMonth !== null && <line x1={x(hoverMonth)} x2={x(hoverMonth)} y1={TOP} y2={y(0)} className="chart-crosshair" />}
          <rect x={LEFT} y={TOP} width={WIDTH - LEFT - RIGHT} height={HEIGHT - TOP - BOTTOM} fill="transparent"
            onMouseMove={onMove} onMouseLeave={() => setHoverMonth(null)} />
        </svg>
        {hoverMonth !== null && (
          <div className="chart-tooltip" aria-hidden="true" style={{ left: `${(x(hoverMonth) / WIDTH) * 100}%` }}>
            <strong>Month {hoverMonth}</strong>
            {charted.map((line, index) => (
              <span key={line.key}><i style={{ background: SERIES[index].color }} /> {line.name}: {formatCurrency(balanceAt(line.projection, hoverMonth), '—')}</span>
            ))}
          </div>
        )}
        <figcaption className="field-hint">Horizontal axis: year of repayment. Vertical axis: total remaining balance.{lines.length > charted.length ? ` The chart shows the first ${charted.length} lines; the table lists all.` : ''}</figcaption>
      </figure>
      <details className="chart-data">
        <summary>Show chart data as a table</summary>
        <TableRegion label="Balance over time data table">
          <table>
            <caption>Total balance at the start of each repayment year</caption>
            <thead>
              <tr><th scope="col">Month</th>{lines.map(line => <th key={line.key} scope="col">{line.name}</th>)}</tr>
            </thead>
            <tbody>
              {sampleMonths.map(month => (
                <tr key={month}>
                  <th scope="row">{month}</th>
                  {lines.map(line => <td key={line.key}>{formatCurrency(balanceAt(line.projection, month), '—')}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      </details>
      <Explain>
        <p>Each line is the total remaining balance of all loans after each monthly payment, starting from the balance at repayment start (principal + capitalized interest). Strategy lines project the same plan with each payoff order; scenario lines project each scenario.</p>
      </Explain>
    </>
  );
}
