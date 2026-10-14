import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { Plan, Projection } from './contracts';
import { calculateProjection } from './projection';
import { D, sum } from './money';
import { addMonths, validDate, daysBetween } from './dates';
import { getStrategy } from './strategies/registry';
import { standardSchedule } from './fixtures/standard';

function plan(): Plan {
  return { settings: { startDate: '2025-01-01', graduationDate: '2026-01-01', graceMonths: 0, currency: 'USD' }, schoolYears: [], loans: [{ id: 'a', name: 'Loan', type: 'unsubsidized', principal: '5000', annualRate: '0.06', disbursementDate: '2025-01-01', termMonths: 120 }], repayment: { strategyId: 'input-order', extraMonthlyPayment: '0' } };
}
function project(p: Plan): Projection {
  const result = calculateProjection(p);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}
describe('M1 reference calculations', () => {
  it('accrues actual/365 and capitalizes once', () => {
    const p = project(plan());
    expect(p.loans[0]).toMatchObject({ accruedInterest: '300.00', capitalizedInterest: '300.00', balanceAtRepaymentStart: '5300.00' });
    expect(p.firstPaymentDate).toBe('2026-02-01');
    expect(p.amortizationSchedule.at(-1)?.remainingBalance).toBe('0.00');
    expect(sum(p.amortizationSchedule.map(row => row.principal)).toFixed(2)).toBe('5300.00');
    expect(p.totalInterestPaid).toBe(sum(p.amortizationSchedule.map(row => row.interest)).plus(300).toFixed(2));
  });
  it('matches the reference $30,000 loan payment and complete golden first rows', () => {
    const p = plan(); Object.assign(p.loans[0], { type: 'subsidized', principal: '30000', annualRate: '0.065', monthlyPayment: '340.64' });
    const result = project(p);
    expect(result.loans[0].minimumMonthlyPayment).toBe('340.64');
    expect(result.amortizationSchedule).toHaveLength(120);
    expect(result.amortizationSchedule.map(row => [row.payment, row.interest, row.principal, row.remainingBalance])).toEqual(standardSchedule);
    expect(result.amortizationSchedule.slice(0, 3).map(row => [row.payment, row.interest, row.principal, row.remainingBalance])).toEqual([
      ['340.64', '162.50', '178.14', '29821.86'], ['340.64', '161.54', '179.10', '29642.76'], ['340.64', '160.56', '180.08', '29462.68'],
    ]);
    expect(new D(result.totalInterestPaid!).minus('10877.41').abs().lte(1)).toBe(true);
  });
  it('shows monthly in-school interest payments and no capitalization', () => {
    const p = plan(); p.loans[0].payInterestWhileInSchool = true;
    const result = project(p);
    expect(result.inSchoolInterestPayments).toHaveLength(12);
    expect(result.inSchoolInterestPayments[0]).toEqual({ loanId: 'a', periodStart: '2025-01-01', date: '2025-02-01', amount: '25.48' });
    expect(result.loans[0].capitalizedInterest).toBe('0.00');
    expect(result.loans[0].inSchoolInterestPaid).toBe(sum(result.inSchoolInterestPayments.map(row => row.amount)).toFixed(2));
  });
  it('respects subsidized and private accrual overrides and zero-rate payments', () => {
    const p = plan(); p.loans[0].type = 'private'; p.loans[0].accruesInterestInSchool = false;
    expect(project(p).loans[0].accruedInterest).toBe('0.00');
    p.loans[0].type = 'subsidized'; p.loans[0].accruesInterestInSchool = true;
    expect(project(p).loans[0].accruedInterest).toBe('0.00');
    p.loans[0].annualRate = '0'; p.loans[0].principal = '120';
    expect(project(p).loans[0].minimumMonthlyPayment).toBe('1.00');
    p.loans[0].principal = '0'; expect(project(p).debtFreeDate).toBe('2026-01-01');
    p.loans = []; expect(project(p).totalInterestPaid).toBe('0.00');
  });
  it('handles partial monthly periods and leap days', () => {
    const p = plan(); p.settings.graduationDate = '2025-02-15'; p.loans[0].payInterestWhileInSchool = true;
    expect(project(p).inSchoolInterestPayments.at(-1)?.date).toBe('2025-02-15');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2024-01-31', 2)).toBe('2024-03-31');
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
    expect(validDate('0001-01-01')).toBe(true);
    expect(validDate('2025-02-29')).toBe(false);
  });
  it.each([['0', 'NEGATIVE_AMORTIZATION'], ['25', 'NON_AMORTIZING']])('does not invent a payoff for payment %s', (payment, code) => {
    const p = plan(); p.loans[0].type = 'subsidized'; p.loans[0].monthlyPayment = payment;
    const result = project(p);
    expect(result.status).toBe('notAmortizing'); expect(result.warnings[0].code).toBe(code);
    expect(result.debtFreeDate).toBeNull(); expect(result.totalInterestPaid).toBeNull();
  });
  it('keeps material rounding residuals on the schedule instead of creating a balloon payment', () => {
    const p = plan();
    Object.assign(p.loans[0], { type: 'subsidized', principal: '1000', annualRate: '0.10', termMonths: 600, monthlyPayment: '8.38' });
    p.repayment.maxMonths = 1200;
    const result = project(p);
    expect(result.loans[0].minimumMonthlyPayment).toBe('8.39');
    expect(result.amortizationSchedule.length).toBeGreaterThan(600);
    expect(result.amortizationSchedule[599].payment).toBe('8.38');
    expect(new D(result.amortizationSchedule[599].remainingBalance).gt('1.00')).toBe(true);
    expect(result.status).toBe('paidOff');
    expect(sum(result.amortizationSchedule.map(row => row.principal)).eq('1000')).toBe(true);
    p.repayment.extraMonthlyPayment = '1';
    expect(project(p).amortizationSchedule.length).toBeLessThan(result.amortizationSchedule.length);
  });
  it('enforces the horizon and rolls freed minimums forward', () => {
    const p = plan(); p.repayment.maxMonths = 1;
    expect(project(p).status).toBe('horizonExceeded');
    p.repayment.maxMonths = 600; p.loans[0] = { ...p.loans[0], type: 'subsidized', principal: '10', annualRate: '0', monthlyPayment: '10' };
    p.loans.push({ ...p.loans[0], id: 'b', principal: '100' });
    const result = project(p);
    expect(result.amortizationSchedule[1].loans[0].payment).toBe('20.00');
    expect(result.amortizationSchedule).toHaveLength(6);
    for (const loan of p.loans) {
      const rows = result.amortizationSchedule.flatMap(month => month.loans.filter(row => row.loanId === loan.id));
      expect(sum(rows.map(row => row.principal)).eq(loan.principal)).toBe(true);
      expect(sum(rows.map(row => row.payment)).eq(sum(rows.map(row => row.principal)).plus(sum(rows.map(row => row.interest))))).toBe(true);
      expect(rows.at(-1)?.remainingBalance).toBe('0.00');
    }
    for (const month of result.amortizationSchedule) {
      expect(sum(month.loans.map(row => row.payment)).toFixed(2)).toBe(month.payment);
      expect(sum(month.loans.map(row => row.remainingBalance)).toFixed(2)).toBe(month.remainingBalance);
    }
  });
});
describe('validation and strategy boundary', () => {
  it.each([
    ['settings.startDate', 'bad'], ['settings.graduationDate', '2020-01-01'], ['settings.graceMonths', 13], ['settings.currency', 'EUR'],
    ['repayment.extraMonthlyPayment', '-1'], ['repayment.maxMonths', 0], ['repayment.strategyId', 'unknown'],
    ['loans.0.id', ''], ['loans.0.name', ''], ['loans.0.type', 'bad'], ['loans.0.principal', '1.001'], ['loans.0.annualRate', '0.31'], ['loans.0.annualRate', 'NaN'], ['loans.0.disbursementDate', 'bad'], ['loans.0.disbursementDate', '2027-01-01'], ['loans.0.termMonths', 0], ['loans.0.monthlyPayment', 'Infinity'], ['loans.0.payInterestWhileInSchool', 'true'], ['loans.0.accruesInterestInSchool', 1],
  ])('rejects invalid %s', (path, value) => {
    const p = plan(); const keys = path.split('.'); let target: any = p;
    for (const key of keys.slice(0, -1)) target = target[key]; target[keys.at(-1)!] = value;
    const result = calculateProjection(p); expect(result.ok).toBe(false);
    // Loan errors use the record id (contract), falling back to the index only when the id is unusable.
    const expected = path === 'loans.0.id' ? path : path.replace(/^loans\.0\./, 'loans.a.');
    if (!result.ok) expect(result.errors.some(error => error.path === expected)).toBe(true);
    if (!result.ok && path.startsWith('loans.')) expect(result.errors.every(error => error.message.startsWith(path === 'loans.0.name' ? 'Loan 1:' : 'Loan "Loan":'))).toBe(true);
  });
  it('reports a disbursement after repayment start by loan id and loan name', () => {
    const p = plan(); p.loans.push({ ...p.loans[0], id: 'late', name: 'Summer loan', disbursementDate: '2026-03-01' });
    const result = calculateProjection(p);
    expect(result).toEqual({ ok: false, errors: [{ path: 'loans.late.disbursementDate', code: 'OUT_OF_RANGE', message: 'Loan "Summer loan": disbursement (2026-03-01) must be on or before repayment starts (2026-01-01).' }] });
  });
  it('handles malformed top-level values and duplicate IDs', () => {
    expect(calculateProjection(undefined as unknown as Plan).ok).toBe(false);
    const p = plan(); p.loans.push({ ...p.loans[0] }); expect(calculateProjection(p).ok).toBe(false);
    p.loans = [null as any]; expect(calculateProjection(p).ok).toBe(false);
    p.loans = null as any; expect(calculateProjection(p).ok).toBe(false);
    p.loans = []; p.settings.graduationDate = '9999-12-31'; expect(calculateProjection(p).ok).toBe(false);
  });
  it('rejects an invalid strategy result', () => {
    const strategy = getStrategy('input-order')!;
    const mock = vi.spyOn(strategy, 'orderLoans').mockReturnValue([]);
    expect(calculateProjection(plan()).ok).toBe(false); mock.mockRestore();
  });
  it('guards strategy exceptions, mutations and malformed output', () => {
    const strategy = getStrategy('input-order')!;
    for (const callback of [() => { throw Error('bad'); }, () => null, () => [null], (loans: any) => { loans[0].id = 'bad'; return loans; }]) {
      const mock = vi.spyOn(strategy, 'orderLoans').mockImplementation(callback as any);
      const result = calculateProjection(plan()); expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0].code).toBe('INVALID_STRATEGY');
      mock.mockRestore();
    }
  });
  it('bounds money and rate precision and does not silently pay zero underpayments', () => {
    const p = plan(); p.loans[0].principal = '1' + '0'.repeat(40); expect(calculateProjection(p).ok).toBe(false);
    p.loans[0].principal = '999999999999999999.99'; p.loans[0].type = 'subsidized'; p.loans[0].annualRate = '0'; p.loans[0].termMonths = 1;
    expect(project(p).amortizationSchedule[0].principal).toBe(p.loans[0].principal);
    p.loans[0].annualRate = '0.' + '0'.repeat(90) + '1'; expect(calculateProjection(p).ok).toBe(false);
    Object.assign(p.loans[0], { principal: '0.01', annualRate: '0', monthlyPayment: '0' });
    expect(project(p).status).toBe('notAmortizing');
  });
});
describe('money properties', () => {
  it('conserves principal, stays nonnegative, and more payment cannot extend payoff', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1000000 }), fc.integer({ min: 0, max: 3000 }), fc.integer({ min: 1, max: 240 }), (principalCents, rate, term) => {
      const p = plan(); Object.assign(p.loans[0], { type: 'subsidized', principal: new D(principalCents).div(100).toFixed(2), annualRate: new D(rate).div(10000).toString(), termMonths: term });
      const before = JSON.stringify(p); const a = project(p);
      expect(JSON.stringify(p)).toBe(before);
      if (a.status === 'paidOff') {
        expect(sum(a.amortizationSchedule.map(row => row.principal)).eq(p.loans[0].principal)).toBe(true);
        expect(a.amortizationSchedule.every(row => new D(row.remainingBalance).gte(0))).toBe(true);
        p.repayment.extraMonthlyPayment = '1'; const b = project(p);
        expect(b.amortizationSchedule.length).toBeLessThanOrEqual(a.amortizationSchedule.length);
      }
    }), { numRuns: 100 });
  });
});
