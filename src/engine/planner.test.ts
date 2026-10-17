import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { CostItem, CostPeriod, PlannerLoan, PlannerPlan, Resource, LifeEvent, PlannerProjection, PlannerComparisons } from './planner-contracts';
import {
  createDefaultPlan, calculatePlannerProjection, calculatePlannerComparisons, applyScenario, copyYearCosts,
  reconcileSchoolYears, createLoanFromGap, loanYearIndex,
} from './planner';
import { D, sum, money, cents } from './money';

// ------------------------------------------------------------------ fixtures
const cost = (id: string, amount: string, semester: CostPeriod = 'annual'): CostItem =>
  ({ id, category: 'tuition', label: id, amount, semester });
const resource = (id: string, amount: string, extra: Partial<Resource> = {}): Resource => ({
  id, type: 'grant', label: id, amount, incomeMode: 'fixed', hourlyWage: '0', hoursPerWeek: '0', weeksWorked: '0', unavailablePercent: '0', ...extra,
});
/** Default plan repayment starts 2030-11-20; first payment 2030-12-20. */
const loan = (id = 'a', principal = '10000.00', annualRate = '0.06', extra: Partial<PlannerLoan> = {}): PlannerLoan => ({
  id, name: id, type: 'unsubsidized', principal, annualRate, disbursementDate: '2030-11-20', termMonths: 120, ...extra,
});
const event = (id: string, type: LifeEvent['type'], date: string, amount: string, extra: Partial<LifeEvent> = {}): LifeEvent =>
  ({ id, name: id, type, date, amount, allocationPercent: '100', ...extra });

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
const rowFor = (projection: PlannerProjection, month: string) =>
  projection.repayment.amortizationSchedule.find(row => row.date.startsWith(month));

// ------------------------------------------------------------------ money formatting
describe('money', () => {
  it('formats with half-up transaction rounding', () => {
    for (const value of ['0.0049', '0.005', '0.0051', '1.005', '-1.005', '999999999999999999.995']) expect(money(value)).toBe(cents(value).toFixed(2));
    fc.assert(fc.property(fc.integer({ min: -1000000, max: 1000000 }), fc.integer({ min: 0, max: 999999 }), (whole, fraction) => {
      const value = `${whole}.${String(fraction).padStart(6, '0')}`;
      expect(money(value)).toBe(cents(value).toFixed(2));
    }), { numRuns: 100 });
  });
});

// ------------------------------------------------------------------ US-101 school years
describe('US-101 school years keep their data when dates change', () => {
  it('a one-day start-date shift keeps every year id, cost, resource and buffer', () => {
    const plan = createDefaultPlan();
    plan.schoolYears.forEach((year, index) => {
      year.costItems = [cost(`c${index}`, '1000')];
      year.resources = [resource(`r${index}`, '500')];
      year.bufferPercent = String(index);
    });
    const before = structuredClone(plan);
    const shifted = reconcileSchoolYears({ ...plan, settings: { ...plan.settings, startDate: '2026-08-25' } });
    expect(shifted.schoolYears.map(year => year.id)).toEqual(plan.schoolYears.map(year => year.id));
    expect(shifted.schoolYears.map(year => [year.costItems, year.resources, year.bufferPercent])).toEqual(plan.schoolYears.map(year => [year.costItems, year.resources, year.bufferPercent]));
    expect(shifted.schoolYears[1].startDate).toBe('2027-08-25');
    expect(plan).toEqual(before);
  });

  it('extending graduation adds empty trailing years; shortening drops trailing years only', () => {
    const plan = createDefaultPlan();
    expect(plan.schoolYears.map(year => year.id)).toEqual(['year-1', 'year-2', 'year-3', 'year-4']);
    plan.schoolYears[0].costItems = [cost('t', '20000')];
    const extended = reconcileSchoolYears({ ...plan, settings: { ...plan.settings, graduationDate: '2031-05-20' } });
    expect(extended.schoolYears).toHaveLength(5);
    expect(extended.schoolYears[4]).toMatchObject({ id: 'year-5', costItems: [], resources: [], bufferPercent: '0', endDate: '2031-05-20' });
    expect(extended.schoolYears[0].costItems).toEqual(plan.schoolYears[0].costItems);
    const shortened = reconcileSchoolYears({ ...extended, settings: { ...extended.settings, graduationDate: '2028-05-20' } });
    expect(shortened.schoolYears.map(year => year.id)).toEqual(['year-1', 'year-2']);
    expect(shortened.schoolYears[0].costItems).toEqual(plan.schoolYears[0].costItems);
    expect(shortened.schoolYears[1].endDate).toBe('2028-05-20');
  });

  it('keeps legacy date-shaped ids and leaves invalid date edits unchanged', () => {
    const plan = createDefaultPlan();
    plan.schoolYears = plan.schoolYears.map(year => ({ ...year, id: year.startDate }));
    const shifted = reconcileSchoolYears({ ...plan, settings: { ...plan.settings, startDate: '2026-09-01' } });
    expect(shifted.schoolYears.map(year => year.id)).toEqual(['2026-08-24', '2027-08-24', '2028-08-24', '2029-08-24']);
    const invalid = { ...plan, settings: { ...plan.settings, graduationDate: '2020-01-01' } };
    expect(reconcileSchoolYears(invalid)).toBe(invalid);
  });
});

