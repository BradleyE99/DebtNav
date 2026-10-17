/**
 * US-507: when each loan's required payments start, and when the user's voluntary payments start.
 * Pure helpers shared by the engine, validation and the storage migration (no DOM).
 *
 * Policy basis for the federal default (verified 2026-10-16, see team research brief §4):
 *  - 34 CFR 685.207(b)(2)(i), (c)(2)(i): a six-month grace period begins when a Direct Subsidized /
 *    Unsubsidized borrower ceases at-least-half-time enrollment (graduation is the usual trigger).
 *  - 34 CFR 685.207(b)(4), (c)(4): the repayment period begins the day after the grace period ends.
 *  - 34 CFR 685.207(a)(3): the first payment is due within 60 days of the start of the repayment period.
 *    DebtNav estimates it one month after the repayment period starts (the existing month convention),
 *    which falls inside that window. It is labeled as an estimate; an actual due date overrides it.
 *  - 34 CFR 685.207(b)(3)(ii): the borrower is not obligated to pay interest on a subsidized loan during
 *    grace, except (b)(3)(iii) loans first disbursed 2012-07-01 up to 2014-07-01.
 * Private and other loans have no universal grace (CFPB): their terms come from the loan
 * (RequiredPaymentTerms); with nothing configured no required date is estimated.
 */
import type { ISODate, LoanPaymentTiming, MissedObligationWarning, PlannerLoan, PlannerPlan } from './planner-contracts';
import { FEDERAL_GRACE_MONTHS } from './planner-contracts';
import { addMonths, validDate } from './dates';

/** Subsidized loans first disbursed in [start, end) owe interest during grace (34 CFR 685.207(b)(3)(iii)). */
export const SUBSIDIZED_GRACE_INTEREST_WINDOW = { start: '2012-07-01', end: '2014-07-01' } as const;

export const isFederalLoan = (loan: Pick<PlannerLoan, 'type'>): boolean => loan.type === 'subsidized' || loan.type === 'unsubsidized';

/** The voluntary start S: the month grid starts here and the first voluntary payment is S + 1 month. */
export function voluntaryStartDate(plan: Pick<PlannerPlan, 'settings' | 'repayment'>): ISODate {
  const start = plan.repayment.voluntaryStart;
  return start.kind === 'date' ? start.date : addMonths(plan.settings.graduationDate, start.months);
}

export const firstVoluntaryPaymentDate = (plan: Pick<PlannerPlan, 'settings' | 'repayment'>): ISODate =>
  addMonths(voluntaryStartDate(plan), 1);

/** Last day of the month of `date`. */
function monthEnd(date: ISODate): number {
  const [year, month] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The repayment-period start for an actual first due date: the latest date d with
 * addMonths(d, 1) === due (so a period start that was the last day of a month maps back to it).
 * When no exact inverse exists (e.g. 03-30 after February) the previous month's last day is used.
 */
export function oneMonthBefore(due: ISODate): ISODate {
  const [year, month, day] = due.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
  const previousEnd = monthEnd(previous);
  const target = day === monthEnd(due) ? previousEnd : Math.min(day, previousEnd);
  return `${previous.slice(0, 8)}${String(target).padStart(2, '0')}`;
}

/** Required-payment timing for one loan (see RequiredPaymentTerms in planner-contracts.ts). */
export function loanPaymentTiming(plan: Pick<PlannerPlan, 'settings'>, loan: PlannerLoan): LoanPaymentTiming {
  const terms = loan.requiredPayment;
  const timing = (repaymentPeriodStart: ISODate, firstRequiredPaymentDate: ISODate, basis: LoanPaymentTiming['basis'], assumption: string | null): LoanPaymentTiming =>
    ({ loanId: loan.id, repaymentPeriodStart, firstRequiredPaymentDate, basis, assumption });
  if (terms?.firstDueDate !== undefined) {
    return timing(oneMonthBefore(terms.firstDueDate), terms.firstDueDate, 'actualDueDate', null);
  }
  if (isFederalLoan(loan)) {
    const start = addMonths(plan.settings.graduationDate, FEDERAL_GRACE_MONTHS);
    return timing(start, addMonths(start, 1), 'federalDefault',
      `Estimated: federal Direct loans enter repayment ${FEDERAL_GRACE_MONTHS} months after graduation (34 CFR 685.207); first payment assumed one month later. Use your servicer's actual due date when you have it.`);
  }
  if (terms?.inSchoolPayments === true) {
    return timing(loan.disbursementDate, addMonths(loan.disbursementDate, 1), 'inSchool',
      'Your lender requires payments while in school: estimated from one month after disbursement.');
  }
  if (terms?.graceMonths !== undefined) {
    const start = addMonths(plan.settings.graduationDate, terms.graceMonths);
    return timing(start, addMonths(start, 1), 'loanGrace',
      `Estimated: ${terms.graceMonths} month${terms.graceMonths === 1 ? '' : 's'} after graduation, from this loan's terms.`);
  }
  return { loanId: loan.id, repaymentPeriodStart: null, firstRequiredPaymentDate: null, basis: 'notConfigured', assumption: null };
}

export const paymentTimingFor = (plan: Pick<PlannerPlan, 'settings' | 'loans'>): LoanPaymentTiming[] =>
  plan.loans.map(loan => loanPaymentTiming(plan, loan));

/** Number of required payment dates (first, first + 1 month, …) strictly before `firstPayment`. */
export function countMissedPayments(firstRequired: ISODate, firstPayment: ISODate): number {
  let count = 0;
  while (count <= 1200 && addMonths(firstRequired, count) < firstPayment) count++;
  return count;
}

/**
 * US-507: required payments that fall before the plan's first voluntary payment. Required payments are
 * contractual, so they are never skipped silently: each affected loan gets one warning.
 */
export function missedObligationsFor(plan: Pick<PlannerPlan, 'settings' | 'loans' | 'repayment'>, timing = paymentTimingFor(plan)): MissedObligationWarning[] {
  const start = voluntaryStartDate(plan);
  if (!validDate(start)) return [];
  const warnings: MissedObligationWarning[] = [];
  for (const [index, entry] of timing.entries()) {
    const loan = plan.loans[index];
    if (!entry.firstRequiredPaymentDate || !validDate(entry.firstRequiredPaymentDate)) continue;
    // A loan disbursed after the voluntary start makes its first plan payment in the month after it enters.
    let entryStart = start;
    for (let n = 0; n <= 1200 && entryStart < loan.disbursementDate; n++) entryStart = addMonths(start, n + 1);
    const firstPayment = addMonths(entryStart, 1);
    const missed = countMissedPayments(entry.firstRequiredPaymentDate, firstPayment);
    if (missed === 0) continue;
    warnings.push({
      code: 'MISSED_REQUIRED_PAYMENT', loanId: loan.id, firstMissedDate: entry.firstRequiredPaymentDate, missedPayments: missed,
      message: `Loan "${loan.name}": required payments start ${entry.firstRequiredPaymentDate}, but this plan's payments start ${firstPayment}. `
        + `${missed} required payment${missed === 1 ? ' is' : 's are'} not covered. Missing required payments can lead to late fees, `
        + 'delinquency and default. Start payments earlier, or confirm the actual due date with your servicer or lender.',
    });
  }
  return warnings;
}
