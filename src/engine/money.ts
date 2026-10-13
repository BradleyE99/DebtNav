import Decimal from 'decimal.js';

// Isolate precision from consumers changing decimal.js's global configuration.
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const decimalText = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && value.length <= 100;
export const moneyText = (value: unknown): value is string =>
  decimalText(value) && /^\d{1,18}(?:\.\d{1,2})?$/.test(value);
export const cents = (value: Decimal.Value): Decimal => new D(value).toDecimalPlaces(2);
export const money = (value: Decimal.Value): string => cents(value).toFixed(2);
export const sum = (values: readonly Decimal.Value[]): Decimal => values.reduce<Decimal>((a, b) => a.plus(b), new D(0));