// ------------------------------------------------------------------ Epics 2–3: costs, resources, gap
describe('borrowing phase', () => {
  it('US-201: $12,000 + $9,500 + $1,200 totals $22,700.00', () => {
    const plan = createDefaultPlan();
    plan.schoolYears[0].costItems = [cost('a', '12000'), cost('b', '9500'), cost('c', '1200')];
    expect(project(plan).years[0].costs).toBe('22700.00');
  });

  it('US-202: copying $20,000 forward at 3% creates items × 1.03 totaling $20,600.00', () => {
    const plan = createDefaultPlan();
    plan.schoolYears[0].costItems = [cost('t', '12000'), cost('h', '8000')];
    const copied = copyYearCosts(plan, 'year-1', 'year-2', '3');
    expect(copied.schoolYears[1].costItems.map(item => item.amount)).toEqual(['12360.00', '8240.00']);
    expect(project(copied).years[1].costs).toBe('20600.00');
    expect(plan.schoolYears[1].costItems).toHaveLength(0);
    expect(copyYearCosts(plan, 'year-1', 'year-1', '3')).toBe(plan);
    expect(copyYearCosts(plan, 'year-1', 'missing', '3')).toBe(plan);
    expect(copyYearCosts(plan, 'year-1', 'year-2', 'abc')).toBe(plan);
  });

  it('US-203: Fall $10,000 + Spring $10,500 totals $20,500.00', () => {
    const plan = createDefaultPlan();
    plan.schoolYears[0].costItems = [cost('fall', '10000', 'fall'), cost('spring', '10500', 'spring')];
    expect(project(plan).years[0].costs).toBe('20500.00');
  });

  it('US-301/303: a $4,000 grant and $2,000 savings raise resources and lower the gap, never below $0', () => {
    const plan = createDefaultPlan();
    plan.schoolYears[0].costItems = [cost('t', '10000')];
    const before = project(plan).years[0];
    plan.schoolYears[0].resources = [resource('g', '4000'), resource('s', '2000', { type: 'savings' })];
    const after = project(plan).years[0];
    expect(new D(after.resources).minus(before.resources).toFixed(2)).toBe('6000.00');
    expect(after.gap).toBe('4000.00');
    plan.schoolYears[0].resources.push(resource('big', '9000'));
    expect(project(plan).years[0]).toMatchObject({ gap: '0.00', surplus: '5000.00' });
  });

  it('US-302: $15 × 15 h × 30 weeks = $6,750.00; fixed amounts; unavailable share excluded', () => {
    const plan = createDefaultPlan();
    const job = resource('j', '0', { type: 'job', incomeMode: 'hourly', hourlyWage: '15.00', hoursPerWeek: '15', weeksWorked: '30' });
    plan.schoolYears[0].resources = [job];
    expect(project(plan).years[0].resources).toBe('6750.00');
    plan.schoolYears[0].resources = [{ ...job, incomeMode: 'fixed', amount: '5000' }];
    expect(project(plan).years[0].resources).toBe('5000.00');
    plan.schoolYears[0].resources = [{ ...job, unavailablePercent: '40' }];
    expect(project(plan).years[0].resources).toBe('4050.00');
  });

  it('US-304/305: $22,700 − $12,750 = $9,950.00 gap; 5% buffer → $10,447.50', () => {
    const plan = createDefaultPlan();
    plan.schoolYears[0].costItems = [cost('t', '22700')];
    plan.schoolYears[0].resources = [resource('g', '6000'), resource('j', '0', { type: 'job', incomeMode: 'hourly', hourlyWage: '15', hoursPerWeek: '15', weeksWorked: '30' })];
    plan.schoolYears[0].bufferPercent = '5';
    expect(project(plan).years[0]).toMatchObject({ costs: '22700.00', resources: '12750.00', gap: '9950.00', surplus: '0.00', bufferedGap: '10447.50' });
  });

  it('US-704: a $1,500 grant added to Year 3 lowers the Year 3 gap by $1,500.00; expenses raise it', () => {
    const plan = createDefaultPlan();
    plan.schoolYears[2].costItems = [cost('t', '20000')];
    plan.schoolYears[2].resources = [resource('g', '5000')];
    expect(project(plan).years[2].gap).toBe('15000.00');
    plan.lifeEvents = [event('grant', 'aid', '2026-01-01', '1500', { schoolYearId: 'year-3' })];
    const withGrant = project(plan);
    expect(withGrant.years[2].gap).toBe('13500.00');
    expect(withGrant.years[0].gap).toBe('0.00');
    // Without an explicit year, the date decides; a dangling schoolYearId also falls back to the date.
    plan.lifeEvents = [event('repair', 'expense', '2028-09-01', '700', { schoolYearId: 'removed-year' })];
    expect(project(plan).years[2].gap).toBe('15700.00');
  });
});

