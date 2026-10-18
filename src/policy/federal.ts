/**
 * Federal reference checks and income-driven repayment estimates (US-405, US-1102).
 * Every number comes from ./reference (sourced and dated); nothing here blocks a plan.
 */
import type Decimal from 'decimal.js';
import type { PlannerLoan, PlannerPlan } from '../engine/planner-contracts';
import { voluntaryStartDate } from '../engine/paymentTiming';
import { D, cents, money, sum } from '../engine/money';
import { addMonths, daysBetween, validDate } from '../engine/dates';
import { loanYearIndex } from '../engine/planner';
import { federalReference as ref } from './reference';

const isDirect = (loan: PlannerLoan) => loan.type === 'subsidized' || loan.type === 'unsubsidized';
const usd = (value: Decimal.Value) => '$' + new D(value).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ------------------------------------------------------------------ Loan limit warnings (US-405)

/** Non-blocking warnings when modeled Direct Loans exceed the stored federal limits. */
export function loanLimitNotices(plan: PlannerPlan): string[] {
  const directByYear = plan.schoolYears.map((_, index) =>
    plan.loans.filter(loan => isDirect(loan) && loanYearIndex(plan, loan) === index));
  return plan.borrower.level === 'graduate' ? graduateNotices(plan, directByYear) : undergraduateNotices(plan, directByYear);
}

function graduateNotices(plan: PlannerPlan, directByYear: PlannerLoan[][]): string[] {
  const notices: string[] = [];
  directByYear.forEach((loans, index) => {
    const borrowed = sum(loans.map(loan => loan.principal));
    if (borrowed.gt(ref.graduateAnnual)) {
      notices.push(`Year ${index + 1}: Direct Loan borrowing exceeds the ${usd(ref.graduateAnnual)} graduate annual Direct Unsubsidized limit.`);
    }
  });
  // FSA Loan Limits FAQ (GPSLL-Q2): only Direct Subsidized/Unsubsidized loans borrowed as a graduate
  // student count toward the graduate aggregate; undergraduate loans and Grad PLUS do not. Prior
  // federal debt may include undergraduate loans, so it is not added to this check.
  const modeled = sum(directByYear.flat().map(loan => loan.principal));
  const prior = new D(plan.borrower.priorFederalDebt);
  if (modeled.gt(ref.graduateAggregate)) {
    notices.push(`Modeled graduate Direct Loan borrowing exceeds the ${usd(ref.graduateAggregate)} graduate aggregate limit for new borrowers.`);
  }
  if (prior.gt(0)) {
    notices.push(`Direct Loans you borrowed earlier as a graduate student also count toward the ${usd(ref.graduateAggregate)} graduate aggregate limit; undergraduate loans and Grad PLUS loans do not. Your financial aid office determines the total that counts.`);
  }
  // The lifetime maximum counts all federal borrowing, including prior debt.
  if (prior.plus(modeled).gt(ref.lifetimeMaximum)) {
    notices.push(`Federal borrowing including prior debt exceeds the ${usd(ref.lifetimeMaximum)} lifetime maximum aggregate loan limit. Borrowers covered by the interim (legacy) exception are exempt from this limit during their expected time to credential.`);
  }
  notices.push(
    `Professional programs allow up to ${usd(ref.professionalAnnual)} a year (${usd(ref.professionalAggregate)} aggregate), and students covered by the interim exception for loans before July 1, 2026 keep the ${usd(ref.legacyGraduateAggregate)} legacy aggregate limit. Grad PLUS is no longer available to new borrowers. Ask your financial aid office which limits apply to you.`,
  );
  return notices;
}

function undergraduateNotices(plan: PlannerPlan, directByYear: PlannerLoan[][]): string[] {
  const notices: string[] = [];
  const dependent = plan.borrower.dependency === 'dependent';
  const annualLimits = dependent ? ref.dependentAnnual : ref.independentAnnual;
  let total = new D(plan.borrower.priorFederalDebt);
  let subsidizedTotal = new D(0);
  directByYear.forEach((loans, index) => {
    const level = Math.min(index, 2);
    const borrowed = sum(loans.map(loan => loan.principal));
    const subsidized = sum(loans.filter(loan => loan.type === 'subsidized').map(loan => loan.principal));
    total = total.plus(borrowed);
    subsidizedTotal = subsidizedTotal.plus(subsidized);
    if (borrowed.gt(annualLimits[level])) {
      notices.push(`Year ${index + 1}: federal borrowing exceeds the ${usd(annualLimits[level])} annual undergraduate limit (${dependent ? 'dependent' : 'independent'} student).`);
    }
    if (subsidized.gt(ref.subsidizedAnnual[level])) {
      notices.push(`Year ${index + 1}: subsidized borrowing exceeds the ${usd(ref.subsidizedAnnual[level])} annual subsidized limit.`);
    }
  });
  const aggregate = dependent ? ref.dependentAggregate : ref.independentAggregate;
  if (total.gt(aggregate)) {
    notices.push(`Federal borrowing plus prior debt exceeds the ${usd(aggregate)} undergraduate aggregate limit.`);
  }
  if (subsidizedTotal.gt(ref.subsidizedAggregate)) {
    notices.push(`Modeled subsidized borrowing exceeds the ${usd(ref.subsidizedAggregate)} aggregate subsidized limit; prior subsidized debt is not included.`);
  }
  return notices;
}

