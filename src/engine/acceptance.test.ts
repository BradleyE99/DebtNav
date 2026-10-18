/**
 * SRS §6 acceptance examples and edge cases not covered elsewhere, plus NFR-3 properties for the
 * planner entry points. See planner.test.ts, projection.test.ts, golden.test.ts and
 * strategies.test.ts for the remaining examples.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { CostItem, LifeEvent, PlannerLoan, PlannerPlan, PlannerProjection, PlannerComparisons, Resource, StrategyId } from './planner-contracts';
import { SIMULATION_CAP_MONTHS } from './planner-contracts';
import { createDefaultPlan, calculatePlannerProjection, calculatePlannerComparisons, applyScenario, reconcileSchoolYears } from './planner';
import { D, sum } from './money';
import { addMonths } from './dates';

const cost = (id: string, amount: string): CostItem => ({ id, category: 'tuition', label: id, amount, semester: 'annual' });
const resource = (id: string, amount: string, type: Resource['type'] = 'grant'): Resource => ({
  id, type, label: id, amount, incomeMode: 'fixed', hourlyWage: '0', hoursPerWeek: '0', weeksWorked: '0', unavailablePercent: '0',
});
/** Default plan: repayment starts 2030-11-20; first payment 2030-12-20. */
const loan = (id: string, principal: string, annualRate: string, extra: Partial<PlannerLoan> = {}): PlannerLoan => ({
  id, name: id, type: 'unsubsidized', principal, annualRate, disbursementDate: '2030-11-20', termMonths: 120, ...extra,
});
function project(plan: PlannerPlan): PlannerProjection {
  const result = calculatePlannerProjection(plan);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}