// ------------------------------------------------------------------ US-402 loans from the gap
describe('US-402 create loan from gap', () => {
  function planWithGap(): PlannerPlan {
    const plan = createDefaultPlan();
    plan.schoolYears[1].costItems = [cost('t', '22700')];
    plan.schoolYears[1].resources = [resource('g', '12750')];
    return plan;
  }
  it('pre-fills the gap + buffer, the year start date, year id and gap at creation', () => {
    const plan = planWithGap();
    expect(createLoanFromGap(plan, 'year-2', 'new')).toMatchObject({
      id: 'new', principal: '9950.00', disbursementDate: plan.schoolYears[1].startDate, schoolYearId: 'year-2', gapAtCreation: '9950.00', termMonths: 120,
    });
    plan.schoolYears[1].bufferPercent = '5';
    expect(createLoanFromGap(plan, 'year-2', 'new').principal).toBe('10447.50');
  });
  it('never changes the loan when the gap later changes, and flags the mismatch', () => {
    const plan = planWithGap();
    plan.loans = [createLoanFromGap(plan, 'year-2', 'gap-loan')];
    expect(project(plan).years[1]).toMatchObject({ borrowed: '9950.00', mismatchLoanIds: [] });
    plan.schoolYears[1].costItems.push(cost('books', '300'));
    const changed = project(plan).years[1];
    expect(changed.mismatchLoanIds).toEqual(['gap-loan']);
    expect(plan.loans[0].principal).toBe('9950.00');
    expect(loanYearIndex(plan, plan.loans[0])).toBe(1);
  });
  it('falls back to an empty loan for an unknown year or incomplete inputs', () => {
    const plan = planWithGap();
    const unknown = createLoanFromGap(plan, 'nope', 'x');
    expect(unknown).toMatchObject({ principal: '0.00', disbursementDate: plan.settings.startDate });
    expect(unknown.schoolYearId).toBeUndefined();
    plan.schoolYears[1].costItems[0].amount = '';
    expect(createLoanFromGap(plan, 'year-2', 'x')).toMatchObject({ principal: '0.00', gapAtCreation: '0.00' });
  });
});

