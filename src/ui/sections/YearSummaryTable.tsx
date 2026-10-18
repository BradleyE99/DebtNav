import { usePlanner } from '../PlannerContext';
import { TableRegion } from '../common/common';
import { formatCurrency, schoolYearLabel } from '../format';

/** Every school year side by side (College Costs → All years). Figures come from the engine's year summaries. */
export function YearSummaryTable() {
  const { plan, projection, readiness } = usePlanner();
  const noCosts = (yearId: string) => readiness.items.some(item => item.id === `costs.year.${yearId}.empty`);
  if (!projection) return <p className="field-hint">Totals appear when every amount in your plan is valid.</p>;
  return (
    <TableRegion label="School year summary table">
      <table>
        <caption>Cost, non-loan resources, funding gap, loans for the year and what is still unfunded</caption>
        <thead>
          <tr><th scope="col">Year</th><th scope="col">Total cost</th><th scope="col">Non-loan resources</th><th scope="col">Funding gap</th><th scope="col">Loans for this year</th><th scope="col">Still unfunded</th></tr>
        </thead>
        <tbody>
          {projection.years.map((year, index) => (
            <tr key={year.yearId}>
              <th scope="row">{plan.schoolYears[index] ? schoolYearLabel(plan.schoolYears[index], index) : `Year ${index + 1}`}</th>
              <td>{noCosts(year.yearId) ? <span className="placeholder">No costs entered</span> : formatCurrency(year.costs)}</td>
              <td>{formatCurrency(year.resources)}</td>
              <td>{noCosts(year.yearId) ? <span className="placeholder">—</span> : formatCurrency(year.gap)}</td>
              <td>{formatCurrency(year.borrowed)}</td>
              <td>{noCosts(year.yearId) ? <span className="placeholder">—</span> : formatCurrency(year.remaining)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableRegion>
  );
}
