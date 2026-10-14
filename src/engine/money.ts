import Decimal from 'decimal.js';

// Isolate precision from consumers changing decimal.js's global configuration.
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const decimalText = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && value.length <= 100;
export const moneyText = (value: unknown): value is string =>
  decimalText(value) && /^\d{1,18}(?:\.\d{1,2})?$/.test(value);
/** Values already created by D are used directly (no copy); anything else is parsed with D's settings. */
const own = (value: Decimal.Value): Decimal =>
  typeof value === 'object' && value.constructor === D ? value : new D(value);
export const cents = (value: Decimal.Value): Decimal => own(value).toDecimalPlaces(2);
export const money = (value: Decimal.Value): string => own(value).toFixed(2);
export const sum = (values: readonly Decimal.Value[]): Decimal => values.reduce<Decimal>((a, b) => a.plus(b), new D(0));