// ------------------------------------------------------------------ Epics 4–5 at plan level
describe('repayment projection', () => {
  it('US-403/404: $5,000 at 6% accrues $300.00 over a 365-day year and repays from $5,300.00', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('a', '5000', '0.06', { disbursementDate: '2029-11-20' })];
    expect(project(plan).repayment.loans[0]).toMatchObject({ accruedInterest: '300.00', capitalizedInterest: '300.00', balanceAtRepaymentStart: '5300.00' });
  });

  it('US-403: across a leap day, days/365 gives $300.82 for 12 calendar months (documented, not forced)', () => {
    const plan = createDefaultPlan();
    plan.settings.graduationDate = '2028-05-20';
    const leap = reconcileSchoolYears(plan);
    leap.loans = [loan('a', '5000', '0.06', { disbursementDate: '2027-11-20' })];
    // 2027-11-20 → 2028-11-20 is 366 days: 5000 × 0.06 × 366 / 365 = 300.8219… → 300.82.
    expect(project(leap).repayment.loans[0].accruedInterest).toBe('300.82');
  });

  it('US-403/404: subsidized accrues $0.00; paying interest in school shows monthly payments and capitalizes nothing', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('s', '5000', '0.06', { type: 'subsidized', disbursementDate: '2029-11-20' })];
    expect(project(plan).repayment.loans[0].accruedInterest).toBe('0.00');
    plan.loans = [loan('u', '5000', '0.06', { disbursementDate: '2029-11-20', payInterestWhileInSchool: true })];
    const repayment = project(plan).repayment;
    expect(repayment.inSchoolInterestPayments).toHaveLength(12);
    expect(repayment.loans[0]).toMatchObject({ capitalizedInterest: '0.00', balanceAtRepaymentStart: '5000.00' });
    expect(sum(repayment.inSchoolInterestPayments.map(row => row.amount)).toFixed(2)).toBe(repayment.loans[0].inSchoolInterestPaid);
  });

  it('keeps non-capitalized school interest separate and still collects it', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('a', '10000', '0.06', { disbursementDate: '2029-11-20', capitalizeInterest: false })];
    const repayment = project(plan).repayment;
    expect(repayment.loans[0].capitalizedInterest).toBe('0.00');
    expect(new D(repayment.totalInterestPaid!).gte('600')).toBe(true);
    expect(new D(repayment.totalRepaymentPayments).minus('10000').eq(repayment.totalInterestPaid!)).toBe(true);
  });

  it('US-501: a budget below the minimums reports the shortfall and allocates proportionally', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('a', '10000', '0.06'), loan('b', '5000', '0.06')];
    plan.postGradIncome.monthlyDebtBudget = '100.00';
    const result = project(plan);
    expect(result.minimumTotal).toBe('166.53');
    expect(result.paymentShortfall).toBe('66.53');
    expect(result.repayment.amortizationSchedule[0].payment).toBe('100.00');
    plan.postGradIncome.monthlyDebtBudget = '200.00';
    expect(project(plan).paymentShortfall).toBe('0.00');
  });

  it('US-505: a payment below one month of interest warns and projects no debt-free date', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('a', '30000', '0.065')];
    plan.postGradIncome.monthlyDebtBudget = '150.00'; // interest is $162.50
    const repayment = project(plan).repayment;
    expect(repayment.status).toBe('notAmortizing');
    expect(repayment.warnings[0].code).toBe('NEGATIVE_AMORTIZATION');
    expect(repayment.debtFreeDate).toBeNull();
    expect(repayment.totalInterestPaid).toBeNull();
  });

  it('zero-interest loans pay off exactly; horizon exceeded leaves no debt-free date', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('a', '1200', '0')];
    plan.postGradIncome.monthlyDebtBudget = '100';
    const paid = project(plan).repayment;
    expect(paid.amortizationSchedule).toHaveLength(12);
    expect(paid.totalInterestPaid).toBe('0.00');
    // v4: the cap is the internal 1200-month limit; $0.50/month needs 2,400 months.
    plan.postGradIncome.monthlyDebtBudget = '0.50';
    const capped = project(plan).repayment;
    expect(capped.status).toBe('horizonExceeded');
    expect(capped.debtFreeDate).toBeNull();
  });

  it('month-end and leap-year payment dates clamp without drifting', () => {
    const plan = createDefaultPlan();
    plan.settings = { ...plan.settings, startDate: '2028-01-31', graduationDate: '2032-01-31' };
    plan.repayment.voluntaryStart = { kind: 'afterGraduation', months: 0 };
    const leap = reconcileSchoolYears(plan);
    leap.loans = [loan('a', '1200', '0', { disbursementDate: '2032-01-31' })];
    leap.postGradIncome.monthlyDebtBudget = '100';
    const dates = project(leap).repayment.amortizationSchedule.map(row => row.date);
    expect(dates.slice(0, 3)).toEqual(['2032-02-29', '2032-03-31', '2032-04-30']);
    expect(leap.schoolYears.map(year => year.startDate)).toEqual(['2028-01-31', '2029-01-31', '2030-01-31', '2031-01-31']);
  });
});