// ------------------------------------------------------------------ Shared IDR helpers

interface IdrLoan { loan: PlannerLoan; principal: Decimal; unpaid: Decimal; monthlyRate: Decimal }

/** Eligible Direct Loans at repayment start; pre-repayment interest stays as unpaid (uncapitalized) interest. */
function idrLoans(loans: readonly PlannerLoan[], start: string): IdrLoan[] {
  return loans.map(loan => {
    const accrues = loan.type !== 'subsidized' && !loan.payInterestWhileInSchool;
    const unpaid = accrues ? cents(new D(loan.principal).times(loan.annualRate).times(daysBetween(loan.disbursementDate, start)).div(365)) : new D(0);
    return { loan, principal: new D(loan.principal), unpaid, monthlyRate: new D(loan.annualRate).div(12) };
  });
}

function repaymentStart(plan: PlannerPlan, months: number): string {
  const start = voluntaryStartDate(plan);
  if (!validDate(start) || !validDate(addMonths(start, months))) {
    throw new Error('Federal comparison would exceed the supported calendar date range.');
  }
  return start;
}

/** Split `payment` across loans in proportion to balance, capped at each loan's amount due. */
function allocate(payment: Decimal, weights: Decimal[], dues: Decimal[]): Decimal[] {
  const weightTotal = sum(weights);
  const shares = weights.map((weight, i) => (weightTotal.isZero() ? new D(0) : D.min(dues[i], cents(payment.times(weight).div(weightTotal)))));
  let residue = payment.minus(sum(shares));
  for (let i = shares.length - 1; i >= 0 && residue.lt(0); i--) {
    const reduction = D.min(shares[i], residue.negated());
    shares[i] = shares[i].minus(reduction);
    residue = residue.plus(reduction);
  }
  for (let i = 0; i < shares.length && residue.gt(0); i++) {
    const extra = D.min(residue, dues[i].minus(shares[i]));
    shares[i] = shares[i].plus(extra);
    residue = residue.minus(extra);
  }
  return shares;
}

// ------------------------------------------------------------------ Repayment Assistance Plan

/** RAP monthly payment: AGI band base ÷ 12 − $50 per dependent, never below the $10 minimum. */
export function rapPayment(agi: string, dependents: number): string {
  const income = new D(agi);
  let rate: string = ref.rap.topRate;
  for (const [limit, bandRate] of ref.rap.brackets) {
    if (income.lte(limit)) { rate = bandRate; break; }
  }
  const annualBase = income.lte(ref.rap.brackets[0][0]) ? new D(ref.rap.lowIncomeAnnualPayment) : income.times(rate);
  const monthly = annualBase.div(12).minus(new D(dependents).times(ref.rap.dependentReduction));
  return money(D.max(ref.rap.minimum, monthly));
}

export interface RapMonth { month: number; date: string; payment: string; interestPaid: string; interestSubsidy: string; principalPaid: string; principalMatch: string; balance: string }

/**
 * RAP estimate for the plan's Direct Loans. Federal rules: unpaid monthly interest is not charged
 * after an on-time payment; principal is matched up to $50 when the payment reduces principal by
 * less than $50; any balance left after 360 payments is forgiven. Modeling assumptions: constant
 * AGI and family size, every payment on time, dependents = family size − 1.
 */
