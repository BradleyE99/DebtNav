import { useState, type ReactNode } from 'react';
import {
  parseDateInput, parseIntegerInput, parseMoneyInput, parsePercentInput, parseQuantityInput,
  parseRatePercentInput, parseTextInput, formatRatePercent, type ParseResult,
} from '../../data/parse';
import { decimalEquals, formatMoneyInput } from '../format';
import { describedBy, FieldShell } from './FieldShell';
import { errorForField, useDraftField, type CommitResult } from './useDraftField';
import { useReportFieldStatus } from './fieldStatus';

interface BaseProps<T> {
  /** Contract field path; used as DOM id and to match store errors. */
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  value: T;
  onCommit: (value: T) => CommitResult;
  className?: string;
  disabled?: boolean;
  /** A problem with the stored value found by the engine (the value is saved but cannot be projected). */
  externalError?: string | null;
}

interface DraftInputProps<T> extends BaseProps<T> {
  format: (value: T) => string;
  parse: (text: string) => ParseResult<T>;
  equals?: (a: T, b: T) => boolean;
  inputMode?: 'decimal' | 'numeric' | 'text';
  type?: 'text' | 'date';
  prefix?: string;
  suffix?: string;
  settleMs?: number;
}

/** Generic text-backed input built on useDraftField. */
export function DraftInput<T>(props: DraftInputProps<T>) {
  const { id, label, hint, className, inputMode, type = 'text', prefix, suffix, disabled, externalError } = props;
  const field = useDraftField({
    id, value: props.value, format: props.format, parse: props.parse, onCommit: props.onCommit,
    equals: props.equals, settleMs: props.settleMs,
  });
  const error = field.error ?? externalError ?? null;
  useReportFieldStatus(id, Boolean(error));
  const input = (
    <input
      id={id}
      type={type}
      inputMode={inputMode}
      autoComplete="off"
      spellCheck={false}
      disabled={disabled}
      value={field.text}
      onChange={field.onChange}
      onBlur={field.onBlur}
      onKeyDown={field.onKeyDown}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(id, hint, error)}
    />
  );
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} className={className}
      errorNote={field.error ? undefined : "This value is saved, but results can't be projected until it changes."}>
      {prefix || suffix ? (
        <span className="input-adorned">
          {prefix && <span className="input-affix" aria-hidden="true">{prefix}</span>}
          {input}
          {suffix && <span className="input-affix" aria-hidden="true">{suffix}</span>}
        </span>
      ) : input}
    </FieldShell>
  );
}

// ------------------------------------------------------------------ typed fields

export function MoneyField(props: BaseProps<string> & { max?: string; min?: string }) {
  return (
    <DraftInput<string>
      {...props}
      prefix="$"
      inputMode="decimal"
      format={formatMoneyInput}
      parse={text => parseMoneyInput(text, { max: props.max, min: props.min }) as ParseResult<string>}
      equals={decimalEquals}
    />
  );
}

/** Optional money: blank text means "no value" (undefined). */
export function OptionalMoneyField(props: BaseProps<string | undefined> & { max?: string }) {
  return (
    <DraftInput<string | undefined>
      {...props}
      prefix="$"
      inputMode="decimal"
      format={formatMoneyInput}
      parse={text => parseMoneyInput(text, { max: props.max, optional: true })}
      equals={decimalEquals}
    />
  );
}

export function PercentField(props: BaseProps<string> & { max?: string }) {
  return (
    <DraftInput<string>
      {...props}
      suffix="%"
      inputMode="decimal"
      format={value => value}
      parse={text => parsePercentInput(text, { max: props.max }) as ParseResult<string>}
      equals={decimalEquals}
    />
  );
}

/** Shows a percent (6.8) while storing the annual fraction ('0.068'). */
export function RateField(props: BaseProps<string>) {
  return (
    <DraftInput<string>
      {...props}
      suffix="%"
      inputMode="decimal"
      format={formatRatePercent}
      parse={parseRatePercentInput}
      equals={decimalEquals}
    />
  );
}

export function IntegerField(props: BaseProps<number> & { min: number; max: number; suffix?: string }) {
  return (
    <DraftInput<number>
      {...props}
      inputMode="numeric"
      format={value => String(value)}
      parse={text => parseIntegerInput(text, { min: props.min, max: props.max }) as ParseResult<number>}
    />
  );
}

/** Optional whole number: blank text means "not set" (undefined), which is different from 0. */
export function OptionalIntegerField(props: BaseProps<number | undefined> & { min: number; max: number; suffix?: string }) {
  return (
    <DraftInput<number | undefined>
      {...props}
      inputMode="numeric"
      format={value => (value === undefined ? '' : String(value))}
      parse={text => parseIntegerInput(text, { min: props.min, max: props.max, optional: true })}
    />
  );
}

export function QuantityField(props: BaseProps<string> & { max: string; places?: number; noun?: string; suffix?: string }) {
  return (
    <DraftInput<string>
      {...props}
      inputMode="decimal"
      format={value => value}
      parse={text => parseQuantityInput(text, { max: props.max, places: props.places, noun: props.noun })}
      equals={decimalEquals}
    />
  );
}

export function DateField(props: BaseProps<string> & { settle?: boolean }) {
  const { settle, ...rest } = props;
  return (
    <DraftInput<string>
      {...rest}
      type="date"
      format={value => value}
      parse={text => parseDateInput(text) as ParseResult<string>}
      settleMs={settle ? 600 : undefined}
    />
  );
}

export function OptionalDateField(props: BaseProps<string | undefined>) {
  return (
    <DraftInput<string | undefined>
      {...props}
      type="date"
      format={value => value ?? ''}
      parse={text => parseDateInput(text, { optional: true })}
    />
  );
}

export function TextField(props: BaseProps<string> & { maxLength?: number }) {
  const { maxLength, ...rest } = props;
  return (
    <DraftInput<string>
      {...rest}
      inputMode="text"
      format={value => value}
      parse={text => parseTextInput(text, { maxLength })}
    />
  );
}

// ------------------------------------------------------------------ choice fields

export function SelectField<V extends string>(props: BaseProps<V> & { options: readonly (readonly [V, string])[] }) {
  const { id, label, hint, value, onCommit, options, className, disabled } = props;
  const [error, setError] = useState<string | null>(null);
  useReportFieldStatus(id, Boolean(error));
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} errorNote="" className={className}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        onChange={event => {
          const result = onCommit(event.target.value as V);
          setError(result && !result.ok ? errorForField(result.errors, id) : null);
        }}
      >
        {options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </select>
    </FieldShell>
  );
}

export function CheckboxField(props: BaseProps<boolean>) {
  const { id, label, hint, value, onCommit, className, disabled } = props;
  const [error, setError] = useState<string | null>(null);
  useReportFieldStatus(id, Boolean(error));
  return (
    <div className={['field-check', className ?? ''].filter(Boolean).join(' ')}>
      <input
        id={id}
        type="checkbox"
        checked={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        onChange={event => {
          const result = onCommit(event.target.checked);
          setError(result && !result.ok ? errorForField(result.errors, id) : null);
        }}
      />
      <div>
        <label htmlFor={id}>{label}</label>
        {hint && <p id={`${id}-hint`} className="field-hint">{hint}</p>}
        {error && <p id={`${id}-error`} className="field-error">{error}</p>}
      </div>
    </div>
  );
}