// ------------------------------------------------------------------ Epic 7 life events
describe('life events', () => {
  it('US-702: a raise from $55,000 to $65,000 on 2031-01-01 at 60% raises payments by $500 from that month', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan()];
    plan.lifeEvents = [event('raise', 'income', '2031-01-01', '65000', { allocationPercent: '60' })];
    const result = project(plan);
    expect(rowFor(result, '2030-12')?.payment).toBe('400.00');
    expect(rowFor(result, '2031-01')?.payment).toBe('900.00');
    expect(rowFor(result, '2031-02')?.payment).toBe('900.00');
  });

  it('"job ends" (amount 0) reduces the budget but never below $0; a later job restores it', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('a', '50000', '0.06')];
    plan.postGradIncome.monthlyDebtBudget = '600.00';
    plan.lifeEvents = [event('cut', 'income', '2031-03-01', '0', { allocationPercent: '5' })];
    // 600 − 55,000 / 12 × 5% = 600 − 229.1666… = 370.83
    expect(rowFor(project(plan), '2031-03')?.payment).toBe('370.83');
    plan.lifeEvents = [event('lost', 'income', '2031-03-01', '0')];
    const lost = project(plan).repayment;
    expect(lost.status).toBe('notAmortizing');
    expect(lost.debtFreeDate).toBeNull();
    expect(lost.amortizationSchedule.at(-1)?.payment).toBe('0.00');
    // A temporary gap warns but keeps projecting, because the budget recovers later.
    plan.lifeEvents = [event('lost', 'income', '2031-03-01', '0'), event('hired', 'income', '2031-06-01', '60000')];
    const result = project(plan);
    expect(result.repayment.status).toBe('paidOff');
    expect(rowFor(result, '2031-03')?.payment).toBe('0.00');
    expect(rowFor(result, '2031-06')?.payment).toBe('1016.67');
    expect(result.repayment.warnings).toEqual([expect.objectContaining({ code: 'NEGATIVE_AMORTIZATION', date: '2031-03-20' })]);
    expect(result.repayment.amortizationSchedule.every(row => new D(row.payment).gte(0))).toBe(true);
    plan.lifeEvents = [event('lost', 'income', '2031-03-01', '0'), event('hired', 'income', '2031-03-15', '60000')];
    // −4,583.33 then +5,000 in the same month: 600 − 4583.333… + 5000 = 1016.67
    expect(rowFor(project(plan), '2031-03')?.payment).toBe('1016.67');
  });

  function postGradPlan(): PlannerPlan {
    const plan = createDefaultPlan();
    plan.settings = { ...plan.settings, startDate: '2024-08-26', graduationDate: '2028-05-15' };
    const reconciled = reconcileSchoolYears(plan); // repayment starts 2028-11-15; payments on the 15th
    reconciled.loans = [loan('high', '8000', '0.08', { disbursementDate: '2027-08-26' }), loan('low', '6000', '0.04', { disbursementDate: '2027-08-26' })];
    reconciled.postGradIncome.monthlyDebtBudget = '600.00';
    return reconciled;
  }

  it('US-703: a $3,000 June 2029 bonus is applied that month to the active strategy target', () => {
    const plan = postGradPlan();
    plan.lifeEvents = [event('bonus', 'windfall', '2029-06-01', '3000')];
    const result = project(plan);
    const june = rowFor(result, '2029-06')!;
    expect(june.payment).toBe('3600.00');
    const minimumLow = result.repayment.loans.find(item => item.loanId === 'low')!.minimumMonthlyPayment;
    expect(june.loans.find(row => row.loanId === 'low')!.payment).toBe(minimumLow);
    plan.repayment.strategyId = 'snowball';
    const snowballJune = rowFor(project(plan), '2029-06')!;
    expect(new D(snowballJune.loans.find(row => row.loanId === 'low')!.payment).gt(minimumLow)).toBe(true);
  });

  it('US-703: impact = months moved and interest saved versus the plan without the event', () => {
    const plan = postGradPlan();
    plan.lifeEvents = [event('bonus', 'windfall', '2029-06-01', '3000')];
    const withEvent = project(plan).repayment;
    const without = project({ ...plan, lifeEvents: [] }).repayment;
    const [impact] = compare(plan).eventImpacts;
    expect(impact.eventId).toBe('bonus');
    expect(impact.monthsSaved).toBe(without.amortizationSchedule.length - withEvent.amortizationSchedule.length);
    expect(impact.monthsSaved).toBeGreaterThan(0);
    expect(impact.interestSaved).toBe(new D(without.totalInterestPaid!).minus(withEvent.totalInterestPaid!).toFixed(2));
    expect(new D(impact.interestSaved!).gt(0)).toBe(true);
  });

  it('applies the allocation share and holds pre-repayment windfalls for month 1 (documented assumption)', () => {
    const plan = postGradPlan();
    plan.lifeEvents = [event('gift', 'windfall', '2026-12-25', '1000', { allocationPercent: '50' })];
    const result = project(plan);
    expect(result.repayment.amortizationSchedule[0].payment).toBe('1100.00');
    expect(result.notices.some(notice => notice.includes('applied in the first repayment month'))).toBe(true);
    // Between repayment start (Nov 15) and the first payment (Dec 15), an earlier calendar month → month 1.
    plan.lifeEvents = [event('gift', 'windfall', '2028-11-20', '1000')];
    expect(project(plan).repayment.amortizationSchedule[0].payment).toBe('1600.00');
  });

  it('yearly windfalls repeat on each anniversary until the recurrence end date', () => {
    const plan = postGradPlan();
    plan.loans = [loan('big', '60000', '0.06', { disbursementDate: '2027-08-26' })];
    plan.postGradIncome.monthlyDebtBudget = '700.00';
    plan.lifeEvents = [event('refund', 'windfall', '2029-04-10', '500', { recurrence: 'yearly', recurrenceEndDate: '2031-04-10' })];
    const result = project(plan);
    expect(['2029-03', '2029-04', '2030-04', '2031-04', '2032-04'].map(month => rowFor(result, month)?.payment)).toEqual(['700.00', '1200.00', '1200.00', '1200.00', '700.00']);
    expect(result.timeline.find(entry => entry.id === 'refund')?.label).toBe('refund (yearly)');
    plan.lifeEvents = [event('refund', 'windfall', '2029-04-10', '500', { recurrence: 'yearly' })];
    expect(rowFor(project(plan), '2035-04')?.payment).toBe('1200.00');
  });
});

