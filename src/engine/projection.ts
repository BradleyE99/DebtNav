import type { Plan, ProjectionResult, FieldError, LoanAtRepayment, InSchoolInterestPayment, AmortizationMonth, ProjectionWarning, LoanState, LoanPayment } from './contracts';
import type Decimal from 'decimal.js';
import { D, cents, money, moneyText, decimalText, sum } from './money';
import { addMonths, daysBetween, validDate } from './dates';
import type { PayoffStrategy, ISODate } from './contracts';
import { getStrategy } from './strategies/registry';
import { SIMULATION_CAP_MONTHS } from './planner-contracts';
import { SUBSIDIZED_GRACE_INTEREST_WINDOW } from './paymentTiming';

/** Pure M1 projection; all monetary arithmetic stays in decimal.js. */
export interface ProjectionOptions {
  /** Overrides the registry lookup of plan.repayment.strategyId. */
  strategy?: PayoffStrategy;
  /** Total cash available for debt in repayment month `month` (1-based) dated `date`. Replaces the
   * sum of chosen payments + extraMonthlyPayment. Must be nonnegative and whole cents. */
  monthlyBudget?: (date: ISODate, month: number) => Decimal;
  capitalizeInterestByLoan?: Record<string, boolean>;
  /** With monthlyBudget: first payment date (ISO) from which the budget never changes again. A
   * non-amortizing month on or after it ends the projection; before it the projection continues.
   * Omit when the budget may change until the horizon. */
  budgetStableFrom?: ISODate;
  /**
   * US-507: the voluntary start S. The month grid starts here (first payment S + 1 month). Default
   * (M1 plans): graduation + settings.graceMonths, which is then validated; when set, graceMonths is ignored.
   * A loan disbursed after S enters the grid at the first grid date on or after its disbursement.
   */
  voluntaryStartDate?: ISODate;
  /**
   * US-507: each loan's first required payment date. Grid months dated before it have no required
   * minimum; voluntary payments still reduce the balance (interest first). Subsidized loans (and
   * private/other loans that do not accrue in school) accrue no interest in those months; interest is
   * capitalized (when capitalizeInterestByLoan allows) and the minimum computed at the end of the last
   * such month (the repayment-period start). Absent: required from the loan's first grid payment.
   */
  firstRequiredPaymentByLoan?: Record<string, ISODate>;
  /** US-507: each loan's repayment-period start R. A loan that does not accrue before R (subsidized)
   * accrues from R when the grid starts later. Disbursement after R is rejected. */
  repaymentPeriodStartByLoan?: Record<string, ISODate>;
  /** Simulation cap (tests). Default: plan.repayment.maxMonths ?? SIMULATION_CAP_MONTHS. */
  maxMonths?: number;
}
export function calculateProjection(plan: Plan, options: ProjectionOptions = {}): ProjectionResult {
  const errors: FieldError[] = [];
  const error = (path: string, code: FieldError['code'], message: string) => errors.push({ path, code, message });
  const p = plan as Plan | undefined;
  const settings = p?.settings;
  for (const key of ['startDate', 'graduationDate'] as const) {
    if (!validDate(settings?.[key])) error(`settings.${key}`, 'INVALID_DATE', 'Enter a valid YYYY-MM-DD date.');
  }
  if (validDate(settings?.startDate) && validDate(settings?.graduationDate) && settings.graduationDate < settings.startDate)
    error('settings.graduationDate', 'OUT_OF_RANGE', 'Graduation must be on or after school starts.');
  if (options.voluntaryStartDate !== undefined) {
    if (!validDate(options.voluntaryStartDate)) error('repayment.voluntaryStart', 'INVALID_DATE', 'Enter a valid YYYY-MM-DD date.');
  } else if (!Number.isInteger(settings?.graceMonths) || settings!.graceMonths < 0 || settings!.graceMonths > 12) {
    error('settings.graceMonths', 'OUT_OF_RANGE', 'Grace must be an integer from 0 to 12 months.');
  }
  if (settings?.currency !== 'USD') error('settings.currency', 'OUT_OF_RANGE', 'M1 supports USD.');
  const repayment = p?.repayment;
  if (!moneyText(repayment?.extraMonthlyPayment)) error('repayment.extraMonthlyPayment', 'INVALID_MONEY', 'Enter nonnegative money with at most two decimal places.');
  const horizon = options.maxMonths ?? repayment?.maxMonths ?? SIMULATION_CAP_MONTHS;
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 1200) error('repayment.maxMonths', 'OUT_OF_RANGE', 'Horizon must be 1–1200 months.');
  const strategy = options.strategy ?? getStrategy(repayment?.strategyId ?? '');
  if (!strategy) error('repayment.strategyId', 'UNKNOWN_STRATEGY', 'Unknown payoff strategy.');
  if (!Array.isArray(p?.loans)) error('loans', 'REQUIRED', 'Loans must be an array.');
  const ids = new Set<string>();
  for (const [i, loan] of (Array.isArray(p?.loans) ? p.loans : []).entries()) {
    // Field paths use the record id (contract: never array indexes); index only when the id itself is unusable.
    const usableId = loan && typeof loan === 'object' && typeof loan.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(loan.id);
    const path = usableId ? `loans.${loan.id}` : `loans.${i}`;
    const who = loan && typeof loan === 'object' && typeof loan.name === 'string' && loan.name.trim() ? `Loan "${loan.name.trim()}"` : `Loan ${i + 1}`;
    const loanError = (field: string, code: FieldError['code'], message: string) => error(`${path}.${field}`, code, `${who}: ${message}`);
    if (!loan || typeof loan !== 'object') { error(path, 'REQUIRED', 'Enter a loan.'); continue; }
    if (typeof loan.id !== 'string' || !loan.id.trim()) loanError('id', 'REQUIRED', 'Loan ID is required.');
    else if (ids.has(loan.id)) loanError('id', 'DUPLICATE_ID', 'Loan IDs must be unique.');
    ids.add(loan.id);
    if (typeof loan.name !== 'string' || !loan.name.trim()) loanError('name', 'REQUIRED', 'Loan name is required.');
    if (!['subsidized', 'unsubsidized', 'private', 'other'].includes(loan.type)) loanError('type', 'OUT_OF_RANGE', 'Select a supported loan type.');
    if (!moneyText(loan.principal)) loanError('principal', 'INVALID_MONEY', 'Enter nonnegative money with at most two decimal places.');
    if (!decimalText(loan.annualRate) || !/^\d{1,2}(?:\.\d{1,12})?$/.test(loan.annualRate) || new D(loan.annualRate).gt('0.30')) loanError('annualRate', 'INVALID_RATE', 'Annual rate must be between 0 and 0.30, with at most 12 decimal places.');
    if (!validDate(loan.disbursementDate)) loanError('disbursementDate', 'INVALID_DATE', 'Enter a valid YYYY-MM-DD date.');
    if (!Number.isInteger(loan.termMonths) || loan.termMonths < 1 || loan.termMonths > 1200) loanError('termMonths', 'OUT_OF_RANGE', 'Term must be 1–1200 months.');
    if (loan.monthlyPayment !== undefined && !moneyText(loan.monthlyPayment)) loanError('monthlyPayment', 'INVALID_MONEY', 'Enter nonnegative money with at most two decimal places.');
    for (const key of ['payInterestWhileInSchool', 'accruesInterestInSchool'] as const)
      if (loan[key] !== undefined && typeof loan[key] !== 'boolean') loanError(key, 'OUT_OF_RANGE', 'Use a boolean value.');
  }
  if (errors.length || !p || !settings || !repayment || !strategy) return { ok: false, errors };
  // S: the month grid's anchor (the voluntary start; v3 and M1: graduation + grace).
  const repaymentStartDate = options.voluntaryStartDate ?? addMonths(settings.graduationDate, settings.graceMonths);
  if (!validDate(repaymentStartDate) || !validDate(addMonths(repaymentStartDate, horizon)))
    return { ok: false, errors: [{ path: 'settings.graduationDate', code: 'OUT_OF_RANGE', message: 'Projection dates must stay within years 0001–9999.' }] };
  const periodStarts = options.repaymentPeriodStartByLoan ?? {};
  for (const loan of p.loans) {
    const own = periodStarts[loan.id];
    if (options.voluntaryStartDate === undefined ? loan.disbursementDate > repaymentStartDate : own !== undefined && loan.disbursementDate > own)
      error(`loans.${loan.id}.disbursementDate`, 'OUT_OF_RANGE', `Loan "${loan.name.trim()}": disbursement (${loan.disbursementDate}) must be on or before repayment starts (${own ?? repaymentStartDate}).`);
  }
  if (errors.length) return { ok: false, errors };
  const count = p.loans.length;
  // US-507 per-loan grid positions: a loan enters after grid month `entries[i]` (0 = from the start)
  // and its required payments start in grid month `requiredFrom[i]`; months before that are grace months.
  const entries: number[] = new Array<number>(count).fill(0);
  const requiredFrom: number[] = new Array<number>(count).fill(1);
  const anchors: string[] = p.loans.map((loan, i) => {
    let entry = 0;
    let anchor = repaymentStartDate;
    while (anchor < loan.disbursementDate && entry <= horizon) anchor = addMonths(repaymentStartDate, ++entry);
    entries[i] = entry;
    const firstRequired = options.firstRequiredPaymentByLoan?.[loan.id];
    let grace = 0;
    if (firstRequired !== undefined) while (grace < horizon && addMonths(repaymentStartDate, grace + 1) < firstRequired) grace++;
    requiredFrom[i] = Math.max(grace, entry) + 1;
    return anchor;
  });
  const deferred = (i: number) => requiredFrom[i] > entries[i] + 1;
  const inSchoolInterestPayments: InSchoolInterestPayment[] = [];
  const loans: LoanAtRepayment[] = p.loans.map((loan, i) => {
    const anchor = anchors[i];
    const accrues = loan.type !== 'subsidized' && (loan.type === 'unsubsidized' || loan.accruesInterestInSchool !== false);
    const daily = new D(loan.principal).times(loan.annualRate).div(365);
    // A loan that does not accrue before its repayment period accrues from R when the grid starts later (S > R).
    const own = periodStarts[loan.id];
    const lateStart = !accrues && own !== undefined && own < anchor ? (own > loan.disbursementDate ? own : loan.disbursementDate) : null;
    let accrued = cents(accrues ? daily.times(daysBetween(loan.disbursementDate, anchor)) : lateStart ? daily.times(daysBetween(lateStart, anchor)) : 0);
    let paid = new D(0);
    if (accrues && loan.payInterestWhileInSchool) {
      let start = loan.disbursementDate;
      for (let month = 1; start < anchor; month++) {
        const next = addMonths(loan.disbursementDate, month);
        const end = next < anchor ? next : anchor;
        const amount = cents(daily.times(daysBetween(start, end)));
        inSchoolInterestPayments.push({ loanId: loan.id, periodStart: start, date: end, amount: money(amount) });
        paid = paid.plus(amount); start = end;
      }
      accrued = paid;
    }
    // Deferred loans capitalize at their repayment-period start (inside the loop), never at S.
    // (Interest paid in school is never capitalized; v3 equivalent: accrued − paid is 0 or accrued.)
    const capitalized = deferred(i) || options.capitalizeInterestByLoan?.[loan.id] === false ? new D(0) : accrued.minus(paid);
    const balance = new D(loan.principal).plus(capitalized);
    const owedAtStart = balance.plus(accrued.minus(capitalized).minus(paid));
    const minimum = deferred(i) ? new D(0) : amortizedMinimum(owedAtStart, loan.annualRate, loan.termMonths);
    return { loanId: loan.id, originalPrincipal: money(loan.principal), accruedInterest: money(accrued), capitalizedInterest: money(capitalized), inSchoolInterestPaid: money(paid), balanceAtRepaymentStart: money(balance), minimumMonthlyPayment: money(minimum) };
  });
  // ---------------------------------------------------------------- Repayment loop
  // Performance (US-701/NFR-4): every per-loan constant is parsed once, paid-off loans drop out of
  // the per-month work, and monthly/overall totals are accumulated as Decimals instead of being
  // re-parsed from the formatted row strings. The arithmetic (and therefore every result) is the
  // same as the straightforward formulation: interest = round half-up(balance × annual rate / 12).
  const zero = new D(0);
  const unpaidInterest = loans.map(loan => new D(loan.accruedInterest).minus(loan.capitalizedInterest).minus(loan.inSchoolInterestPaid));
  const balances = loans.map(loan => new D(loan.balanceAtRepaymentStart));
  const minimums = loans.map(loan => new D(loan.minimumMonthlyPayment));
  const chosen = p.loans.map((loan, i) => loan.monthlyPayment === undefined ? minimums[i] : new D(loan.monthlyPayment));
  const budget = sum(chosen).plus(repayment.extraMonthlyPayment);
  // Bound on the residual left at maturity purely by cent rounding: each month the payment and the
  // interest are each rounded by at most half a cent, and each error compounds at the monthly rate.
  // Payments at or above the computed minimum absorb that residual in the final installment, as a
  // reference amortization calculator does (US-504). Payments below the computed minimum (by at most
  // one cent) absorb at most $1, so deliberate underpayment never becomes a hidden balloon payment.
  // Only needed in a loan's contractual final month, so it is computed lazily.
  const roundingBound = (i: number): Decimal => {
    const loan = p.loans[i];
    const bound = new D(loan.termMonths).times('0.01').times(new D(1).plus(new D(loan.annualRate).div(12)).pow(loan.termMonths));
    return chosen[i].gte(minimums[i]) ? bound : D.min('1.00', bound);
  };
  // Immutable per-loan values are parsed once, preserving multiply-then-divide rounding.
  const annualRates = p.loans.map(loan => new D(loan.annualRate));
  const nearMinimums = chosen.map((payment, i) => payment.gt(0) && payment.minus(minimums[i]).abs().lte('0.01'));
  // US-507 grace months (before requiredFrom): subsidized loans accrue nothing (34 CFR 685.207(b)(3)(ii)),
  // except loans first disbursed 2012-07-01 up to 2014-07-01, which owe grace interest after
  // graduation ((b)(3)(iii); modeled only inside the month grid). Private/other loans marked as not
  // accruing in school accrue nothing before their repayment period either.
  const graduation = p.settings.graduationDate;
  const graceInterestFree = p.loans.map(loan => loan.type === 'subsidized'
    ? !(loan.disbursementDate >= SUBSIDIZED_GRACE_INTEREST_WINDOW.start && loan.disbursementDate < SUBSIDIZED_GRACE_INTEREST_WINDOW.end)
    : loan.type !== 'unsubsidized' && loan.accruesInterestInSchool === false);
  const graceWindowLoan = p.loans.map((loan, i) => loan.type === 'subsidized' && !graceInterestFree[i]);
  const lastInstallment = p.loans.map((loan, i) => requiredFrom[i] - 1 + loan.termMonths);
  // Interest counted in totals besides scheduled interest: capitalized amounts and in-school payments.
  const capitalizedTotals = loans.map(loan => new D(loan.capitalizedInterest));
  const graceInterest: Decimal[] = new Array<Decimal>(count).fill(zero);
  const graceEnds = new Map<number, number[]>();
  for (let i = 0; i < count; i++) if (deferred(i)) graceEnds.set(requiredFrom[i] - 1, [...(graceEnds.get(requiredFrom[i] - 1) ?? []), i]);
  const pending = Array.from({ length: count }, (_, i) => i).filter(i => entries[i] > 0).sort((a, b) => entries[a] - entries[b] || a - b);
  let nextPending = 0;
  const separates = p.loans.map(loan => options.capitalizeInterestByLoan?.[loan.id] === false);
  const loanIndexes = new Map(p.loans.map((loan, i) => [loan.id, i]));
  const schedule: AmortizationMonth[] = [];
  const warnings: ProjectionWarning[] = [];
  const warnedLoans = new Set<number>();
  // Loans with a positive balance, in input order. Balances never go negative, so a loan leaves
  // this list exactly when its balance reaches zero.
  let active: number[] = [];
  for (let i = 0; i < count; i++) if (entries[i] === 0 && balances[i].gt(0)) active.push(i);
  // Formatted balances, reused as the strategy input for the next month.
  const balanceTexts = balances.map(balance => money(balance));
  const interests: Decimal[] = new Array<Decimal>(count).fill(zero);
  const dues: Decimal[] = new Array<Decimal>(count).fill(zero);
  const payments: Decimal[] = new Array<Decimal>(count).fill(zero);
  let totalScheduledInterest = zero;
  let totalPayments = zero;
  let status: 'paidOff' | 'notAmortizing' | 'horizonExceeded' = 'paidOff';
  for (let month = 1; (active.length > 0 || nextPending < pending.length) && month <= horizon; month++) {
    const date = addMonths(repaymentStartDate, month);
    if (nextPending < pending.length && entries[pending[nextPending]] === month - 1) {
      while (nextPending < pending.length && entries[pending[nextPending]] === month - 1) {
        const i = pending[nextPending++];
        if (balances[i].gt(0)) active.push(i);
      }
      active.sort((a, b) => a - b);
    }
    let interestTotal = zero;
    let dueTotal = zero;
    for (const i of active) {
      const grace = month < requiredFrom[i];
      const interest = grace && (graceInterestFree[i] || (graceWindowLoan[i] && date <= graduation))
        ? zero : cents(balances[i].times(annualRates[i]).div(TWELVE));
      const due = unpaidInterest[i].isZero() ? balances[i].plus(interest) : balances[i].plus(interest).plus(unpaidInterest[i]);
      interests[i] = interest;
      dues[i] = due;
      payments[i] = grace ? zero : minOf(due, chosen[i]);
      interestTotal = interestTotal.plus(interest);
      dueTotal = dueTotal.plus(payments[i]);
    }
    const availableBudget = options.monthlyBudget ? options.monthlyBudget(date, month) : budget;
    let allocated = dueTotal;
    if (dueTotal.gt(availableBudget) && dueTotal.gt(0)) {
      // Proportional shortfall allocation, with cent remainder assigned deterministically.
      allocated = zero;
      for (const i of active) { payments[i] = cents(payments[i].times(availableBudget).div(dueTotal)); allocated = allocated.plus(payments[i]); }
      for (let k = active.length - 1; k >= 0 && allocated.gt(availableBudget); k--) {
        const i = active[k];
        const adjustment = minOf(payments[i], allocated.minus(availableBudget));
        payments[i] = payments[i].minus(adjustment); allocated = allocated.minus(adjustment);
      }
    }
    let extra = availableBudget.gt(allocated) ? availableBudget.minus(allocated) : zero;
    const states: LoanState[] = active.map(i => Object.freeze({ id: p.loans[i].id, balance: balanceTexts[i], annualRate: p.loans[i].annualRate, minimumPayment: loans[i].minimumMonthlyPayment }));
    let ordered;
    try { ordered = strategy.orderLoans(Object.freeze(states), date); }
    catch { return { ok: false, errors: [{ path: 'repayment.strategyId', code: 'INVALID_STRATEGY', message: 'Strategy could not order the active loans.' }] }; }
    if (!validOrder(ordered, states))
      return { ok: false, errors: [{ path: 'repayment.strategyId', code: 'INVALID_STRATEGY', message: 'Strategy must return every active loan exactly once.' }] };
    for (const target of ordered) {
      if (extra.isZero()) break;
      const i = loanIndexes.get(target.id)!;
      const amount = minOf(extra, dues[i].minus(payments[i]));
      payments[i] = payments[i].plus(amount); extra = extra.minus(amount);
    }
    // Absorb only a small rounded-payment remainder at the contractual last installment.
    for (const i of active) {
      if (month !== lastInstallment[i] || !nearMinimums[i]) continue;
      // Larger residuals keep amortizing; this adjusts cash paid and never forgives debt.
      const remainder = dues[i].minus(payments[i]);
      if ((!options.monthlyBudget || payments[i].gte(chosen[i])) && remainder.gt(0) && remainder.lte(roundingBound(i))) payments[i] = dues[i];
    }
    // US-505: the plan stops amortizing when this month's total payment does not exceed this
    // month's total interest (total debt cannot fall). A single loan underpaid inside a shortfall
    // month is not enough: the total still falls and freed budget reaches it later. While the
    // budget can still change (future life events), the projection continues and only warns.
    // US-507: grace months require no payment, so unpaid grace interest neither stops the projection
    // nor warns; the minimum (and any shortfall) is known only at the repayment-period start.
    let paymentTotal = zero;
    for (const i of active) paymentTotal = paymentTotal.plus(payments[i]);
    let stopProjection = false;
    if (active.length > 0 && paymentTotal.lte(interestTotal)) {
      const inGrace = active.some(i => month < requiredFrom[i]);
      stopProjection = !inGrace && (!options.monthlyBudget || (options.budgetStableFrom !== undefined && date >= options.budgetStableFrom));
      for (const i of active) {
        if (month < requiredFrom[i] || !payments[i].lte(interests[i]) || warnedLoans.has(i)) continue;
        warnedLoans.add(i);
        warnings.push({
          code: payments[i].lt(interests[i]) ? 'NEGATIVE_AMORTIZATION' : 'NON_AMORTIZING', loanId: p.loans[i].id, date,
          message: stopProjection
            ? 'Payment does not reduce this loan balance; no debt-free date is projected.'
            : 'Payments this month do not cover the interest, so the balance grows until payments increase.',
        });
      }
    }
    const rows: LoanPayment[] = [];
    let rowInterest = zero;
    let rowPrincipal = zero;
    let remaining = zero;
    let paidOff = false;
    for (const i of active) {
      // Grace months keep interest separate (interest first); it is capitalized at the period start.
      const separateInterest = separates[i] || month < requiredFrom[i];
      if (month < requiredFrom[i]) graceInterest[i] = graceInterest[i].plus(interests[i]);
      const interestDue = separateInterest ? interests[i].plus(unpaidInterest[i]) : interests[i];
      const paidInterest = separateInterest ? minOf(payments[i], interestDue) : interests[i];
      unpaidInterest[i] = separateInterest ? interestDue.minus(paidInterest) : zero;
      const principal = payments[i].minus(paidInterest);
      balances[i] = balances[i].minus(principal);
      // Negative amortization remains visible as combined balance, without charging interest on uncapitalized interest.
      const owed = separateInterest ? balances[i].plus(unpaidInterest[i]) : balances[i];
      const owedText = money(owed);
      balanceTexts[i] = separateInterest ? money(balances[i]) : owedText;
      rows.push({ loanId: p.loans[i].id, payment: money(payments[i]), interest: money(paidInterest), principal: money(principal), remainingBalance: owedText });
      rowInterest = rowInterest.plus(paidInterest);
      rowPrincipal = rowPrincipal.plus(principal);
      remaining = remaining.plus(owed);
      if (!balances[i].gt(0)) paidOff = true;
    }
    // US-507: the repayment period starts after the last grace month: capitalize (when enabled) and
    // set the minimum from what is owed then, amortized over the loan's term.
    for (const i of graceEnds.get(month) ?? []) {
      const capitalized = separates[i] ? zero : unpaidInterest[i];
      balances[i] = balances[i].plus(capitalized);
      unpaidInterest[i] = unpaidInterest[i].minus(capitalized);
      capitalizedTotals[i] = capitalizedTotals[i].plus(capitalized);
      const owed = balances[i].plus(unpaidInterest[i]);
      const minimum = owed.gt(0) ? amortizedMinimum(owed, p.loans[i].annualRate, p.loans[i].termMonths) : zero;
      minimums[i] = new D(money(minimum));
      const fixed = p.loans[i].monthlyPayment;
      chosen[i] = fixed === undefined ? minimums[i] : new D(fixed);
      nearMinimums[i] = chosen[i].gt(0) && chosen[i].minus(minimums[i]).abs().lte('0.01');
      balanceTexts[i] = money(balances[i]);
      loans[i] = {
        ...loans[i],
        accruedInterest: money(new D(loans[i].accruedInterest).plus(graceInterest[i])),
        capitalizedInterest: money(capitalized),
        balanceAtRepaymentStart: money(balances[i]),
        minimumMonthlyPayment: money(minimum),
      };
    }
    if (paidOff) active = active.filter(i => balances[i].gt(0));
    totalScheduledInterest = totalScheduledInterest.plus(rowInterest);
    totalPayments = totalPayments.plus(paymentTotal);
    schedule.push({ month, date, loans: rows, payment: money(paymentTotal), interest: money(rowInterest), principal: money(rowPrincipal), remainingBalance: money(remaining) });
    if (stopProjection) { status = 'notAmortizing'; break; }
  }
  if (status === 'paidOff' && (active.length > 0 || nextPending < pending.length)) {
    status = 'horizonExceeded';
    const limit = horizon % 12 === 0 ? `${horizon / 12} year${horizon === 12 ? '' : 's'}` : `${horizon} months`;
    warnings.push({ code: 'HORIZON_EXCEEDED', message: `No payoff found within the modeled limit of ${limit}. This is not forgiveness: the remaining debt is still owed.` });
  }
  // Capitalized interest (wherever it was capitalized) + in-school payments + interest paid in the schedule.
  const totalInterestPaid = status === 'paidOff'
    ? money(sum(loans.map((loan, i) => capitalizedTotals[i].plus(loan.inSchoolInterestPaid))).plus(totalScheduledInterest))
    : null;
  return { ok: true, value: { status, repaymentStartDate, firstPaymentDate: addMonths(repaymentStartDate, 1), loans, balanceAtRepaymentStart: money(sum(loans.map(loan => loan.balanceAtRepaymentStart))), inSchoolInterestPayments, amortizationSchedule: schedule, debtFreeDate: status === 'paidOff' ? schedule.at(-1)?.date ?? repaymentStartDate : null, totalInterestPaid, totalRepaymentPayments: money(totalPayments), warnings } };
}

const TWELVE = new D(12);
/**
 * The minimum amortizes everything owed at the repayment-period start over the term: principal,
 * capitalized interest and any accrued interest kept separate (uncapitalized). Excluding the separate
 * interest would leave it unpaid at the end of the term, so "paying the minimum" would overrun the term.
 */
function amortizedMinimum(owed: Decimal, annualRate: string, termMonths: number): Decimal {
  const rate = new D(annualRate).div(12);
  return rate.isZero() ? owed.div(termMonths) : owed.times(rate).div(new D(1).minus(new D(1).plus(rate).pow(-termMonths)));
}
/** The smaller of two values (same value as D.min, without copying both arguments). */
const minOf = (a: Decimal, b: Decimal): Decimal => (b.lt(a) ? b : a);

/** A strategy result must contain every active loan exactly once (US-605 boundary check). */
function validOrder(ordered: unknown, states: readonly LoanState[]): ordered is readonly LoanState[] {
  if (!Array.isArray(ordered) || ordered.length !== states.length) return false;
  const expected = new Set(states.map(state => state.id));
  const seen = new Set<string>();
  for (const loan of ordered as unknown[]) {
    const id = (loan as LoanState | null)?.id;
    if (!loan || typeof id !== 'string' || !expected.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}
