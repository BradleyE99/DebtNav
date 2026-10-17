/**
 * US-506: the smallest monthly debt budget (whole cents) that pays off every loan by a target date.
 *
 * Uses the same simulation as the budget mode (repaymentFor): same strategy, voluntary start, per-loan
 * required dates and minimums (US-507), capitalization and life events (income events change the
 * budget on top of the candidate base budget; windfalls are added). Only the base budget changes:
 * postGradIncome.monthlyDebtBudget = candidate and repayment.extraMonthlyPayment = 0. The user's
 * chosen budget is never modified (inputs are not mutated).
 *
 * Algorithm: integer-cent bisection over [lo, hi] with the invariant "lo does not meet the target,
 * hi does" (meets = paid off with a debt-free date on or before the target). hi starts at the total
 * principal and doubles until it meets the target (or exceeds $1,000,000,000 → infeasible).
 * Monotonicity (a larger budget never pays off later) is the engine's NFR-3 property and is tested
 * by a property test. The answer is re-run once to verify and report its debt-free date.
 * Pure: `today` is supplied by the caller (UTC date).
 */
import type { FieldError, PayoffTarget, PlannerPlan, TargetPaymentResult, ISODate } from './planner-contracts';
import { SIMULATION_CAP_MONTHS } from './planner-contracts';
import type { Projection } from './contracts';
import { D, sum } from './money';
import { addMonths, validDate } from './dates';
import { baseMonthlyBudget, repaymentFor, validatePlannerInputs } from './planner';
import { firstVoluntaryPaymentDate, voluntaryStartDate } from './paymentTiming';

export type PayoffTargetGoal = Exclude<PayoffTarget, { mode: 'budget' }>;

/** Budgets above this are treated as "no budget reaches the target" (the plan money limit). */
const MAX_BUDGET_CENTS = 100_000_000_000;

const invalid = (reason: 'pastTarget' | 'missingInputs' | 'invalidTarget', message: string, errors: FieldError[]): TargetPaymentResult =>
  ({ status: 'invalid', reason, errors, message });
const infeasible = (reason: 'targetBeforeFirstPayment' | 'beyondSimulationCap' | 'noBudgetReachesTarget', message: string): TargetPaymentResult =>
  ({ status: 'infeasible', reason, message });

/** The calendar date a target means: a date as given; a duration of N months ends with payment N. */
export function targetDateFor(plan: PlannerPlan, target: PayoffTargetGoal): ISODate | null {
  if (target.kind === 'date') return validDate(target.date) ? target.date : null;
  if (!Number.isInteger(target.months) || target.months < 1 || target.months > SIMULATION_CAP_MONTHS) return null;
  const first = firstVoluntaryPaymentDate(plan);
  return validDate(first) ? addMonths(first, target.months - 1) : null;
}

const centsText = (cents: number): string => new D(cents).div(100).toFixed(2);