// ------------------------------------------------------------------ comparisons (US-604, US-802)
describe('comparisons', () => {
  it('US-604/605: compares every user-facing registry strategy with neutral names and differences', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('large', '10000', '0.1'), loan('small', '1000', '0.02')];
    plan.postGradIncome.monthlyDebtBudget = '500';
    plan.repayment.customOrder = ['small', 'large'];
    const { strategyComparisons } = compare(plan);
    expect(strategyComparisons.map(item => item.id)).toEqual(['avalanche', 'snowball', 'custom']);
    expect(strategyComparisons.map(item => item.name)).toEqual(['Avalanche (highest rate first)', 'Snowball (smallest balance first)', 'Custom order (your ranking)']);
    expect(JSON.stringify(strategyComparisons.map(item => item.name)).toLowerCase()).not.toContain('best');
    const avalanche = strategyComparisons[0];
    expect(avalanche.interestDifference).toBe('0.00');
    expect(avalanche.monthsDifference).toBe(0);
    for (const item of strategyComparisons) {
      expect(new D(item.interestDifference!).gte(0)).toBe(true);
      expect(item.firstPayoffMonth).toBeGreaterThan(0);
    }
    expect(strategyComparisons[1].firstPayoffMonth).toBeLessThan(avalanche.firstPayoffMonth!);
  });

  it('US-801/802: scenarios inherit base edits, compare to the base, and give a date range', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan()];
    plan.scenarios = [{ id: 'more', name: 'More', overrides: { 'postGradIncome.monthlyDebtBudget': '500', 'loans.missing.principal': '1' } }];
    const scenario = applyScenario(plan, plan.scenarios[0]);
    expect(scenario.postGradIncome.monthlyDebtBudget).toBe('500');
    plan.postGradIncome.annualSalary = '70000.00';
    expect(applyScenario(plan, plan.scenarios[0]).postGradIncome.annualSalary).toBe('70000.00');
    const result = compare(plan);
    const base = project(plan).repayment;
    const [more] = result.scenarioComparisons;
    expect(more.monthsDifference).toBeLessThan(0);
    expect(more.interestDifference).toBe(new D(more.projection.totalInterestPaid!).minus(base.totalInterestPaid!).toFixed(2));
    expect(result.scenarioRange).toEqual({ earliest: more.projection.debtFreeDate, latest: base.debtFreeDate });
    plan.scenarios.push({ id: 'none', name: 'No budget', overrides: { 'postGradIncome.monthlyDebtBudget': '0.00' } });
    expect(compare(plan).scenarioRange).toEqual({ earliest: more.projection.debtFreeDate, latest: null });
    plan.scenarios.push({ id: 'bad', name: 'Invalid', overrides: { 'postGradIncome.monthlyDebtBudget': 'x' } });
    expect(compare(plan).scenarioComparisons.map(item => item.id)).toEqual(['more', 'none']);
  });

  it('builds a date-ordered timeline with school years, milestones, events and payoffs', () => {
    const plan = createDefaultPlan();
    plan.loans = [loan('a', '1000', '0.05'), loan('b', '2000', '0.04')];
    plan.lifeEvents = [event('bonus', 'windfall', '2031-06-01', '100')];
    const { timeline } = project(plan);
    const dates = timeline.map(entry => entry.date);
    expect([...dates].sort()).toEqual(dates);
    expect(timeline.map(entry => entry.type)).toEqual(expect.arrayContaining(['school', 'graduation', 'repayment', 'event', 'payoff']));
    expect(timeline.at(-1)?.id).toBe('debt-free');
    expect(timeline.filter(entry => entry.id.startsWith('payoff-'))).toHaveLength(2);
  });

  it('labels federal mode and rejects invalid planner fields without throwing', () => {
    const plan = createDefaultPlan();
    plan.repayment.mode = 'federal';
    expect(project(plan).notices.some(notice => notice.includes('standard repayment model'))).toBe(true);
    for (const mutate of [
      (p: PlannerPlan) => { p.postGradIncome.monthlyDebtBudget = ''; },
      (p: PlannerPlan) => { p.schoolYears[0].bufferPercent = '101'; },
      (p: PlannerPlan) => { p.lifeEvents = [event('e', 'windfall', '2031-02-30', '1')]; },
      (p: PlannerPlan) => { p.lifeEvents = [event('e', 'windfall', '2031-02-01', '1', { recurrence: 'yearly', recurrenceEndDate: 'never' })]; },
      (p: PlannerPlan) => { p.schoolYears[0].resources = [resource('r', '1', { hoursPerWeek: '-1' })]; },
    ]) {
      const bad = createDefaultPlan();
      mutate(bad);
      expect(calculatePlannerProjection(bad).ok).toBe(false);
      expect(calculatePlannerComparisons(bad).ok).toBe(false);
    }
    const broken = { ...createDefaultPlan(), lifeEvents: null } as unknown as PlannerPlan;
    expect(calculatePlannerProjection(broken)).toMatchObject({ ok: false });
    expect(calculatePlannerComparisons(broken)).toMatchObject({ ok: false });
  });
});

