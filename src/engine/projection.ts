import type { Plan, ProjectionResult, FieldError, LoanAtRepayment, InSchoolInterestPayment, AmortizationMonth, ProjectionWarning } from './contracts';
import { D, cents, money, moneyText, decimalText, sum } from './money';
import { addMonths, daysBetween, validDate } from './dates';
import { getStrategy } from './strategies/registry';

/** Pure M1 projection; all monetary arithmetic stays in decimal.js. */
export function calculateProjection(plan: Plan): ProjectionResult {
  const errors: FieldError[] = [];
  const error = (path: string, code: FieldError['code'], message: string) => errors.push({ path, code, message });
  const p = plan as Plan | undefined;
  const settings = p?.settings;
  for (const key of ['startDate', 'graduationDate'] as const) {
    if (!validDate(settings?.[key])) error(`settings.${key}`, 'INVALID_DATE', 'Enter a valid YYYY-MM-DD date.');
  }
  if (validDate(settings?.startDate) && validDate(settings?.graduationDate) && settings.graduationDate < settings.startDate)
    error('settings.graduationDate', 'OUT_OF_RANGE', 'Graduation must be on or after school starts.');
  if (!Number.isInteger(settings?.graceMonths) || settings!.graceMonths < 0 || settings!.graceMonths > 12)
    error('settings.graceMonths', 'OUT_OF_RANGE', 'Grace must be an integer from 0 to 12 months.');
  if (settings?.currency !== 'USD') error('settings.currency', 'OUT_OF_RANGE', 'M1 supports USD.');
  const repayment = p?.repayment;
  if (!moneyText(repayment?.extraMonthlyPayment)) error('repayment.extraMonthlyPayment', 'INVALID_MONEY', 'Enter nonnegative money with at most two decimal places.');
  const horizon = repayment?.maxMonths ?? 600;
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 1200) error('repayment.maxMonths', 'OUT_OF_RANGE', 'Horizon must be 1–1200 months.');
  const strategy = getStrategy(repayment?.strategyId ?? '');
  if (!strategy) error('repayment.strategyId', 'UNKNOWN_STRATEGY', 'Unknown payoff strategy.');
  if (!Array.isArray(p?.loans)) error('loans', 'REQUIRED', 'Loans must be an array.');
  const ids = new Set<string>();
  for (const [i, loan] of (Array.isArray(p?.loans) ? p.loans : []).entries()) {
    const path = `loans.${i}`;
    if (!loan || typeof loan !== 'object') { error(path, 'REQUIRED', 'Enter a loan.'); continue; }
    if (typeof loan.id !== 'string' || !loan.id.trim()) error(`${path}.id`, 'REQUIRED', 'Loan ID is required.');
    else if (ids.has(loan.id)) error(`${path}.id`, 'DUPLICATE_ID', 'Loan IDs must be unique.');
    ids.add(loan.id);
    if (typeof loan.name !== 'string' || !loan.name.trim()) error(`${path}.name`, 'REQUIRED', 'Loan name is required.');
    if (!['subsidized', 'unsubsidized', 'private', 'other'].includes(loan.type)) error(`${path}.type`, 'OUT_OF_RANGE', 'Select a supported loan type.');
    if (!moneyText(loan.principal)) error(`${path}.principal`, 'INVALID_MONEY', 'Enter nonnegative money with at most two decimal places.');
    if (!decimalText(loan.annualRate) || !/^\d{1,2}(?:\.\d{1,12})?$/.test(loan.annualRate) || new D(loan.annualRate).gt('0.30')) error(`${path}.annualRate`, 'INVALID_RATE', 'Annual rate must be between 0 and 0.30, with at most 12 decimal places.');
    if (!validDate(loan.disbursementDate)) error(`${path}.disbursementDate`, 'INVALID_DATE', 'Enter a valid YYYY-MM-DD date.');
    if (!Number.isInteger(loan.termMonths) || loan.termMonths < 1 || loan.termMonths > 1200) error(`${path}.termMonths`, 'OUT_OF_RANGE', 'Term must be 1–1200 months.');
    if (loan.monthlyPayment !== undefined && !moneyText(loan.monthlyPayment)) error(`${path}.monthlyPayment`, 'INVALID_MONEY', 'Enter nonnegative money with at most two decimal places.');
    for (const key of ['payInterestWhileInSchool', 'accruesInterestInSchool'] as const)
      if (loan[key] !== undefined && typeof loan[key] !== 'boolean') error(`${path}.${key}`, 'OUT_OF_RANGE', 'Use a boolean value.');
  }
  if (errors.length || !p || !settings || !repayment || !strategy) return { ok: false, errors };
  const repaymentStartDate = addMonths(settings.graduationDate, settings.graceMonths);
  if (!validDate(repaymentStartDate) || !validDate(addMonths(repaymentStartDate, horizon)))
    return { ok: false, errors: [{ path: 'settings.graduationDate', code: 'OUT_OF_RANGE', message: 'Projection dates must stay within years 0001–9999.' }] };
  for (const [i, loan] of p.loans.entries()) if (loan.disbursementDate > repaymentStartDate)
    error(`loans.${i}.disbursementDate`, 'OUT_OF_RANGE', 'Disbursement must be on or before repayment starts.');
  if (errors.length) return { ok: false, errors };
  const inSchoolInterestPayments: InSchoolInterestPayment[] = [];
  const loans: LoanAtRepayment[] = p.loans.map(loan => {
    const accrues = loan.type !== 'subsidized' && (loan.type === 'unsubsidized' || loan.accruesInterestInSchool !== false);
    const daily = new D(loan.principal).times(loan.annualRate).div(365);
    let accrued = cents(accrues ? daily.times(daysBetween(loan.disbursementDate, repaymentStartDate)) : 0);
    let paid = new D(0);
    if (accrues && loan.payInterestWhileInSchool) {
      let start = loan.disbursementDate;
      for (let month = 1; start < repaymentStartDate; month++) {
        const next = addMonths(loan.disbursementDate, month);
        const end = next < repaymentStartDate ? next : repaymentStartDate;
        const amount = cents(daily.times(daysBetween(start, end)));
        inSchoolInterestPayments.push({ loanId: loan.id, periodStart: start, date: end, amount: money(amount) });
        paid = paid.plus(amount); start = end;
      }
      accrued = paid;
    }
    const capitalized = loan.payInterestWhileInSchool ? new D(0) : accrued;
    const balance = new D(loan.principal).plus(capitalized);
    const rate = new D(loan.annualRate).div(12);
    const minimum = rate.isZero() ? balance.div(loan.termMonths) : balance.times(rate).div(new D(1).minus(new D(1).plus(rate).pow(-loan.termMonths)));
    return { loanId: loan.id, originalPrincipal: money(loan.principal), accruedInterest: money(accrued), capitalizedInterest: money(capitalized), inSchoolInterestPaid: money(paid), balanceAtRepaymentStart: money(balance), minimumMonthlyPayment: money(minimum) };
  });
  const balances = loans.map(loan => new D(loan.balanceAtRepaymentStart));
  const chosen = p.loans.map((loan, i) => new D(loan.monthlyPayment ?? loans[i].minimumMonthlyPayment));
  const budget = sum(chosen).plus(repayment.extraMonthlyPayment);
  const schedule: AmortizationMonth[] = [];
  const warnings: ProjectionWarning[] = [];
  let status: 'paidOff' | 'notAmortizing' | 'horizonExceeded' = 'paidOff';
  for (let month = 1; balances.some(balance => balance.gt(0)) && month <= horizon; month++) {
    const date = addMonths(repaymentStartDate, month);
    const interests = balances.map((balance, i) => cents(balance.times(p.loans[i].annualRate).div(12)));
    const dues = balances.map((balance, i) => balance.plus(interests[i]));
    const payments = dues.map((due, i) => D.min(due, chosen[i]));
    let extra = budget.minus(sum(payments));
    const states = p.loans.flatMap((loan, i) => balances[i].gt(0) ? [{ id: loan.id, balance: money(balances[i]), annualRate: loan.annualRate, minimumPayment: loans[i].minimumMonthlyPayment }] : []);
    let ordered;
    try { ordered = strategy.orderLoans(Object.freeze(states.map(state => Object.freeze({ ...state }))), date); }
    catch { return { ok: false, errors: [{ path: 'repayment.strategyId', code: 'INVALID_STRATEGY', message: 'Strategy could not order the active loans.' }] }; }
    if (!Array.isArray(ordered) || ordered.length !== states.length || ordered.some(loan => !loan || typeof loan.id !== 'string') || new Set(ordered.map(loan => loan.id)).size !== states.length || ordered.some(loan => !states.some(state => state.id === loan.id)))
      return { ok: false, errors: [{ path: 'repayment.strategyId', code: 'INVALID_STRATEGY', message: 'Strategy must return every active loan exactly once.' }] };
    for (const target of ordered) {
      const i = p.loans.findIndex(loan => loan.id === target.id);
      const amount = D.min(extra, dues[i].minus(payments[i]));
      payments[i] = payments[i].plus(amount); extra = extra.minus(amount);
    }
    // Absorb only a small rounded-payment remainder at the contractual last installment.
    for (let i = 0; i < balances.length; i++) {
      const remainder = dues[i].minus(payments[i]);
      const nearMinimum = chosen[i].gt(0) && chosen[i].minus(loans[i].minimumMonthlyPayment).abs().lte('0.01');
      // Compounded rounding errors can exceed n * half a cent at positive rates.
      // Provisional M1 policy: at most $1 extra in the nominal final transaction.
      // Larger residuals keep amortizing; this adjusts cash paid and never forgives debt.
      const roundingBound = D.min('1.00', new D(p.loans[i].termMonths).times('0.005').times(new D(1).plus(new D(p.loans[i].annualRate).div(12)).pow(p.loans[i].termMonths)));
      if (nearMinimum && month === p.loans[i].termMonths && remainder.gt(0) && remainder.lte(roundingBound)) payments[i] = dues[i];
    }
    for (let i = 0; i < balances.length; i++) if (balances[i].gt(0) && payments[i].lte(interests[i])) {
      warnings.push({ code: payments[i].lt(interests[i]) ? 'NEGATIVE_AMORTIZATION' : 'NON_AMORTIZING', loanId: p.loans[i].id, date, message: 'Payment does not reduce this loan balance; no debt-free date is projected.' });
    }
    const rows = p.loans.flatMap((loan, i) => {
      if (balances[i].isZero()) return [];
      const principal = payments[i].minus(interests[i]);
      balances[i] = dues[i].minus(payments[i]);
      return [{ loanId: loan.id, payment: money(payments[i]), interest: money(interests[i]), principal: money(principal), remainingBalance: money(balances[i]) }];
    });
    schedule.push({ month, date, loans: rows, payment: money(sum(rows.map(row => row.payment))), interest: money(sum(rows.map(row => row.interest))), principal: money(sum(rows.map(row => row.principal))), remainingBalance: money(sum(balances)) });
    if (warnings.length) { status = 'notAmortizing'; break; }
  }
  if (status === 'paidOff' && balances.some(balance => balance.gt(0))) {
    status = 'horizonExceeded'; warnings.push({ code: 'HORIZON_EXCEEDED', message: 'Debt remains at the projection horizon.' });
  }
  return { ok: true, value: { status, repaymentStartDate, firstPaymentDate: addMonths(repaymentStartDate, 1), loans, balanceAtRepaymentStart: money(sum(loans.map(loan => loan.balanceAtRepaymentStart))), inSchoolInterestPayments, amortizationSchedule: schedule, debtFreeDate: status === 'paidOff' ? schedule.at(-1)?.date ?? repaymentStartDate : null, totalInterestPaid: status === 'paidOff' ? money(sum(loans.map(loan => loan.accruedInterest)).plus(sum(schedule.map(row => row.interest)))) : null, totalRepaymentPayments: money(sum(schedule.map(row => row.payment))), warnings } };
}