export function solveTargetPayment(plan: PlannerPlan, target: PayoffTargetGoal, today: ISODate): TargetPaymentResult {
  try {
    const targetPath = target?.kind === 'duration' ? 'repayment.payoffTarget.months' : 'repayment.payoffTarget.date';
    const targetError = (message: string): FieldError[] => [{ path: targetPath, code: 'OUT_OF_RANGE', message }];
    if (!target || target.mode !== 'target' || (target.kind !== 'date' && target.kind !== 'duration')) {
      return invalid('invalidTarget', 'Choose a payoff date or a number of months.', targetError('Choose a payoff date or a number of months.'));
    }
    const targetDate = targetDateFor(plan, target);
    if (targetDate === null) {
      const message = target.kind === 'duration'
        ? `Enter a whole number of months from 1 to ${SIMULATION_CAP_MONTHS}.`
        : 'Enter a complete, valid date (YYYY-MM-DD).';
      return invalid('invalidTarget', message, targetError(message));
    }
    if (!validDate(today)) return invalid('invalidTarget', 'Today\'s date is not available.', [{ path: 'today', code: 'INVALID_DATE', message: 'Today\'s date is not available.' }]);
    if (targetDate < today) {
      const message = `The target date ${targetDate} has already passed. Choose a date after today.`;
      return invalid('pastTarget', message, targetError(message));
    }
    const plannerErrors = validatePlannerInputs(plan);
    if (plannerErrors.length) return invalid('missingInputs', 'Complete the plan before solving for a payment.', plannerErrors);
    if (!plan.loans.length || sum(plan.loans.map(loan => loan.principal)).isZero()) {
      const message = 'Add a loan with a balance to find the payment that reaches a payoff target.';
      return invalid('missingInputs', message, [{ path: 'loans', code: 'REQUIRED', message }]);
    }
    const first = firstVoluntaryPaymentDate(plan);
    if (targetDate < first) {
      return infeasible('targetBeforeFirstPayment', `Your first payment is on ${first}, after this target. Choose a target on or after ${first}, or start payments earlier.`);
    }
    const start = voluntaryStartDate(plan);
    if (targetDate > addMonths(start, SIMULATION_CAP_MONTHS)) {
      return infeasible('beyondSimulationCap', 'This target is beyond the 100-year modeled limit. Choose an earlier target.');
    }
    // Months from the first payment through the target: a candidate is stopped there (it cannot meet the target later).
    let months = 0;
    while (months < SIMULATION_CAP_MONTHS && addMonths(start, months + 1) <= targetDate) months++;

    let iterations = 0;
    const run = (cents: number): Projection | null => {
      iterations++;
      const candidate: PlannerPlan = {
        ...plan,
        postGradIncome: { ...plan.postGradIncome, monthlyDebtBudget: centsText(cents) },
        repayment: { ...plan.repayment, extraMonthlyPayment: '0.00' },
      };
      const result = repaymentFor(candidate, plan.repayment.strategyId, { maxMonths: months });
      if (!result.ok) throw new SolverInputError(result.errors);
      return result.value;
    };
    const meets = (projection: Projection | null): boolean =>
      projection !== null && projection.status === 'paidOff' && projection.debtFreeDate !== null && projection.debtFreeDate <= targetDate;

    let best: { cents: number; projection: Projection };
    const zero = run(0);
    if (meets(zero)) {
      best = { cents: 0, projection: zero! };
    } else {
      let lo = 0;
      let hi = Math.max(1, sum(plan.loans.map(loan => loan.principal)).times(100).ceil().toNumber());
      let hiRun = run(hi);
      while (!meets(hiRun)) {
        lo = hi;
        if (hi >= MAX_BUDGET_CENTS) {
          return infeasible('noBudgetReachesTarget', 'No monthly budget pays off every loan by this target (for example, a loan is disbursed after it). Choose a later target.');
        }
        hi = Math.min(hi * 2, MAX_BUDGET_CENTS);
        hiRun = run(hi);
      }
      let hiProjection = hiRun!;
      while (hi - lo > 1) {
        const mid = lo + Math.floor((hi - lo) / 2);
        const projection = run(mid);
        if (meets(projection)) { hi = mid; hiProjection = projection!; } else lo = mid;
      }
      best = { cents: hi, projection: hiProjection };
    }
    // Verify the answer with a fresh full-length run (the same simulation the budget mode uses).
    const verify = repaymentFor({
      ...plan,
      postGradIncome: { ...plan.postGradIncome, monthlyDebtBudget: centsText(best.cents) },
      repayment: { ...plan.repayment, extraMonthlyPayment: '0.00' },
    });
    iterations++;
    if (!verify.ok || !meets(verify.value) || verify.value.totalInterestPaid === null) {
      return infeasible('noBudgetReachesTarget', 'The payment could not be verified for this target. Choose a later target.');
    }
    const required = centsText(best.cents);
    const chosen = baseMonthlyBudget(plan);
    return {
      status: 'feasible',
      requiredMonthlyBudget: required,
      chosenMonthlyBudget: chosen.toFixed(2),
      difference: new D(required).minus(chosen).toFixed(2),
      targetDate,
      verifiedDebtFreeDate: verify.value.debtFreeDate!,
      totalInterest: verify.value.totalInterestPaid,
      iterations,
    };
  } catch (error) {
    if (error instanceof SolverInputError) return invalid('missingInputs', 'Complete the plan before solving for a payment.', error.errors);
    return invalid('missingInputs', 'The payment for this target could not be calculated.', [{ path: 'plan', code: 'OUT_OF_RANGE', message: 'The payment for this target could not be calculated.' }]);
  }
}

class SolverInputError extends Error {
  constructor(readonly errors: FieldError[]) { super('Plan cannot be projected'); }
}
