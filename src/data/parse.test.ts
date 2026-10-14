import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatCurrency, formatRatePercent, parseDateInput, parseIntegerInput, parseMoneyInput, parsePercentInput, parseRatePercentInput, parseTextInput } from './parse';

describe('field parsers', () => {
  it('accepts common money formatting and canonicalizes to cents', () => {
    expect(parseMoneyInput('12000')).toEqual({ ok: true, value: '12000.00' });
    expect(parseMoneyInput(' $55,000 ')).toEqual({ ok: true, value: '55000.00' });
    expect(parseMoneyInput('1,250.5')).toEqual({ ok: true, value: '1250.50' });
    expect(parseMoneyInput('.75')).toEqual({ ok: true, value: '0.75' });
    expect(parseMoneyInput('12.')).toEqual({ ok: true, value: '12.00' });
  });

  it('never treats blank text as zero unless the field is optional', () => {
    expect(parseMoneyInput('')).toMatchObject({ ok: false });
    expect(parseMoneyInput('   ')).toMatchObject({ ok: false });
    expect(parseMoneyInput('', { optional: true })).toEqual({ ok: true, value: undefined });
    expect(parseIntegerInput('', { min: 0, max: 12 })).toMatchObject({ ok: false });
    expect(parseDateInput('')).toMatchObject({ ok: false });
  });

  it('rejects negative, non-numeric, over-precise and out-of-range values with messages', () => {
    for (const text of ['-5', 'abc', '12a', '1.234', '1,23', '2000000000']) {
      const result = parseMoneyInput(text);
      expect(result.ok, text).toBe(false);
      if (!result.ok) expect(result.message.length).toBeGreaterThan(5);
    }
    expect(parsePercentInput('101')).toMatchObject({ ok: false });
    expect(parseIntegerInput('13', { min: 0, max: 12 })).toMatchObject({ ok: false });
    expect(parseIntegerInput('2.5', { min: 0, max: 12 })).toMatchObject({ ok: false });
  });

  it('converts typed rate percentages to annual fractions and back', () => {
    expect(parseRatePercentInput('6.8')).toEqual({ ok: true, value: '0.068' });
    expect(parseRatePercentInput('6.8%')).toEqual({ ok: true, value: '0.068' });
    expect(parseRatePercentInput('0')).toEqual({ ok: true, value: '0' });
    expect(parseRatePercentInput('31')).toEqual({ ok: false, message: 'Enter a rate from 0% to 30%.' });
    expect(formatRatePercent('0.065')).toBe('6.5');
    fc.assert(fc.property(fc.integer({ min: 0, max: 300000 }), n => {
      const text = (n / 10000).toString();
      const parsed = parseRatePercentInput(text);
      return parsed.ok && formatRatePercent(parsed.value) === text;
    }));
  });

  it('validates dates and text', () => {
    expect(parseDateInput('2027-02-29')).toMatchObject({ ok: false });
    expect(parseDateInput('2028-02-29')).toEqual({ ok: true, value: '2028-02-29' });
    expect(parseTextInput('  ')).toMatchObject({ ok: false });
    expect(parseTextInput('x'.repeat(201))).toMatchObject({ ok: false });
  });

  it('formats currency with separators', () => {
    expect(formatCurrency('22700')).toBe('$22,700.00');
    expect(formatCurrency('-640.5')).toBe('−$640.50');
    expect(formatCurrency(null)).toBe('Not available');
  });
});