// ------------------------------------------------------------------ NFR-3 property tests
describe('NFR-3 invariants (fast-check)', () => {
  const loanArbitrary = fc.record({
    principalCents: fc.integer({ min: 1, max: 5_000_000 }),
    rateBasisPoints: fc.integer({ min: 0, max: 3000 }),
    term: fc.integer({ min: 1, max: 240 }),
    subsidized: fc.boolean(),
  });
  const strategies = fc.constantFrom('avalanche', 'snowball', 'custom') as fc.Arbitrary<PlannerPlan['repayment']['strategyId']>;

  it('balances never go negative, principal paid equals the starting balance, more budget never means more months', () => {
    fc.assert(fc.property(fc.array(loanArbitrary, { minLength: 1, maxLength: 4 }), fc.integer({ min: 0, max: 400_000 }), strategies, (loans, budgetCents, strategyId) => {
      const plan = createDefaultPlan();
      plan.repayment.strategyId = strategyId;
      plan.loans = loans.map((item, i) => loan(`l${i}`, new D(item.principalCents).div(100).toFixed(2), new D(item.rateBasisPoints).div(10000).toString(), {
        termMonths: item.term, type: item.subsidized ? 'subsidized' : 'unsubsidized', disbursementDate: '2029-01-15',
      }));
      plan.repayment.customOrder = plan.loans.map(item => item.id).reverse();
      plan.postGradIncome.monthlyDebtBudget = new D(budgetCents).div(100).toFixed(2);
      const before = JSON.stringify(plan);
      const first = project(plan).repayment;
      expect(JSON.stringify(plan)).toBe(before);
      for (const row of first.amortizationSchedule) {
        expect(new D(row.remainingBalance).gte(0)).toBe(true);
        for (const loanRow of row.loans) expect(new D(loanRow.remainingBalance).gte(0)).toBe(true);
      }
      if (first.status !== 'paidOff') return;
      for (const start of first.loans) {
        const rows = first.amortizationSchedule.flatMap(row => row.loans.filter(item => item.loanId === start.loanId));
        expect(sum(rows.map(row => row.principal)).toFixed(2)).toBe(start.balanceAtRepaymentStart);
      }
      plan.postGradIncome.monthlyDebtBudget = new D(budgetCents).plus(5000).div(100).toFixed(2);
      const second = project(plan).repayment;
      expect(second.status).toBe('paidOff');
      expect(second.amortizationSchedule.length).toBeLessThanOrEqual(first.amortizationSchedule.length);
    }), { numRuns: 150 });
  });
});
