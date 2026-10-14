import { useState } from 'react';
import { usePlanner } from '../PlannerContext';
import { Explain, TableRegion } from '../common/common';
import { formatCurrency, formatMonthYear } from '../format';

const PAGE_SIZE = 24;

/** Month-by-month schedule, combined or per loan, with paging (US-504). */
export function AmortizationSchedule() {
  const { plan, projection } = usePlanner();
  const [loanId, setLoanId] = useState('all');
  const [requestedPage, setPage] = useState(0);
  if (!projection) return null;
  const schedule = projection.repayment.amortizationSchedule;
  const selected = loanId === 'all' || plan.loans.some(loan => loan.id === loanId) ? loanId : 'all';
  const rows = selected === 'all' ? schedule : schedule.filter(month => month.loans.some(loan => loan.loanId === selected));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pages - 1);
  const visible = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const loanName = plan.loans.find(loan => loan.id === selected)?.name;

  return (
    <>
      <h3 id="schedule-heading">Amortization schedule</h3>
      <div className="schedule-controls">
        <div className="field">
          <label htmlFor="schedule-loan">Show</label>
          <select id="schedule-loan" value={selected} onChange={event => { setLoanId(event.target.value); setPage(0); }}>
            <option value="all">All loans combined</option>
            {plan.loans.map(loan => <option key={loan.id} value={loan.id}>{loan.name}</option>)}
          </select>
        </div>
      </div>
      {rows.length === 0 ? <p className="empty">No repayment months to show.</p> : (
        <>
          <TableRegion label="Amortization schedule table">
            <table>
              <caption>
                {selected === 'all' ? 'All loans combined' : loanName}: months {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + visible.length} of {rows.length}
              </caption>
              <thead>
                <tr><th scope="col">Month</th><th scope="col">Date</th><th scope="col">Payment</th><th scope="col">Interest</th><th scope="col">Principal</th><th scope="col">Remaining balance</th></tr>
              </thead>
              <tbody>
                {visible.map(month => {
                  const row = selected === 'all' ? month : month.loans.find(loan => loan.loanId === selected);
                  return (
                    <tr key={month.month}>
                      <th scope="row">{month.month}</th>
                      <td>{formatMonthYear(month.date)}</td>
                      <td>{formatCurrency(row?.payment ?? '0')}</td>
                      <td>{formatCurrency(row?.interest ?? '0')}</td>
                      <td>{formatCurrency(row?.principal ?? '0')}</td>
                      <td>{formatCurrency(row?.remainingBalance ?? '0')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableRegion>
          <nav className="pager" aria-label="Amortization schedule pages">
            <button type="button" onClick={() => setPage(page - 1)} disabled={page === 0}>Previous 24 months</button>
            <span>Page {page + 1} of {pages}</span>
            <button type="button" onClick={() => setPage(page + 1)} disabled={page >= pages - 1}>Next 24 months</button>
          </nav>
        </>
      )}
      <Explain>
        <p>Each month: interest = balance × annual rate ÷ 12, rounded half-up to cents. Payment = minimum payment plus any extra your strategy sends to this loan; principal = payment − interest; remaining balance = previous balance − principal.</p>
        <p>The final payment is adjusted so the balance ends at exactly $0.00, so total principal paid equals the balance at repayment start. The combined view sums every loan for the month.</p>
      </Explain>
    </>
  );
}
