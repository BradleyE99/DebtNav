/**
 * NFR-2 golden tests. Expected values come from an independent, float-free reference amortization
 * written here with exact BigInt rational arithmetic (not from engine output):
 *   payment  M = round½↑( P · r · (1+r)^n / ((1+r)^n − 1) ), r = annual rate / 12
 *   interest_k = round½↑( balance_{k−1} · r )   (SRS §8.6, §8.8)
 *   payment_k  = min(M, balance + interest); the final (n-th) payment absorbs the remainder (US-504).
 * The US-503 figure ($10,877.41 over 120 payments) was additionally reproduced with Python's
 * fractions.Fraction during review: 120 payments, final payment $341.25, total interest $10,877.41.
 */
import { describe, expect, it } from 'vitest';
import type { Plan, Projection } from './contracts';
import { calculateProjection } from './projection';
import { D, sum } from './money';

/** Parse '0.065' into [numerator, denominator] BigInts. */
function rational(text: string): [bigint, bigint] {
  const [whole, fraction = ''] = text.split('.');
  return [BigInt(whole + fraction), 10n ** BigInt(fraction.length)];
}
/** round half up of a nonnegative rational to an integer. */
const roundHalfUp = (numerator: bigint, denominator: bigint) => (2n * numerator + denominator) / (2n * denominator);
const centsText = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;

interface ReferenceRow { payment: string; interest: string; principal: string; balance: string }
function referenceSchedule(principal: string, annualRate: string, months: number): { payment: string; rows: ReferenceRow[] } {
  const principalCents = BigInt(principal.replace('.', '')) * (principal.includes('.') ? 1n : 100n);
  const [rateNumerator, rateDenominator] = rational(annualRate);
  const monthlyDenominator = rateDenominator * 12n; // r = rateNumerator / monthlyDenominator
  let payment: bigint;
  if (rateNumerator === 0n) {
    payment = roundHalfUp(principalCents, BigInt(months));
  } else {
    const growthNumerator = (monthlyDenominator + rateNumerator) ** BigInt(months);
    const growthDenominator = monthlyDenominator ** BigInt(months);
    payment = roundHalfUp(principalCents * rateNumerator * growthNumerator, monthlyDenominator * (growthNumerator - growthDenominator));
  }
  const rows: ReferenceRow[] = [];
  let balance = principalCents;
  for (let month = 1; balance > 0n; month++) {
    const interest = roundHalfUp(balance * rateNumerator, monthlyDenominator);
    const due = balance + interest;
    const paid = month >= months || payment > due ? due : payment;
    balance = due - paid;
    rows.push({ payment: centsText(paid), interest: centsText(interest), principal: centsText(paid - interest), balance: centsText(balance) });
  }
  return { payment: centsText(payment), rows };
}

function engineSchedule(principal: string, annualRate: string, termMonths: number): Projection {
  const plan: Plan = {
    settings: { startDate: '2025-01-01', graduationDate: '2025-01-01', graceMonths: 0, currency: 'USD' },
    schoolYears: [],
    loans: [{ id: 'a', name: 'Loan', type: 'subsidized', principal, annualRate, disbursementDate: '2025-01-01', termMonths }],
    repayment: { strategyId: 'input-order', extraMonthlyPayment: '0', maxMonths: 1200 },
  };
  const result = calculateProjection(plan);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

const cases: [string, string, number][] = [
  ['30000', '0.065', 120], // US-502/503 reference loan
  ['10000', '0.05', 60],
  ['25000', '0.0725', 240], // rounding residual of $2.20 absorbed by the final payment
  ['1000', '0.2999', 12],
  ['5300', '0.06', 120],
  ['5000', '0', 120], // zero interest: 41.67 × 119 + 41.27
  ['1000', '0', 120], // zero interest, payment rounds down: final payment 8.73
  ['57500', '0.0652', 300],
  ['0.01', '0.3', 1],
];

describe('NFR-2 golden amortization (independent reference)', () => {
  it.each(cases)('$%s at %s for %i months matches within $0.01 per payment', (principal, rate, months) => {
    const reference = referenceSchedule(principal, rate, months);
    const engine = engineSchedule(principal, rate, months);
    expect(engine.loans[0].minimumMonthlyPayment).toBe(reference.payment);
    expect(engine.amortizationSchedule).toHaveLength(reference.rows.length);
    engine.amortizationSchedule.forEach((row, index) => {
      const expected = reference.rows[index];
      for (const [actual, wanted] of [[row.payment, expected.payment], [row.interest, expected.interest], [row.principal, expected.principal], [row.remainingBalance, expected.balance]]) {
        expect(new D(actual).minus(wanted).abs().lte('0.01')).toBe(true);
      }
    });
    // US-504: final balance exactly zero and principal paid equals the starting balance to the cent.
    expect(engine.amortizationSchedule.at(-1)?.remainingBalance).toBe('0.00');
    expect(sum(engine.amortizationSchedule.map(row => row.principal)).toFixed(2)).toBe(new D(principal).toFixed(2));
  });

  it('US-502/503/504: $30,000 at 6.5% → $340.64 × 119 + $341.25, interest $10,877.41', () => {
    const projection = engineSchedule('30000', '0.065', 120);
    expect(projection.loans[0].minimumMonthlyPayment).toBe('340.64');
    expect(projection.amortizationSchedule).toHaveLength(120);
    expect(projection.amortizationSchedule.at(-1)?.payment).toBe('341.25');
    expect(projection.totalInterestPaid).toBe('10877.41');
    expect(new D(projection.totalInterestPaid!).minus('10877.41').abs().lte(1)).toBe(true);
  });

  it('the reference implementation itself reproduces the textbook payment formula', () => {
    // M = 30000 · 0.065/12 / (1 − (1 + 0.065/12)^−120) = 340.6449… → 340.64
    expect(referenceSchedule('30000', '0.065', 120).payment).toBe('340.64');
    expect(referenceSchedule('1200', '0', 12).payment).toBe('100.00');
  });
});
