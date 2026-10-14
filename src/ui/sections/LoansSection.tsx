import { useEffect } from 'react';
import type { PlannerLoan } from '../../engine/planner-contracts';
import type { InSchoolInterestPayment, LoanType } from '../../engine/contracts';
import { D, money, sum } from '../../engine/money';
import { usePlanner } from '../PlannerContext';
import {
  CheckboxField, DateField, IntegerField, MoneyField, OptionalMoneyField, RateField, SelectField, TextField,
} from '../fields/fields';
import { Explain } from '../common/common';
import { LOAN_TYPE_LABELS, formatCurrency } from '../format';
import { updateLoan } from '../planUpdates';
import { newId } from '../ids';

const loanTypeOptions = Object.entries(LOAN_TYPE_LABELS) as [LoanType, string][];

export function LoansSection({ focusLoanId, onFocused }: { focusLoanId: string | null; onFocused(): void }) {
  const { plan, update, projection } = usePlanner();
  const totalDebt = money(sum(plan.loans.map(loan => loan.principal)));
  const payers = plan.loans.filter(loan => loan.payInterestWhileInSchool && loan.type !== 'subsidized');
  const inSchoolMonthly = payers.length
    ? money(sum(payers.map(loan => inSchoolCost(loan, projection?.repayment.inSchoolInterestPayments ?? null).monthly)))
    : null;

  // When a loan is created (here or from a year's gap), move focus to its first field so it "opens" for editing.
  useEffect(() => {
    if (!focusLoanId) return;
    const element = document.getElementById(`loans.${focusLoanId}.name`);
    if (element) {
      element.focus();
      element.scrollIntoView?.({ block: 'center' });
      onFocused();
    }
  }, [focusLoanId, plan.loans, onFocused]);

  function addLoan() {
    const id = newId();
    update(p => ({
      ...p,
      loans: [...p.loans, {
        id, name: `Loan ${p.loans.length + 1}`, type: 'unsubsidized', principal: '0.00', annualRate: '0.0639',
        disbursementDate: p.settings.startDate, termMonths: 120, payInterestWhileInSchool: false, capitalizeInterest: true,
      }],
      repayment: { ...p.repayment, customOrder: [...p.repayment.customOrder, id] },
    }));
    requestAnimationFrame(() => document.getElementById(`loans.${id}.name`)?.focus());
  }

  return (
    <section id="loans" className="panel" aria-labelledby="loans-heading">
      <h2 id="loans-heading" tabIndex={-1}>3. Your loans</h2>
      <p className="section-intro">Add each loan, or create one from a school year's gap. Loans never change automatically when your gap changes.</p>
      <p className="computed" role="status">Total borrowed: <strong>{formatCurrency(totalDebt)}</strong> across {plan.loans.length} loan{plan.loans.length === 1 ? '' : 's'}</p>
      {inSchoolMonthly && (
        <p className="computed">In-school interest you pay: about <strong>{formatCurrency(inSchoolMonthly)} per month</strong> while in school and grace.</p>
      )}
      {plan.loans.length === 0 && <p className="empty">No loans yet.</p>}
      {plan.loans.map((loan, index) => <LoanCard key={loan.id} loan={loan} index={index} />)}
      <button type="button" className="button-primary" onClick={addLoan} disabled={plan.loans.length >= 50}>Add loan</button>
      {plan.loans.length >= 50 && <p className="field-hint">You have reached the 50-loan limit.</p>}
      <Explain>
        <p>Unsubsidized and private loans accrue simple interest in school and grace: principal × annual rate × days ÷ 365. Subsidized loans accrue nothing during school and grace.</p>
        <p>Capitalization (a modeling assumption you can turn off per loan) adds that unpaid interest to the balance when repayment starts. If you pay interest while in school, nothing capitalizes and the in-school interest is shown as a monthly cost.</p>
        <p>Minimum payment M = P × r ÷ (1 − (1 + r)^−n), r = annual rate ÷ 12, n = term in months, unless you enter a fixed payment.</p>
        <p>Total borrowed = Σ principal of every loan.</p>
      </Explain>
    </section>
  );
}

