/**
 * Field-text parsers shared by every editable input (lead-owned).
 *
 * Each parser turns what the user typed into a canonical stored value or a field-level message.
 * Blank text is never silently treated as zero: it is an error unless the field is optional,
 * in which case it parses to `undefined` ("no value").
 */
import { D } from '../engine/money';
import { validDate } from '../engine/dates';
import { DATE_RANGE_MESSAGE, dateInRange } from './validation';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value });
const fail = <T>(message: string): ParseResult<T> => ({ ok: false, message });

/** Longest numeric text accepted; longer input is rejected before any pattern matching. */
export const MAX_NUMBER_INPUT_LENGTH = 40;
const TOO_LONG = 'That number is too long.';

/** Strip formatting people commonly type: surrounding spaces, a leading $, thousands separators, trailing %. */
function normalizeNumber(text: string, symbol: '$' | '%' | null): string {
  let value = String(text).trim();
  if (symbol === '$' && value.startsWith('$')) value = value.slice(1).trim();
  if (symbol === '%' && value.endsWith('%')) value = value.slice(0, -1).trim();
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(value)) value = value.replaceAll(',', '');
  return value;
}

interface DecimalOptions { min?: string; max?: string; places: number; optional?: boolean; symbol: '$' | '%' | null; noun: string }

function parseDecimal(text: string, options: DecimalOptions): ParseResult<string | undefined> {
  if (typeof text !== 'string') return fail(`Enter ${options.noun}.`);
  if (text.length > MAX_NUMBER_INPUT_LENGTH) return fail(TOO_LONG);
  const value = normalizeNumber(text, options.symbol);
  if (value === '') return options.optional ? ok(undefined) : fail(`Enter ${options.noun}.`);
  if (value.startsWith('-')) return fail('Enter a number that is zero or more.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(value)) return fail(`Enter ${options.noun} using digits only, like ${options.symbol === '$' ? '1250.50' : '5'}.`);
  const number = new D(value);
  const places = number.decimalPlaces();
  if (places > options.places) return fail(options.places === 0 ? 'Enter a whole number.' : `Use at most ${options.places} decimal places.`);
  if (options.min !== undefined && number.lt(options.min)) return fail(`Enter ${options.min} or more.`);
  if (options.max !== undefined && number.gt(options.max)) return fail(`Enter ${new D(options.max).toFixed()} or less.`);
  return ok(number.toFixed(options.symbol === '$' ? 2 : Math.max(0, Math.min(places, options.places))));
}

/** Dollar amount → canonical money text with two decimals ('1,250' → '1250.00'). */
export function parseMoneyInput(text: string, options: { max?: string; min?: string; optional?: boolean } = {}): ParseResult<string | undefined> {
  return parseDecimal(text, { max: options.max ?? '1000000000', min: options.min, places: 2, optional: options.optional, symbol: '$', noun: 'a dollar amount' });
}

/** Percent text (0–max, up to 4 decimals) → canonical percent text ('5.50' → '5.5'). */
export function parsePercentInput(text: string, options: { max?: string; optional?: boolean } = {}): ParseResult<string | undefined> {
  return parseDecimal(text, { max: options.max ?? '100', places: 4, optional: options.optional, symbol: '%', noun: 'a percentage' });
}

/** Annual interest rate typed as a percent (0–30) → annual fraction text ('6.8' → '0.068'). */
export function parseRatePercentInput(text: string): ParseResult<string> {
  const percent = parseDecimal(text, { max: '30', places: 4, symbol: '%', noun: 'an interest rate' });
  if (!percent.ok) return percent.message.includes('or less') ? fail('Enter a rate from 0% to 30%.') : percent;
  return ok(new D(percent.value!).div(100).toFixed());
}

/**
 * Display helpers accept decimal text, including Decimal.js exponent output for tiny values
 * ('1e-8'), but refuse huge magnitudes ('9e99999999') that would take minutes to expand.
 */
const DISPLAY_NUMBER = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d{1,2})?$/i;
function displayDecimal(value: unknown): InstanceType<typeof D> | null {
  const text = String(value);
  if (text.length > 100 || !DISPLAY_NUMBER.test(text)) return null;
  const number = new D(text);
  return number.isFinite() && number.abs().lt('1e21') ? number : null;
}

/** Inverse of parseRatePercentInput for display: '0.068' → '6.8'. Non-numeric text is returned unchanged. */
export function formatRatePercent(annualRate: string): string {
  try {
    const number = displayDecimal(annualRate);
    return number ? number.times(100).toFixed() : String(annualRate);
  } catch {
    return String(annualRate);
  }
}

/** Plain decimal quantity such as hours per week (no currency symbol). */
export function parseQuantityInput(text: string, options: { max: string; places?: number; noun?: string }): ParseResult<string> {
  return parseDecimal(text, { max: options.max, places: options.places ?? 2, symbol: null, noun: options.noun ?? 'a number' }) as ParseResult<string>;
}

export function parseIntegerInput(text: string, options: { min: number; max: number; optional?: boolean }): ParseResult<number | undefined> {
  if (typeof text !== 'string') return fail('Enter a whole number.');
  if (text.length > MAX_NUMBER_INPUT_LENGTH) return fail(TOO_LONG);
  let value = text.trim();
  if (value === '') return options.optional ? ok(undefined) : fail('Enter a whole number.');
  // Thousands separators only in their proper places ('1,200'), never '1,2,3'.
  if (/^-?\d{1,3}(,\d{3})+$/.test(value)) value = value.replaceAll(',', '');
  if (!/^-?\d+$/.test(value)) return fail('Enter a whole number using digits only.');
  const number = Number(value); // money-lint-allow: whole-number count, not money
  if (number < options.min || number > options.max) return fail(`Enter a whole number from ${options.min} to ${options.max}.`);
  return ok(number);
}

/** Strict YYYY-MM-DD calendar date within the plan's supported years (1900–2199). */
export function parseDateInput(text: string, options: { optional?: boolean } = {}): ParseResult<string | undefined> {
  if (typeof text !== 'string') return fail('Enter a complete date.');
  const value = text.trim();
  if (value === '') return options.optional ? ok(undefined) : fail('Enter a complete date.');
  if (!validDate(value)) return fail('Enter a complete, valid date (YYYY-MM-DD).');
  return dateInRange(value) ? ok(value) : fail(DATE_RANGE_MESSAGE);
}

export function parseTextInput(text: string, options: { maxLength?: number } = {}): ParseResult<string> {
  const max = options.maxLength ?? 200;
  if (typeof text !== 'string' || !text.trim()) return fail('Enter a name.');
  if (text.length > max) return fail(`Use ${max} characters or fewer.`);
  return ok(text);
}

/** Display helper: money text → '$1,234.56'. Null/undefined → fallback. */
export function formatCurrency(value: string | null | undefined, fallback = 'Not available'): string {
  if (value == null) return fallback;
  let fixed: string;
  try {
    const number = displayDecimal(value);
    if (!number) return fallback;
    fixed = number.toFixed(2);
  } catch {
    return fallback;
  }
  const negative = fixed.startsWith('-');
  const [whole, cents] = (negative ? fixed.slice(1) : fixed).split('.');
  return `${negative ? '−' : ''}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}
