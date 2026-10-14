import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { FieldError, Result } from '../../engine/planner-contracts';
import type { ParseResult } from '../../data/parse';

/** What a commit handler may return: a store Result (errors are shown at the field) or nothing. */
export type CommitResult = Result<unknown> | void;

export interface DraftFieldOptions<T> {
  /** DOM id; also the contract field path used to match store FieldErrors. */
  id: string;
  /** The stored value. */
  value: T;
  format: (value: T) => string;
  parse: (text: string) => ParseResult<T>;
  onCommit: (value: T) => CommitResult;
  equals?: (a: T, b: T) => boolean;
  /**
   * When set, a valid value is committed only after this many ms without typing, on blur, or on
   * Enter (used for dates where browsers emit intermediate values while a year is typed).
   */
  settleMs?: number;
}

interface DraftState<T> { text: string; seenValue: T; error: string | null }

/** Picks the store error for this field, or the first error when none names it directly. */
export function errorForField(errors: readonly FieldError[], id: string): string {
  const match = errors.find(error => error.path === id) ?? errors.find(error => error.path.startsWith(id + '.')) ?? errors[0];
  return match ? match.message : 'This value could not be saved.';
}

/**
 * Field-local text state for one input.
 * - The text is owned by the field and never jumps while typing.
 * - Valid, changed values are committed immediately (or after settling); invalid text keeps the
 *   last valid stored value and shows an error.
 * - When the stored value changes elsewhere (undo, import, copy-forward), the text follows it unless
 *   the current text already means that value.
 */
export function useDraftField<T>({ id, value, format, parse, onCommit, equals = Object.is, settleMs }: DraftFieldOptions<T>) {
  const [state, setState] = useState<DraftState<T>>(() => ({ text: format(value), seenValue: value, error: null }));
  const latest = useRef({ value, onCommit, equals });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ value: T } | null>(null);

  useEffect(() => { latest.current = { value, onCommit, equals }; });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Sync from the store during render (React's "adjust state when a prop changes" pattern).
  if (!Object.is(state.seenValue, value)) {
    const parsed = parse(state.text);
    const keepText = parsed.ok && equals(parsed.value, value);
    setState({ text: keepText ? state.text : format(value), seenValue: value, error: keepText ? state.error : null });
  }

  /** Returns true when the value is now stored (or already was). */
  function commit(next: T): boolean {
    const current = latest.current;
    if (current.equals(next, current.value)) return true;
    const result = current.onCommit(next);
    if (result && !result.ok) {
      setState(s => ({ ...s, error: errorForField(result.errors, id) }));
      return false;
    }
    return true;
  }

  function cancelPending() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
  }

  function flush(): boolean {
    const next = pending.current;
    cancelPending();
    return next ? commit(next.value) : true;
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const text = event.target.value;
    const parsed = parse(text);
    setState(s => ({ ...s, text, error: parsed.ok ? null : parsed.message }));
    cancelPending();
    if (!parsed.ok) return;
    if (settleMs === undefined) { commit(parsed.value); return; }
    pending.current = { value: parsed.value };
    timer.current = setTimeout(flush, settleMs);
  }

  function onBlur() {
    const parsed = parse(state.text);
    if (!parsed.ok) { cancelPending(); return; }
    const stored = flush();
    if (stored && !state.error) setState(s => ({ ...s, text: format(parsed.value) }));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && settleMs !== undefined) flush();
  }

  return { text: state.text, error: state.error, onChange, onBlur, onKeyDown };
}
