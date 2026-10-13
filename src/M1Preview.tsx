import { useMemo, useState } from 'react';
import { calculateProjection } from './engine/projection';
import { standardSample, accrualSample, interestPaidSample, underpaymentSample } from './samples/m1';
import type { Money } from './engine/contracts';
import './m1-preview.css';

const examples = [
  { label: 'Standard repayment', plan: standardSample },
  { label: 'Accrued interest capitalizes', plan: accrualSample },
  { label: 'Interest paid during school', plan: interestPaidSample },
  { label: 'Payment below interest', plan: underpaymentSample },
];
// Format decimal text without converting money to floating point.
const dollars = (value: Money) => `$${value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

export default function M1Preview() {
  const [selected, setSelected] = useState(0);
  const plan = examples[selected].plan;
  const result = useMemo(() => calculateProjection(plan), [plan]);
  const loanName = (id: string) => plan.loans.find(loan => loan.id === id)?.name ?? id;

  return <section className="m1-preview" aria-labelledby="m1-heading">
    <header>
      <p className="m1-eyebrow">M1 · Engine review</p>
      <h2 id="m1-heading">Explore a repayment example</h2>
      <p>Choose a fixed sample to review accrual, capitalization, and the monthly repayment schedule.</p>
    </header>
    <label htmlFor="m1-example">Review sample</label>
    <select id="m1-example" value={selected} onChange={event => setSelected(Number(event.target.value))}>
      {examples.map((example, index) => <option key={example.label} value={index}>{example.label}</option>)}
    </select>
    <details className="m1-assumptions">
      <summary>How are these figures calculated?</summary>
      <p>In-school and grace interest = principal × annual rate × actual days / 365. Subsidized loans accrue no interest during that period. Unpaid interest is added to principal once at repayment start.</p>
      <p>Minimum payment = P × r / (1 − (1 + r)⁻ⁿ), where P is the repayment balance, r is annual rate / 12, and n is the loan term in months. At 0% interest, payment = P / n. The sample may use a fixed payment instead.</p>
      <p>Monthly repayment interest = opening balance × annual rate / 12. Principal paid = payment − interest. Money rounds half-up to cents per transaction; the final payment absorbs the rounding remainder. Total interest includes in-school interest once plus repayment interest.</p>
      <p>Repayment starts at graduation plus grace months; the first payment is one month later. Monthly dates clamp to the last day when needed. Samples allocate extra money in input order. An incomplete projection has no debt-free date or lifetime interest total.</p>
    </details>
    {!result.ok ? <div role="alert"><h3>Sample validation errors</h3>{result.errors.map((error, index) => <p key={index}>{error.path}: {error.message}</p>)}</div> : (() => {
      const projection = result.value;
      return <>
        <div className="m1-summary" aria-live="polite" aria-atomic="true">
          <dl><dt>Debt-free date</dt><dd>{projection.debtFreeDate ?? 'Not projected'}</dd></dl>
          <dl><dt>Total interest</dt><dd>{projection.totalInterestPaid === null ? 'Not available — projection incomplete' : dollars(projection.totalInterestPaid)}</dd></dl>
          <dl><dt>Balance at repayment start</dt><dd>{dollars(projection.balanceAtRepaymentStart)}</dd></dl>
          <dl><dt>Repayment cash payments</dt><dd>{dollars(projection.totalRepaymentPayments)}</dd></dl>
        </div>
        <p>Repayment starts <time dateTime={projection.repaymentStartDate}>{projection.repaymentStartDate}</time>. First payment: <time dateTime={projection.firstPaymentDate}>{projection.firstPaymentDate}</time>. Scheduled months: {projection.amortizationSchedule.length}.</p>
        {projection.warnings.length > 0 && <div className="m1-warning" role="alert"><h3>Projection warning</h3>{projection.warnings.map((warning, index) => <p key={index}>{warning.message}</p>)}<p>A debt-free date and complete interest total cannot be shown for this projection.</p></div>}
        <h3>Loans at repayment start</h3>
        <div className="m1-table-scroll" role="region" aria-label="Loan balances and minimum payments" tabIndex={0}>
          <table><caption>Accrual, capitalization, and minimum payment by loan</caption>
            <thead><tr>{['Loan', 'Original principal', 'Accrued interest', 'Capitalized interest', 'Interest paid during school', 'Repayment balance', 'Minimum monthly payment', 'Chosen monthly payment'].map(title => <th scope="col" key={title}>{title}</th>)}</tr></thead>
            <tbody>{projection.loans.map(loan => <tr key={loan.loanId}><th scope="row">{loanName(loan.loanId)}</th>{[loan.originalPrincipal, loan.accruedInterest, loan.capitalizedInterest, loan.inSchoolInterestPaid, loan.balanceAtRepaymentStart, loan.minimumMonthlyPayment, plan.loans.find(input => input.id === loan.loanId)?.monthlyPayment ?? loan.minimumMonthlyPayment].map((value, index) => <td key={index}>{dollars(value)}</td>)}</tr>)}</tbody>
          </table>
        </div>
        {projection.inSchoolInterestPayments.length > 0 && <>
          <h3>In-school interest payments</h3>
          <div className="m1-table-scroll" role="region" aria-label="Monthly in-school interest payments" tabIndex={0}>
            <table><caption>Monthly cash cost before repayment</caption><thead><tr><th scope="col">Loan</th><th scope="col">Period start</th><th scope="col">Payment date</th><th scope="col">Amount</th></tr></thead><tbody>{projection.inSchoolInterestPayments.map((payment, index) => <tr key={index}><th scope="row">{loanName(payment.loanId)}</th><td>{payment.periodStart}</td><td>{payment.date}</td><td>{dollars(payment.amount)}</td></tr>)}</tbody></table>
          </div>
        </>}
        <h3>Monthly amortization schedule</h3>
        <p>Each month includes a combined row followed by its individual loan rows. Repayment cash totals exclude in-school interest payments.</p>
        <div className="m1-table-scroll m1-schedule" role="region" aria-label="Full monthly amortization schedule" tabIndex={0}>
          <table><caption>All projected months, combined and per loan</caption><thead><tr>{['Month', 'Payment date', 'Loan', 'Payment', 'Interest', 'Principal', 'Remaining balance'].map(title => <th scope="col" key={title}>{title}</th>)}</tr></thead>
            <tbody>{projection.amortizationSchedule.flatMap(month => [
              <tr className="m1-combined" key={`${month.month}-combined`}><th scope="row">{month.month}</th><td>{month.date}</td><td>Combined</td>{[month.payment, month.interest, month.principal, month.remainingBalance].map((value, index) => <td key={index}>{dollars(value)}</td>)}</tr>,
              ...month.loans.map(loan => <tr key={`${month.month}-${loan.loanId}`}><td>{month.month}</td><td>{month.date}</td><th scope="row">{loanName(loan.loanId)}</th>{[loan.payment, loan.interest, loan.principal, loan.remainingBalance].map((value, index) => <td key={index}>{dollars(value)}</td>)}</tr>),
            ])}</tbody>
          </table>
        </div>
      </>;
    })()}
    <footer><p>Results are estimates, not financial advice. These modeling assumptions may differ from your servicer’s daily interest calculations and payment application rules.</p></footer>
  </section>;
}
