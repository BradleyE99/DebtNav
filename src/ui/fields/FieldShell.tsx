import type { ReactNode } from 'react';

export interface FieldShellProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  /** Extra note under an error, e.g. that results use the last valid value. */
  errorNote?: string;
  className?: string;
  children: ReactNode;
}

export const describedBy = (id: string, hint: unknown, error: unknown): string | undefined =>
  [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;

/** Label + control + hint + field-level error. The label is always visible and tied by htmlFor. */
export function FieldShell({ id, label, hint, error, errorNote = 'Results use the last valid value.', className, children }: FieldShellProps) {
  return (
    <div className={['field', error ? 'field--invalid' : '', className ?? ''].filter(Boolean).join(' ')}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className="field-hint">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}{errorNote && <> <span className="field-error-note">{errorNote}</span></>}
        </p>
      )}
    </div>
  );
}
