import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MAX_NUMBER_INPUT_LENGTH,
  formatCurrency,
  formatRatePercent,
  parseDateInput,
  parseIntegerInput,
  parseMoneyInput,
  parsePercentInput,
  parseQuantityInput,
  parseRatePercentInput,
  parseTextInput,
} from './parse';

const numberParsers: Array<[string, (text: string) => { ok: boolean }]> = [
  ['money', text => parseMoneyInput(text)],
  ['percent', text => parsePercentInput(text)],
  ['rate', text => parseRatePercentInput(text)],
  ['quantity', text => parseQuantityInput(text, { max: '168' })],
  ['integer', text => parseIntegerInput(text, { min: 0, max: 1200 })],
];

describe('typed formatting', () => {
  it('accepts thousands separators and a dollar sign', () => {
    expect(parseMoneyInput('22,700')).toEqual({ ok: true, value: '22700.00' });
    expect(parseMoneyInput('$1,000.50')).toEqual({ ok: true, value: '1000.50' });
    expect(parseMoneyInput('$ 1,234,567.8')).toEqual({ ok: true, value: '1234567.80' });
    expect(parseIntegerInput('1,200', { min: 0, max: 5000 })).toEqual({ ok: true, value: 1200 });
    expect(parsePercentInput('12.5%')).toEqual({ ok: true, value: '12.5' });
  });

  it.each(numberParsers)('%s: blank is never zero', (_name, parse) => {
    for (const blank of ['', ' ', '\t', '$', '%']) {
      const result = parse(blank);
      expect(result.ok, JSON.stringify(blank)).toBe(false);
    }
  });

  it.each(numberParsers)('%s: rejects exponents, NaN, Infinity, hex, binary, octal and signs', (_name, parse) => {
    for (const text of ['1e3', '1E3', '1e-2', 'NaN', 'nan', 'Infinity', '-Infinity', '∞', '0x10', '0X1f', '0b101', '0o17', '+5', '--5', '5-', '1_000', '١٢', '１２', '12 34']) {
      expect(parse(text).ok, text).toBe(false);
    }
  });

  it('rejects badly placed separators and excessive decimals', () => {
    for (const text of ['1,23', '12,34,567', ',100', '100,', '1,000,00', '1.005', '0.001', '1.2.3', '$$5', '5$']) {
      expect(parseMoneyInput(text).ok, text).toBe(false);
    }
    expect(parseIntegerInput('1,2,3', { min: 0, max: 1000 }).ok).toBe(false);
    expect(parsePercentInput('1.23456').ok).toBe(false);
    expect(parseRatePercentInput('6.12345').ok).toBe(false);
  });

  it('enforces upper bounds', () => {
    expect(parseMoneyInput('1,000,000,000.00')).toEqual({ ok: true, value: '1000000000.00' });
    expect(parseMoneyInput('1,000,000,000.01').ok).toBe(false);
    expect(parseRatePercentInput('30')).toEqual({ ok: true, value: '0.3' });
    expect(parseRatePercentInput('30.0001').ok).toBe(false);
    expect(parsePercentInput('100')).toEqual({ ok: true, value: '100' });
    expect(parseIntegerInput('99999999999999999999', { min: 0, max: 12 }).ok).toBe(false);
  });

  it('rejects over-long input before matching', () => {
    expect(parseMoneyInput('1'.repeat(MAX_NUMBER_INPUT_LENGTH + 1))).toEqual({ ok: false, message: 'That number is too long.' });
    expect(parseIntegerInput('1'.repeat(MAX_NUMBER_INPUT_LENGTH + 1), { min: 0, max: 1 }).ok).toBe(false);
    const started = performance.now();
    parseMoneyInput('1'.repeat(1_000_000) + 'x');
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('dates: real calendar days in 1900–2199 only', () => {
    expect(parseDateInput('2028-02-29')).toEqual({ ok: true, value: '2028-02-29' });
    expect(parseDateInput(' 2026-08-24 ')).toEqual({ ok: true, value: '2026-08-24' });
    for (const text of ['2027-02-29', '2026-02-30', '2026-00-10', '2026-1-1', '26-01-01', '2026/01/01', '1899-12-31', '2200-01-01', '0000-01-01']) {
      expect(parseDateInput(text).ok, text).toBe(false);
    }
    expect(parseDateInput('1899-12-31')).toEqual({ ok: false, message: 'Enter a date between 1900 and 2199.' });
    expect(parseDateInput('', { optional: true })).toEqual({ ok: true, value: undefined });
  });
});

describe('parsers never throw (NFR-11)', () => {
  const anyText = fc.oneof(
    fc.string({ unit: 'binary', maxLength: 80 }),
    fc.string({ unit: fc.constantFrom(...'0123456789.,$%-+eExX '.split('')), maxLength: 30 }),
  );

  it('for arbitrary strings, and successes are canonical', () => {
    fc.assert(fc.property(anyText, text => {
      const money = parseMoneyInput(text);
      if (money.ok) expect(money.value).toMatch(/^\d{1,10}\.\d{2}$/);
      const percent = parsePercentInput(text);
      if (percent.ok) expect(Number(percent.value)).toBeLessThanOrEqual(100);
      const rate = parseRatePercentInput(text);
      if (rate.ok) expect(Number(rate.value)).toBeLessThanOrEqual(0.3);
      const integer = parseIntegerInput(text, { min: 0, max: 12 });
      if (integer.ok) expect(Number.isInteger(integer.value)).toBe(true);
      parseQuantityInput(text, { max: '168' });
      parseDateInput(text);
      parseTextInput(text);
      formatCurrency(text);
      formatRatePercent(text);
    }), { numRuns: 2000 });
  });

  it('display helpers refuse huge exponents quickly but format tiny Decimal output', () => {
    const started = performance.now();
    for (const text of ['9e99999999', '1e-99999999', '-9E+999', '1e21']) {
      expect(formatCurrency(text), text).toBe('Not available');
      expect(formatRatePercent(text), text).toBe(text);
    }
    expect(performance.now() - started).toBeLessThan(200);
    expect(formatCurrency('1e-8')).toBe('$0.00');
    expect(formatCurrency('1234567.891')).toBe('$1,234,567.89');
  });

  it('for non-string values passed by mistake', () => {
    for (const value of [undefined, null, 5, {}, [], Symbol('x')]) {
      const text = value as unknown as string;
      expect(parseMoneyInput(text).ok).toBe(false);
      expect(parseIntegerInput(text, { min: 0, max: 1 }).ok).toBe(false);
      expect(parseDateInput(text).ok).toBe(false);
      expect(parseTextInput(text).ok).toBe(false);
    }
  });

  it('round-trips every valid cent amount', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100_000_000_000 }), cents => {
      const text = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
      expect(parseMoneyInput(text)).toEqual({ ok: true, value: text });
      expect(parseMoneyInput(formatCurrency(text))).toEqual({ ok: true, value: text });
    }));
  });
});