export function modelRap(plan: PlannerPlan) {
  const loans = plan.loans.filter(isDirect);
  const start = repaymentStart(plan, ref.rap.forgivenessMonths);
  const state = idrLoans(loans, start);
  const required = new D(rapPayment(plan.repayment.annualAGI, Math.max(0, plan.repayment.familySize - 1)));
  const rows: RapMonth[] = [];
  let totalPaid = new D(0);
  let totalSubsidy = new D(0);
  let totalMatch = new D(0);
  const outstanding = () => sum(state.map(item => item.principal.plus(item.unpaid)));

  for (let month = 1; month <= ref.rap.forgivenessMonths && outstanding().gt(0); month++) {
    const interests = state.map(item => cents(item.principal.times(item.monthlyRate)));
    const dues = state.map((item, i) => item.principal.plus(item.unpaid).plus(interests[i]));
    const payment = D.min(required, sum(dues));
    const shares = allocate(payment, state.map(item => item.principal.plus(item.unpaid)), dues);
    let interestPaid = new D(0);
    let subsidy = new D(0);
    let principalPaid = new D(0);
    state.forEach((item, i) => {
      // Order: this month's interest, then older unpaid interest, then principal.
      const current = D.min(shares[i], interests[i]);
      interestPaid = interestPaid.plus(current);
      subsidy = subsidy.plus(interests[i].minus(current));
      let rest = shares[i].minus(current);
      const older = D.min(rest, item.unpaid);
      item.unpaid = item.unpaid.minus(older);
      interestPaid = interestPaid.plus(older);
      rest = rest.minus(older);
      const paid = D.min(rest, item.principal);
      item.principal = item.principal.minus(paid);
      principalPaid = principalPaid.plus(paid);
    });
    let match = D.min(D.max(0, D.min(payment, ref.rap.principalMatchCap).minus(principalPaid)), sum(state.map(item => item.principal)));
    const appliedMatch = match;
    for (const item of state) {
      const part = D.min(item.principal, match);
      item.principal = item.principal.minus(part);
      match = match.minus(part);
    }
    totalPaid = totalPaid.plus(payment);
    totalSubsidy = totalSubsidy.plus(subsidy);
    totalMatch = totalMatch.plus(appliedMatch);
    rows.push({
      month, date: addMonths(start, month), payment: money(payment), interestPaid: money(interestPaid), interestSubsidy: money(subsidy),
      principalPaid: money(principalPaid), principalMatch: money(appliedMatch), balance: money(outstanding()),
    });
  }
  return {
    monthlyPayment: money(required), rows, totalPaid: money(totalPaid), totalInterestSubsidy: money(totalSubsidy),
    totalPrincipalMatch: money(totalMatch), forgiven: money(outstanding()), endDate: rows.at(-1)?.date ?? start, eligibleLoanCount: loans.length,
  };
}

// ------------------------------------------------------------------ Income-Based Repayment

/** HHS poverty guideline (48 contiguous states and DC) for a household size. */
export function povertyGuideline(familySize: number): Decimal {
  const people = Math.max(1, Math.floor(familySize));
  return new D(ref.povertyGuideline.base).plus(new D(people - 1).times(ref.povertyGuideline.perAdditionalPerson));
}

/** 10-year standard payment on a balance at a (balance-weighted) set of loans. */
function standardPayment(items: readonly IdrLoan[]): Decimal {
  return sum(items.map(item => {
    const balance = item.principal.plus(item.unpaid);
    const rate = item.monthlyRate;
    return rate.isZero() ? balance.div(120) : balance.times(rate).div(new D(1).minus(new D(1).plus(rate).pow(-120)));
  }));
}

/**
 * IBR payment before the standard cap: share × max(0, AGI − 150% of poverty guideline) ÷ 12.
 * Under $5 → $0; $5 to under $10 → $10 (34 CFR 685.209(g)).
 */
export function ibrPayment(agi: string, familySize: number, newBorrower: boolean): string {
  const terms = newBorrower ? ref.ibr.newBorrower : ref.ibr.otherBorrower;
  const discretionary = D.max(0, new D(agi).minus(povertyGuideline(familySize).times(ref.ibr.povertyMultiple)));
  const monthly = cents(discretionary.times(terms.share).div(12));
  if (monthly.lt(5)) return '0.00';
  return money(D.max(10, monthly));
}

export interface IbrMonth { month: number; date: string; payment: string; interestPaid: string; interestWaived: string; principalPaid: string; balance: string }
export type IbrEstimate =
  | { eligible: false; reason: string }
  | {
    eligible: true; newBorrower: boolean; monthlyPayment: string; standardCap: string; capped: boolean; rows: IbrMonth[];
    totalPaid: string; totalInterestWaived: string; forgiven: string; endDate: string; eligibleLoanCount: number;
  };