function LoanCard({ loan, index }: { loan: PlannerLoan; index: number }) {
  const { plan, update, remove, projection } = usePlanner();
  const base = `loans.${loan.id}`;
  const patch = (value: Partial<PlannerLoan>) => update(p => updateLoan(p, loan.id, value));
  const headingId = `${base}-heading`;
  const yearIndex = loan.schoolYearId ? plan.schoolYears.findIndex(year => year.id === loan.schoolYearId) : -1;
  const yearSummary = projection?.years.find(year => year.mismatchLoanIds.includes(loan.id));
  const atRepayment = projection?.repayment.loans.find(item => item.loanId === loan.id);
  const accrues = loan.type === 'unsubsidized' || ((loan.type === 'private' || loan.type === 'other') && loan.accruesInterestInSchool !== false);
  const inSchool = inSchoolCost(loan, projection?.repayment.inSchoolInterestPayments ?? null);

  return (
    <article className="loan-card" aria-labelledby={headingId}>
      <h3 id={headingId}>{loan.name || `Loan ${index + 1}`} <span className="subtle">{LOAN_TYPE_LABELS[loan.type]}{yearIndex >= 0 ? ` · from Year ${yearIndex + 1} gap` : ''}</span></h3>
      {yearSummary && (
        <p className="notice notice--warning">
          Year {plan.schoolYears.findIndex(year => year.id === yearSummary.yearId) + 1}'s gap + buffer is now {formatCurrency(yearSummary.bufferedGap)}, but this loan was created for {formatCurrency(loan.gapAtCreation)} and is {formatCurrency(loan.principal)}. The loan was not changed — edit the principal if you want them to match.
        </p>
      )}
      <div className="field-grid">
        <TextField id={`${base}.name`} label="Loan name" value={loan.name} onCommit={name => patch({ name })} />
        <SelectField id={`${base}.type`} label="Loan type" options={loanTypeOptions} value={loan.type} onCommit={type => patch({ type })} />
        <MoneyField id={`${base}.principal`} label="Amount borrowed (principal)" value={loan.principal} onCommit={principal => patch({ principal })} />
        <RateField id={`${base}.annualRate`} label="Annual interest rate" hint="0–30%." value={loan.annualRate} onCommit={annualRate => patch({ annualRate })} />
        <DateField id={`${base}.disbursementDate`} label="Disbursement date" value={loan.disbursementDate} onCommit={disbursementDate => patch({ disbursementDate })} />
        <IntegerField id={`${base}.termMonths`} label="Repayment term (months)" hint="120 months = 10 years." min={1} max={1200} value={loan.termMonths} onCommit={termMonths => patch({ termMonths })} />
        <OptionalMoneyField id={`${base}.monthlyPayment`} label="Fixed monthly payment (optional)" hint="Leave blank to use the calculated minimum."
          value={loan.monthlyPayment} onCommit={monthlyPayment => patch({ monthlyPayment })} />
      </div>
      <div className="check-group">
        {loan.type === 'subsidized' ? (
          <p className="field-hint">Subsidized: no interest accrues during school and grace, so there is no in-school interest to pay.</p>
        ) : (
          <CheckboxField id={`${base}.payInterestWhileInSchool`} label="I pay interest while in school"
            hint={loan.payInterestWhileInSchool && accrues
              ? `You pay about ${formatCurrency(inSchool.monthly)} per month in school and grace${inSchool.count ? ` (${inSchool.count} payments, ${formatCurrency(inSchool.total)} in all)` : ''}. Nothing is added to the balance.`
              : 'If you pay the interest as it accrues, nothing capitalizes and the payment is shown as a monthly cost.'}
            value={Boolean(loan.payInterestWhileInSchool)} onCommit={payInterestWhileInSchool => patch({ payInterestWhileInSchool })} />
        )}
        <CheckboxField id={`${base}.capitalizeInterest`} label="Add unpaid interest to the balance at repayment (capitalization)"
          hint="Modeling assumption. Turn off to keep accrued interest separate from principal."
          value={loan.capitalizeInterest !== false} onCommit={capitalizeInterest => patch({ capitalizeInterest })} />
        {(loan.type === 'private' || loan.type === 'other') && (
          <CheckboxField id={`${base}.accruesInterestInSchool`} label="Interest accrues while in school"
            hint="Most private loans accrue from disbursement. Turn off only if your lender says otherwise."
            value={loan.accruesInterestInSchool !== false} onCommit={accruesInterestInSchool => patch({ accruesInterestInSchool })} />
        )}
      </div>
      {atRepayment && (
        <dl className="inline-figures">
          <div><dt>Interest before repayment</dt><dd>{formatCurrency(atRepayment.accruedInterest)}</dd></div>
          {loan.payInterestWhileInSchool && accrues && <div><dt>In-school interest you pay</dt><dd>{formatCurrency(inSchool.monthly)}/mo</dd></div>}
          <div><dt>Interest added at repayment</dt><dd>{formatCurrency(atRepayment.capitalizedInterest)}</dd></div>
          <div><dt>Balance at repayment</dt><dd>{formatCurrency(atRepayment.balanceAtRepaymentStart)}</dd></div>
          <div><dt>Minimum monthly payment</dt><dd>{formatCurrency(atRepayment.minimumMonthlyPayment)}</dd></div>
        </dl>
      )}
      <button type="button" className="button-danger"
        onClick={() => {
          remove(`Remove loan "${loan.name}"`, p => ({ ...p, loans: p.loans.filter(item => item.id !== loan.id) }));
          requestAnimationFrame(() => document.getElementById('loans-heading')?.focus());
        }}>
        Remove loan<span className="visually-hidden"> {loan.name}</span>
      </button>
    </article>
  );
}

/**
 * Monthly in-school interest cost for a loan whose interest is paid while in school (US-404).
 * Uses the engine's payment periods when available (largest full-month amount); otherwise the
 * principal × rate ÷ 12 approximation while results are recalculating.
 */
function inSchoolCost(loan: PlannerLoan, payments: readonly InSchoolInterestPayment[] | null): { monthly: string; total: string; count: number } {
  const rows = payments?.filter(row => row.loanId === loan.id) ?? [];
  if (rows.length) {
    const monthly = rows.reduce((max, row) => (new D(row.amount).gt(max) ? new D(row.amount) : max), new D(0));
    return { monthly: money(monthly), total: money(sum(rows.map(row => row.amount))), count: rows.length };
  }
  try {
    return { monthly: money(new D(loan.principal).times(loan.annualRate).div(12)), total: '0.00', count: 0 };
  } catch {
    return { monthly: '0.00', total: '0.00', count: 0 };
  }
}