function compare(plan: PlannerPlan): PlannerComparisons {
  const result = calculatePlannerComparisons(plan);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

describe('SRS examples (explicit)', () => {
  it('US-102/US-507: payments start = graduation + chosen months (v4 voluntary start), clamping month ends', () => {
    for (const grace of [0, 6, 12]) {
      const plan = createDefaultPlan();
      plan.repayment.voluntaryStart = { kind: 'afterGraduation', months: grace };
      expect(project(plan).repayment.repaymentStartDate).toBe(addMonths('2030-05-20', grace));
    }
    expect(createDefaultPlan().repayment.voluntaryStart).toEqual({ kind: 'afterGraduation', months: 6 });
    const plan = reconcileSchoolYears({ ...createDefaultPlan(), settings: { ...createDefaultPlan().settings, graduationDate: '2031-08-31' } });
    expect(project(plan).repayment.repaymentStartDate).toBe('2032-02-29');
  });

  it('US-301: a $4,000 Year 1 grant raises resources by $4,000.00 and lowers the gap by $4,000.00, not below $0', () => {
    const plan = createDefaultPlan();
    plan.schoolYears[0].costItems = [cost('t', '10000')];
    const before = project(plan).years[0];
    plan.schoolYears[0].resources = [resource('g', '4000')];
    const after = project(plan).years[0];
    expect(new D(after.resources).minus(before.resources).toFixed(2)).toBe('4000.00');
    expect(new D(before.gap).minus(after.gap).toFixed(2)).toBe('4000.00');
    plan.schoolYears[0].costItems = [cost('t', '3000')];
    expect(project(plan).years[0]).toMatchObject({ gap: '0.00', surplus: '1000.00' });
  });

  it('US-303: $2,000 savings applied to Year 1 raises Year 1 resources by $2,000.00', () => {
    const plan = createDefaultPlan();
    plan.schoolYears[0].resources = [resource('family', '500', 'family')];
    const before = project(plan).years[0].resources;
    plan.schoolYears[0].resources.push(resource('s', '2000', 'savings'));
    expect(new D(project(plan).years[0].resources).minus(before).toFixed(2)).toBe('2000.00');
  });

  it('US-604: each strategy shows debt-free date, total interest, first payoff month and exact deltas from the lowest-interest strategy', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('large', '12000', '0.09'), loan('mid', '4000', '0.05'), loan('small', '1500', '0.03')];
    plan.postGradIncome.monthlyDebtBudget = '450.00';
    plan.repayment.customOrder = ['mid', 'small', 'large'];
    const { strategyComparisons } = compare(plan);
    const lowest = strategyComparisons.reduce((best, item) => new D(item.projection.totalInterestPaid!).lt(best.projection.totalInterestPaid!) ? item : best);
    expect(lowest.id).toBe('avalanche');
    for (const item of strategyComparisons) {
      expect(item.projection.debtFreeDate).not.toBeNull();
      expect(item.projection.totalInterestPaid).not.toBeNull();
      const firstPaid = item.projection.amortizationSchedule.find(row => row.loans.some(entry => entry.remainingBalance === '0.00'))!.month;
      expect(item.firstPayoffMonth).toBe(firstPaid);
      expect(item.interestDifference).toBe(new D(item.projection.totalInterestPaid!).minus(lowest.projection.totalInterestPaid!).toFixed(2));
      expect(item.monthsDifference).toBe(item.projection.amortizationSchedule.length - lowest.projection.amortizationSchedule.length);
    }
    const snowball = strategyComparisons.find(item => item.id === 'snowball')!;
    expect(new D(snowball.interestDifference!).gt(0)).toBe(true);
  });

  it('US-604: strategies are identical when the budget is below the minimums (no extra to direct)', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('a', '10000', '0.08'), loan('b', '2000', '0.03')];
    plan.postGradIncome.monthlyDebtBudget = '100.00';
    plan.lifeEvents = [{ id: 'raise', name: 'Raise', date: '2032-01-01', type: 'income', amount: '75000', allocationPercent: '0' }];
    const [first, ...others] = compare(plan).strategyComparisons.map(item => item.projection);
    for (const other of others) expect(other.amortizationSchedule).toEqual(first.amortizationSchedule);
  });

  it('US-801: a scenario with no overrides equals the base plan and projection', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('a', '9000', '0.06')];
    plan.scenarios = [{ id: 'same', name: 'Same', overrides: {} }];
    expect(applyScenario(plan, plan.scenarios[0])).toEqual(plan);
    const [same] = compare(plan).scenarioComparisons;
    expect(same.projection).toEqual(project(plan).repayment);
    expect(same).toMatchObject({ interestDifference: '0.00', monthsDifference: 0 });
  });
});

