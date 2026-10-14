/**
 * Field status reporting (shared UI contract).
 *
 * Every field built on useDraftField (plus SelectField and CheckboxField) reports whether it is
 * currently showing an error to the nearest FieldStatusProvider. A container that can hide its
 * fields, such as a collapsed loan card, wraps them in a provider so it can show an error indicator
 * in its summary. Collapsed containers must keep their fields mounted (e.g. `hidden`) so draft text
 * and errors survive collapsing.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type Report = (id: string, hasError: boolean) => void;

const FieldStatusContext = createContext<Report | null>(null);

/** Reports `hasError` for field `id` to the nearest provider; clears the report on unmount. */
export function useReportFieldStatus(id: string, hasError: boolean): void {
  const report = useContext(FieldStatusContext);
  useEffect(() => {
    if (!report) return;
    report(id, hasError);
    return () => report(id, false);
  }, [report, id, hasError]);
}

/** Tracks which descendant fields are showing errors. Returns the ids (sorted) and a provider to wrap them in. */
export function useFieldStatus(): { invalidFieldIds: readonly string[]; FieldStatusProvider: (props: { children: ReactNode }) => ReactNode } {
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(() => new Set());
  const report = useCallback<Report>((id, hasError) => {
    setInvalid(current => {
      if (current.has(id) === hasError) return current;
      const next = new Set(current);
      if (hasError) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  const FieldStatusProvider = useMemo(
    () => function FieldStatusProvider({ children }: { children: ReactNode }) {
      return <FieldStatusContext.Provider value={report}>{children}</FieldStatusContext.Provider>;
    },
    [report],
  );
  const invalidFieldIds = useMemo(() => [...invalid].sort(), [invalid]);
  return { invalidFieldIds, FieldStatusProvider };
}