/**
 * IBR estimate for Direct Loans made before July 1, 2026 (loans made on or after that date can
 * use only the Tiered Standard plan or RAP). Federal rules: payment is the lesser of the IBR share
 * of discretionary income and the 10-year standard payment at IBR entry; unpaid interest on
 * subsidized loans is not charged for the first 3 years; when the payment is the standard cap,
 * unpaid interest capitalizes; any balance is forgiven after 240 (new borrower) or 300 payments.
 * Modeling assumptions: constant AGI and family size; "new borrower" when every Direct Loan was
 * disbursed on or after 2014-07-01 and prior federal debt is zero.
 */
export function modelIbr(plan: PlannerPlan): IbrEstimate {
  const direct = plan.loans.filter(isDirect);
  if (!direct.length) return { eligible: false, reason: 'IBR applies only to federal Direct Loans; no Direct Loans are modeled.' };
  // 34 CFR 685.210(a)(1)(ii), (a)(3): a borrower with any Direct Loan made on or after July 1, 2026
  // may repay only under the Tiered Standard plan or RAP, and all of the borrower's loans repay under
  // one plan, so IBR is unavailable for every loan once one such loan exists.
  if (direct.some(loan => loan.disbursementDate >= ref.ibr.newLoansCutoff)) {
    return {
      eligible: false,
      reason: 'IBR is not available: at least one Direct Loan is made on or after July 1, 2026, so all of your Direct Loans can be repaid only under the Tiered Standard plan or RAP.',
    };
  }
  const eligible = direct;
  const newBorrower = new D(plan.borrower.priorFederalDebt).isZero()
    && direct.every(loan => loan.disbursementDate >= ref.ibr.newBorrowerSince && loan.disbursementDate < ref.ibr.newLoansCutoff);
  const terms = newBorrower ? ref.ibr.newBorrower : ref.ibr.otherBorrower;
  const start = repaymentStart(plan, terms.forgivenessMonths);
  const state = idrLoans(eligible, start);
  const cap = cents(standardPayment(state));
  const incomePayment = new D(ibrPayment(plan.repayment.annualAGI, plan.repayment.familySize, newBorrower));
  const capped = incomePayment.gte(cap);
  const required = capped ? cap : incomePayment;
  if (capped) {
    // 34 CFR 685.209(j)(2)(ii): unpaid interest capitalizes when the payment is the standard amount.
    for (const item of state) { item.principal = item.principal.plus(item.unpaid); item.unpaid = new D(0); }
  }
  const rows: IbrMonth[] = [];
  let totalPaid = new D(0);
  let totalWaived = new D(0);
  const outstanding = () => sum(state.map(item => item.principal.plus(item.unpaid)));

  for (let month = 1; month <= terms.forgivenessMonths && outstanding().gt(0); month++) {
    const interests = state.map(item => cents(item.principal.times(item.monthlyRate)));
    const dues = state.map((item, i) => item.principal.plus(item.unpaid).plus(interests[i]));
    const payment = D.min(required, sum(dues));
    const shares = allocate(payment, state.map(item => item.principal.plus(item.unpaid)), dues);
    let interestPaid = new D(0);
    let waived = new D(0);
    let principalPaid = new D(0);
    state.forEach((item, i) => {
      const current = D.min(shares[i], interests[i]);
      interestPaid = interestPaid.plus(current);
      const uncovered = interests[i].minus(current);
      if (item.loan.type === 'subsidized' && month <= 36) waived = waived.plus(uncovered);
      else item.unpaid = item.unpaid.plus(uncovered);
      let rest = shares[i].minus(current);
      const older = D.min(rest, item.unpaid);
      item.unpaid = item.unpaid.minus(older);
      interestPaid = interestPaid.plus(older);
      rest = rest.minus(older);
      const paid = D.min(rest, item.principal);
      item.principal = item.principal.minus(paid);
      principalPaid = principalPaid.plus(paid);
    });
    totalPaid = totalPaid.plus(payment);
    totalWaived = totalWaived.plus(waived);
    rows.push({
      month, date: addMonths(start, month), payment: money(payment), interestPaid: money(interestPaid), interestWaived: money(waived),
      principalPaid: money(principalPaid), balance: money(outstanding()),
    });
  }
  return {
    eligible: true, newBorrower, monthlyPayment: money(required), standardCap: money(cap), capped, rows, totalPaid: money(totalPaid),
    totalInterestWaived: money(totalWaived), forgiven: money(outstanding()), endDate: rows.at(-1)?.date ?? start, eligibleLoanCount: eligible.length,
  };
}

// ------------------------------------------------------------------ Tiered Standard plan

/** Tiered Standard reference (34 CFR 685.208(c)(1)); read only from versioned reference data. */
const tieredReference = () => ref.tieredStandard;

