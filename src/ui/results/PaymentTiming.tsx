import type { LoanPaymentTiming } from '../../engine/planner-contracts';
import { usePlanner } from '../PlannerContext';
import { TableRegion } from '../common/common';
import { formatDate } from '../format';
import { goToTarget } from '../nav/navigation';

/** Plain-language basis for a loan's first required payment date (US-507). */
export function timingBasisText(timing: LoanPaymentTiming): string {
  if (timing.assumption) return timing.assumption;
  switch (timing.basis) {
    case 'actualDueDate': return 'Actual due date you entered';
    case 'federalDefault': return 'Estimated: federal Direct loans, 6 months after graduation';
    case 'loanGrace': return 'Estimated from the lender\'s grace period you entered';
    case 'inSchool': return 'Lender requires payments while in school';
    case 'notConfigured': return 'Not set: enter the lender\'s terms on the loan';
  }
}

/**
 * Each loan's first required payment date with its basis, the first voluntary payment date, and
 * missed-required-payment warnings. Shared by Repayment Plan and Results.
 */
export function PaymentTiming({ headingLevel = 3 }: { headingLevel?: 3 | 4 }) {
  const { plan, projection } = usePlanner();
  if (!projection) return null;
  const timing = projection.paymentTiming ?? [];
  const missed = projection.missedObligations ?? [];
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const loanName = (id: string) => plan.loans.find(loan => loan.id === id)?.name.trim() || 'Unnamed loan';
  return (
    <div className="payment-timing">
      <Heading id="payment-timing-heading">Payment dates</Heading>
      <p className="computed">
        Your first payment (you choose): <strong data-testid="first-voluntary-payment">{formatDate(projection.firstVoluntaryPaymentDate)}</strong>
      </p>
      {missed.length > 0 && (
        <div className="notice notice--warning" role="alert">
          <span className="notice-icon" aria-hidden="true">!</span>
          <p><strong>Required payments come before your first payment.</strong> Lenders may charge late fees or report missed payments. The projection keeps these obligations: their interest still accrues.</p>
          <ul>
            {missed.map(warning => (
              <li key={warning.loanId}>
                {warning.message}{' '}
                <button type="button" className="link-button" onClick={() => goToTarget({ dashboard: 'loans', fieldId: `loans.${warning.loanId}.requiredPayment.firstDueDate` })}>
                  Check due date<span className="visually-hidden"> for {loanName(warning.loanId)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {timing.length === 0 ? <p className="empty">Add a loan to see when its payments are required.</p> : (
        <TableRegion label="Required payment dates table">
          <table>
            <caption>First required payment for each loan (set by the lender, not by your choice)</caption>
            <thead>
              <tr><th scope="col">Loan</th><th scope="col">First required payment</th><th scope="col">Based on</th></tr>
            </thead>
            <tbody>
              {timing.map(entry => (
                <tr key={entry.loanId} data-basis={entry.basis}>
                  <th scope="row">{loanName(entry.loanId)}</th>
                  <td>{entry.firstRequiredPaymentDate ? formatDate(entry.firstRequiredPaymentDate) : <span className="placeholder">Not set</span>}</td>
                  <td className="wrap">{timingBasisText(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      )}
    </div>
  );
}