describe('edge cases', () => {
  it('memoizes the base projection by plan content and never serves a stale result after an in-place edit', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('a', '10000', '0.06')];
    const first = project(plan).repayment;
    const [avalancheFirst] = compare(plan).strategyComparisons;
    expect(avalancheFirst.projection).toBe(first); // same content: shared, not recomputed
    plan.postGradIncome.monthlyDebtBudget = '900.00'; // in-place edit of the same object
    const second = project(plan).repayment;
    expect(second.amortizationSchedule.length).toBeLessThan(first.amortizationSchedule.length);
    expect(compare(plan).strategyComparisons[0].projection).toBe(second);
    expect(project(structuredClone(plan)).repayment).toEqual(second);
  });

  it('a plan with no loans projects nothing owed, with no warnings, and compares cleanly', () => {
    const plan = createDefaultPlan();
    const result = project(plan);
    expect(result.repayment).toMatchObject({ status: 'paidOff', amortizationSchedule: [], totalInterestPaid: '0.00', debtFreeDate: result.repayment.repaymentStartDate, warnings: [] });
    expect(result).toMatchObject({ minimumTotal: '0.00', paymentShortfall: '0.00' });
    const comparisons = compare(plan);
    expect(comparisons.strategyComparisons.every(item => item.firstPayoffMonth === 0 && item.interestDifference === '0.00')).toBe(true);
  });

  it('zero-principal and zero-rate loans never divide by zero', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('zero', '0.00', '0.05'), loan('free', '1000.00', '0', { termMonths: 7 })];
    plan.postGradIncome.monthlyDebtBudget = '0.00';
    plan.repayment.extraMonthlyPayment = '0.00';
    const stuck = project(plan);
    expect(stuck.repayment.status).toBe('notAmortizing');
    expect(stuck.paymentShortfall).toBe('142.86');
    plan.postGradIncome.monthlyDebtBudget = '142.86';
    const paid = project(plan).repayment;
    // 1000 / 7 = 142.857… → 142.86; six payments of 142.86 and a final 142.84.
    expect(paid.amortizationSchedule).toHaveLength(7);
    expect(paid.amortizationSchedule.at(-1)?.payment).toBe('142.84');
    expect(paid.totalInterestPaid).toBe('0.00');
  });

  it('a payment that exactly equals the interest is not amortizing and has no debt-free date (US-505)', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('a', '12000', '0.06')];
    plan.postGradIncome.monthlyDebtBudget = '60.00'; // 12000 × 0.06 / 12 = 60.00
    const repayment = project(plan).repayment;
    expect(repayment).toMatchObject({ status: 'notAmortizing', debtFreeDate: null, totalInterestPaid: null });
    expect(repayment.warnings[0].code).toBe('NON_AMORTIZING');
  });

  it('an incomplete projection at the simulation cap never reports a debt-free date or total interest', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('a', '50000', '0.07')];
    // v4: no user horizon. A budget 5 cents above the monthly interest cannot pay $50,000 in 100 years.
    plan.postGradIncome.monthlyDebtBudget = new D('50000').times('0.07').div(12).toDecimalPlaces(2).plus('0.05').toFixed(2);
    const repayment = project(plan).repayment;
    expect(repayment).toMatchObject({ status: 'horizonExceeded', debtFreeDate: null, totalInterestPaid: null });
    expect(repayment.amortizationSchedule).toHaveLength(SIMULATION_CAP_MONTHS);
    expect(repayment.warnings.map(warning => warning.code)).toEqual(['HORIZON_EXCEEDED']);
    expect(repayment.warnings[0].message).toMatch(/no payoff found within the modeled limit of 100 years/i);
    expect(repayment.warnings[0].message).toMatch(/not forgiveness/i);
    expect(project(plan).timeline.some(entry => entry.id === 'debt-free')).toBe(false);
  });

  it('accrues across a leap day by actual days and pays on clamped month ends', () => {
    const plan = reconcileSchoolYears({ ...createDefaultPlan(), settings: { ...createDefaultPlan().settings, graduationDate: '2030-08-31' } });
    plan.loans = [loan('a', '3650', '0.10', { disbursementDate: '2028-02-29' })];
    const repayment = project(plan).repayment;
    expect(repayment.repaymentStartDate).toBe('2031-02-28');
    // 2028-02-29 → 2031-02-28 = 1095 days; 3650 × 0.10 × 1095 / 365 = 1095.00
    expect(repayment.loans[0].accruedInterest).toBe('1095.00');
    expect(repayment.amortizationSchedule.slice(0, 3).map(row => row.date)).toEqual(['2031-03-28', '2031-04-28', '2031-05-28']);
  });

  it('the final payment of every loan absorbs the cent remainder so each loan ends at exactly $0.00 (US-504)', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('a', '7777.77', '0.0731', { termMonths: 97 }), loan('b', '1234.56', '0.1299', { termMonths: 37 }), loan('c', '333.33', '0', { termMonths: 7 })];
    for (const strategyId of ['avalanche', 'snowball', 'custom'] as const) {
      plan.repayment.strategyId = strategyId;
      plan.postGradIncome.monthlyDebtBudget = project(plan).minimumTotal;
      const repayment = project(plan).repayment;
      expect(repayment.status).toBe('paidOff');
      for (const start of repayment.loans) {
        const rows = repayment.amortizationSchedule.flatMap(row => row.loans.filter(item => item.loanId === start.loanId));
        expect(rows.at(-1)?.remainingBalance).toBe('0.00');
        expect(sum(rows.map(row => row.principal)).toFixed(2)).toBe(start.balanceAtRepaymentStart);
      }
      // Freed minimums roll forward (US-601), so payoff finishes no later than the longest term.
      expect(repayment.amortizationSchedule.length).toBeLessThanOrEqual(97);
    }
  });
});