/** Term in months for a total Direct Loan balance at repayment entry. */
export function tieredStandardTerm(totalBalance: Decimal.Value): number {
  const balance = new D(totalBalance);
  const tiers = tieredReference().tiers;
  for (const [limit, months] of tiers) if (limit === null || balance.lt(limit)) return months;
  return tiers[tiers.length - 1][1];
}

export interface TieredMonth { month: number; date: string; payment: string; interestPaid: string; principalPaid: string; balance: string }
export type TieredStandardEstimate =
  | { eligible: false; reason: string }
  | {
    eligible: true; balanceAtEntry: string; termMonths: number; monthlyPayment: string; minimumApplied: boolean; rows: TieredMonth[];
    totalPaid: string; totalInterest: string; endDate: string; eligibleLoanCount: number; source: string;
  };

/**
 * Tiered Standard estimate for the plan's Direct Loans. Federal rule (34 CFR 685.208, reference
 * data): the term depends on the total Direct Loan balance when repayment begins (tiers from
 * reference data) with a fixed amortized payment and a minimum monthly payment.
 * Modeling assumptions: the tier is chosen on principal plus interest accrued before repayment
 * (not capitalized; payments clear that interest before principal); the fixed payment is the sum
 * of each loan's amortized payment over the tier term, rounded to cents, never below the minimum;
 * the final payment absorbs the cent remainder so the balance ends at $0.00.
 */
export function modelTieredStandard(plan: PlannerPlan): TieredStandardEstimate {
  const loans = plan.loans.filter(isDirect);
  if (!loans.length) return { eligible: false, reason: 'The Tiered Standard plan applies only to federal Direct Loans; no Direct Loans are modeled.' };
  const reference = tieredReference();
  const longestTerm = Math.max(...reference.tiers.map(([, months]) => months));
  const start = repaymentStart(plan, longestTerm);
  const state = idrLoans(loans, start);
  const outstanding = () => sum(state.map(item => item.principal.plus(item.unpaid)));
  const balanceAtEntry = outstanding();
  const termMonths = tieredStandardTerm(balanceAtEntry);
  const amortized = cents(sum(state.map(item => {
    const balance = item.principal.plus(item.unpaid);
    const rate = item.monthlyRate;
    return rate.isZero() ? balance.div(termMonths) : balance.times(rate).div(new D(1).minus(new D(1).plus(rate).pow(-termMonths)));
  })));
  const minimumApplied = amortized.lt(reference.minimumPayment);
  const required = minimumApplied ? new D(reference.minimumPayment) : amortized;
  const rows: TieredMonth[] = [];
  let totalPaid = new D(0);
  let totalInterest = new D(0);
  for (let month = 1; month <= termMonths && outstanding().gt(0); month++) {
    const interests = state.map(item => cents(item.principal.times(item.monthlyRate)));
    const dues = state.map((item, i) => item.principal.plus(item.unpaid).plus(interests[i]));
    const dueTotal = sum(dues);
    // US-504-style final payment: the last scheduled payment clears the remaining balance.
    const payment = month === termMonths ? dueTotal : D.min(required, dueTotal);
    const shares = allocate(payment, state.map(item => item.principal.plus(item.unpaid)), dues);
    let interestPaid = new D(0);
    let principalPaid = new D(0);
    state.forEach((item, i) => {
      // Order: this month's interest, then older unpaid interest, then principal.
      const current = D.min(shares[i], interests[i]);
      item.unpaid = item.unpaid.plus(interests[i].minus(current));
      let rest = shares[i].minus(current);
      const older = D.min(rest, item.unpaid);
      item.unpaid = item.unpaid.minus(older);
      rest = rest.minus(older);
      const paid = D.min(rest, item.principal);
      item.principal = item.principal.minus(paid);
      interestPaid = interestPaid.plus(current).plus(older);
      principalPaid = principalPaid.plus(paid);
    });
    totalPaid = totalPaid.plus(payment);
    totalInterest = totalInterest.plus(interestPaid);
    rows.push({
      month, date: addMonths(start, month), payment: money(payment), interestPaid: money(interestPaid),
      principalPaid: money(principalPaid), balance: money(outstanding()),
    });
  }
  return {
    eligible: true, balanceAtEntry: money(balanceAtEntry), termMonths, monthlyPayment: money(required), minimumApplied, rows,
    totalPaid: money(totalPaid), totalInterest: money(totalInterest), endDate: rows.at(-1)?.date ?? start, eligibleLoanCount: loans.length,
    source: reference.source,
  };
}