// ------------------------------------------------------------------ NFR-3 / NFR-11 properties
/** ISO date `offset` days after the default school start (2026-08-24). */
const day = (offset: number) => new Date(Date.UTC(2026, 7, 24 + offset)).toISOString().slice(0, 10);
const moneyArb = (maxCents: number) => fc.integer({ min: 0, max: maxCents }).map(value => new D(value).div(100).toFixed(2));
const loanArb = fc.record({
  type: fc.constantFrom('subsidized', 'unsubsidized', 'private', 'other') as fc.Arbitrary<PlannerLoan['type']>,
  principal: moneyArb(8_000_000),
  rate: fc.integer({ min: 0, max: 3000 }).map(bp => new D(bp).div(10000).toString()),
  dayOffset: fc.integer({ min: 0, max: 1300 }),
  termMonths: fc.integer({ min: 1, max: 360 }),
  monthlyPayment: fc.option(moneyArb(300_000), { nil: undefined }),
  capitalizeInterest: fc.option(fc.boolean(), { nil: undefined }),
  payInterestWhileInSchool: fc.option(fc.boolean(), { nil: undefined }),
  /** US-507: private/other loan grace terms (undefined = not configured). */
  loanGrace: fc.option(fc.integer({ min: 0, max: 12 }), { nil: undefined }),
});
const eventArb = fc.record({
  type: fc.constantFrom('income', 'windfall', 'expense', 'aid') as fc.Arbitrary<LifeEvent['type']>,
  dayOffset: fc.integer({ min: -400, max: 9000 }),
  amount: moneyArb(15_000_000),
  allocationPercent: fc.integer({ min: 0, max: 100 }).map(String),
  yearly: fc.boolean(),
});
const planArb = fc.record({
  loans: fc.array(loanArb, { maxLength: 6 }),
  events: fc.array(eventArb, { maxLength: 4 }),
  budget: moneyArb(500_000),
  extra: moneyArb(50_000),
  grace: fc.integer({ min: 0, max: 12 }),
  strategyId: fc.constantFrom('avalanche', 'snowball', 'custom') as fc.Arbitrary<StrategyId>,
  scenarioBudget: moneyArb(500_000),
});
type PlanInput = typeof planArb extends fc.Arbitrary<infer T> ? T : never;
function buildPlan(input: PlanInput): PlannerPlan {
  const plan = createDefaultPlan();
  // v4: the voluntary start varies independently of each loan's required dates (early, on time, late).
  plan.repayment = { ...plan.repayment, voluntaryStart: { kind: 'afterGraduation', months: input.grace }, strategyId: input.strategyId, extraMonthlyPayment: input.extra };
  plan.postGradIncome.monthlyDebtBudget = input.budget;
  plan.loans = input.loans.map((item, i) => ({
    id: `l${i}`, name: `Loan ${i}`, type: item.type, principal: item.principal, annualRate: item.rate,
    disbursementDate: day(item.dayOffset), termMonths: item.termMonths,
    ...(item.monthlyPayment === undefined ? {} : { monthlyPayment: item.monthlyPayment }),
    ...(item.capitalizeInterest === undefined ? {} : { capitalizeInterest: item.capitalizeInterest }),
    ...(item.payInterestWhileInSchool === undefined ? {} : { payInterestWhileInSchool: item.payInterestWhileInSchool }),
    ...(item.loanGrace === undefined || item.type === 'subsidized' || item.type === 'unsubsidized' ? {} : { requiredPayment: { graceMonths: item.loanGrace } }),
  }));
  plan.repayment.customOrder = plan.loans.map(item => item.id).reverse();
  plan.lifeEvents = input.events.map((item, i) => ({
    id: `e${i}`, name: `Event ${i}`, type: item.type, date: day(item.dayOffset), amount: item.amount, allocationPercent: item.allocationPercent,
    ...(item.yearly && item.type === 'windfall' ? { recurrence: 'yearly' as const } : {}),
  }));
  plan.scenarios = [{ id: 's', name: 'Scenario', overrides: { 'postGradIncome.monthlyDebtBudget': input.scenarioBudget } }];
  return plan;
}

// Property runs simulate many full projections; coverage instrumentation and shared CI runners slow them down.
const PROPERTY_TIMEOUT_MS = 60_000;

describe('NFR-3 / NFR-11 properties (fast-check)', () => {
  it('never throws or fails for valid plans, never goes negative, and conserves principal when paid off', () => {
    fc.assert(fc.property(planArb, input => {
      const plan = buildPlan(input);
      const before = JSON.stringify(plan);
      const core = calculatePlannerProjection(plan);
      const secondary = calculatePlannerComparisons(plan);
      expect(JSON.stringify(plan)).toBe(before);
      if (!core.ok || !secondary.ok) throw new Error(JSON.stringify(!core.ok ? core.errors : !secondary.ok && secondary.errors));
      const repayment = core.value.repayment;
      expect(repayment.amortizationSchedule.length).toBeLessThanOrEqual(SIMULATION_CAP_MONTHS);
      for (const row of repayment.amortizationSchedule) {
        expect(new D(row.remainingBalance).gte(0)).toBe(true);
        for (const item of row.loans) {
          expect(new D(item.remainingBalance).gte(0)).toBe(true);
          expect(new D(item.payment).gte(0)).toBe(true);
        }
      }
      expect(repayment.debtFreeDate === null).toBe(repayment.status !== 'paidOff');
      expect(repayment.totalInterestPaid === null).toBe(repayment.status !== 'paidOff');
      if (repayment.status === 'paidOff') {
        for (const start of repayment.loans) {
          const rows = repayment.amortizationSchedule.flatMap(row => row.loans.filter(item => item.loanId === start.loanId));
          expect(sum(rows.map(row => new D(row.principal).plus(row.interest))).eq(sum(rows.map(row => row.payment)))).toBe(true);
          if (rows.length) expect(rows.at(-1)!.remainingBalance).toBe('0.00');
        }
      }
    }), { numRuns: 120 });
  }, PROPERTY_TIMEOUT_MS);

  it('more extra payment never means more months (monotonicity)', () => {
    fc.assert(fc.property(fc.array(loanArb, { minLength: 1, maxLength: 4 }), moneyArb(200_000), fc.integer({ min: 1, max: 50_000 }), (loans, extra, more) => {
      const plan = buildPlan({ loans: loans.map(item => ({ ...item, monthlyPayment: undefined, capitalizeInterest: undefined })), events: [], budget: '0.00', extra, grace: 6, strategyId: 'avalanche', scenarioBudget: '0.00' });
      plan.postGradIncome.monthlyDebtBudget = project(plan).minimumTotal;
      const first = project(plan).repayment;
      plan.repayment.extraMonthlyPayment = new D(extra).plus(new D(more).div(100)).toFixed(2);
      const second = project(plan).repayment;
      if (first.status === 'paidOff') {
        expect(second.status).toBe('paidOff');
        expect(second.amortizationSchedule.length).toBeLessThanOrEqual(first.amortizationSchedule.length);
      }
    }), { numRuns: 120 });
  }, PROPERTY_TIMEOUT_MS);

  it('a scenario with no overrides always equals the base projection', () => {
    fc.assert(fc.property(planArb, input => {
      const plan = buildPlan(input);
      plan.scenarios = [{ id: 'same', name: 'Same', overrides: {} }];
      const result = compare(plan);
      expect(result.scenarioComparisons[0].projection).toEqual(project(plan).repayment);
    }), { numRuns: 60 });
  }, PROPERTY_TIMEOUT_MS);
});
