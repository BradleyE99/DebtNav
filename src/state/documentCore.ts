/**
 * Shared document core for every PlannerStore (local device store and signed-in server store).
 *
 * - Edits are applied to the latest committed document (a ref updated synchronously), validated, and
 *   either committed or rejected with field-path errors (the document is unchanged on rejection).
 * - Undo (US-904): every committed change records the document before it, newest last, capped at
 *   UNDO_LIMIT. Entries never expire on a timer or because of later edits; undo is LIFO and restores
 *   the whole previous document (so related records come back together) through the same commit
 *   path, which saves it like any edit. Consecutive unlabelled edits within COALESCE_MS (typing in one
 *   field) share one entry. History is session-only (memory) and cleared on sign-out/deletion.
 * - Persistence is the caller's job: `onChange` is called after each commit.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { reconcileSchoolYears } from '../engine/planner';
import { pruneDanglingReferences } from '../engine/paths';
import { loanPaymentTiming } from '../engine/paymentTiming';
import type { FieldError, PlannerDocument, PlannerPlan, Result, UndoEntry, UndoHistory } from '../engine/planner-contracts';
import { DISBURSEMENT_PATH, validatePlannerPlan } from '../data/validation';

export const UNDO_LIMIT = 50;
export const COALESCE_MS = 1000;
export const DEFAULT_UNDO_LABEL = 'Edit';

export type ChangeCause = 'edit' | 'undo' | 'import' | 'replace' | 'disclaimer';

interface StoredEntry extends UndoEntry { document: PlannerDocument; coalescible: boolean; atMs: number }

const datesChanged = (before: PlannerPlan, after: PlannerPlan): boolean =>
  before.settings.startDate !== after.settings.startDate || before.settings.graduationDate !== after.settings.graduationDate;

/**
 * A loan disbursed after its repayment period starts is reported at 'loans.<id>.disbursementDate'.
 * When the edit that caused it moved graduation (and not that loan's date), the user is editing the
 * graduation field, so the error is moved there and names the affected loans.
 */
export function attributeDisbursementErrors(before: PlannerPlan, after: PlannerPlan, errors: FieldError[]): FieldError[] {
  if (before.settings.graduationDate === after.settings.graduationDate) return errors;
  const blocked: string[] = [];
  const starts: string[] = [];
  const rest = errors.filter(error => {
    const loanId = DISBURSEMENT_PATH.exec(error.path)?.[1];
    if (loanId === undefined) return true;
    const previous = before.loans.find(loan => loan.id === loanId);
    const loan = after.loans.find(entry => entry.id === loanId);
    if (!previous || !loan || previous.disbursementDate !== loan.disbursementDate) return true;
    blocked.push(`"${loan.name}" (${loan.disbursementDate})`);
    try {
      const start = loanPaymentTiming(after, loan).repaymentPeriodStart;
      if (start && !starts.includes(start)) starts.push(start);
    } catch {
      // Timing unavailable for malformed input: the message below still names the loans.
    }
    return false;
  });
  if (!blocked.length) return errors;
  const one = blocked.length === 1;
  const when = starts.length ? ` on ${starts.join(', ')}` : '';
  const message = `Required payments would start${when}, before ${one ? 'loan' : 'loans'} ${blocked.join(', ')} ${one ? 'is' : 'are'} disbursed. Move the disbursement ${one ? 'date' : 'dates'} earlier or remove the ${one ? 'loan' : 'loans'} first.`;
  return [{ path: 'settings.graduationDate', code: 'OUT_OF_RANGE', message }, ...rest];
}

/** Pure: apply an edit to a document, keeping school years and references consistent, then validate. */
export function applyPlanUpdate(current: PlannerDocument, update: (plan: PlannerPlan) => PlannerPlan): Result<PlannerDocument> {
  let next: PlannerPlan;
  try {
    next = update(current.plan);
    // Keep school years consistent with the timeline whenever its dates change, then drop references
    // (scenario overrides, custom order, year links) to records that no longer exist.
    if (datesChanged(current.plan, next)) next = reconcileSchoolYears(next);
    next = pruneDanglingReferences(next);
  } catch {
    return { ok: false, errors: [{ path: 'plan', code: 'OUT_OF_RANGE', message: 'That change could not be applied.' }] };
  }
  const checked = validatePlannerPlan(next);
  if (!checked.ok) return { ok: false, errors: attributeDisbursementErrors(current.plan, next, checked.errors) };
  return { ok: true, value: { ...current, plan: checked.value } };
}

export interface DocumentCoreOptions {
  initialDocument: PlannerDocument;
  /** Called after every committed change (not for `load`). */
  onChange(next: PlannerDocument, cause: ChangeCause): void;
  now?: () => number;
}

export interface DocumentCore {
  document: PlannerDocument;
  /** Latest committed document (synchronously updated). */
  documentRef: { readonly current: PlannerDocument };
  updatePlan(update: (plan: PlannerPlan) => PlannerPlan, options?: { undoLabel?: string; coalesce?: boolean }): Result<PlannerPlan>;
  dismissDisclaimer(): void;
  markUndoable(label: string): void;
  /** Replace the whole document as an undoable change. `notify: false` skips onChange (already persisted). */
  replaceDocument(document: PlannerDocument, label: string, options?: { notify?: boolean; cause?: ChangeCause }): void;
  /** Set the document without undo or onChange (initial load, server reload, deletion). */
  load(document: PlannerDocument): void;
  history: UndoHistory;
  undo: { label: string; apply(): void } | null;
}

let entryCounter = 0;

export function useDocumentCore(options: DocumentCoreOptions): DocumentCore {
  const [document, setDocument] = useState<PlannerDocument>(options.initialDocument);
  const [entries, setEntries] = useState<readonly StoredEntry[]>([]);
  const documentRef = useRef<PlannerDocument>(options.initialDocument);
  const entriesRef = useRef<readonly StoredEntry[]>([]);
  const pendingLabelRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  useLayoutEffect(() => { optionsRef.current = options; });

  const now = useCallback(() => (optionsRef.current.now ?? Date.now)(), []);

  const setHistory = useCallback((next: readonly StoredEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
  }, []);

  const record = useCallback((before: PlannerDocument, label: string | null, coalesce = false) => {
    const at = now();
    const coalescible = label === null || coalesce;
    const entryLabel = label ?? DEFAULT_UNDO_LABEL;
    const previous = entriesRef.current.at(-1);
    // Typing in a field commits on each keystroke; one burst of edits with the same label is one undo step.
    if (coalescible && previous?.coalescible && previous.label === entryLabel && at - previous.atMs < COALESCE_MS) {
      setHistory([...entriesRef.current.slice(0, -1), { ...previous, atMs: at }]);
      return;
    }
    const entry: StoredEntry = {
      id: `undo-${++entryCounter}`, label: entryLabel, at: new Date(at).toISOString(),
      document: before, coalescible, atMs: at,
    };
    setHistory([...entriesRef.current, entry].slice(-UNDO_LIMIT));
  }, [now, setHistory]);

  const commit = useCallback((next: PlannerDocument, cause: ChangeCause, notify = true) => {
    documentRef.current = next;
    setDocument(next);
    if (notify) optionsRef.current.onChange(next, cause);
  }, []);

  const updatePlan = useCallback((update: (plan: PlannerPlan) => PlannerPlan, updateOptions?: { undoLabel?: string; coalesce?: boolean }): Result<PlannerPlan> => {
    const current = documentRef.current;
    const label = updateOptions?.undoLabel ?? pendingLabelRef.current;
    pendingLabelRef.current = null;
    const result = applyPlanUpdate(current, update);
    if (!result.ok) return result;
    record(current, label ?? null, updateOptions?.coalesce === true);
    commit(result.value, 'edit');
    return { ok: true, value: result.value.plan };
  }, [commit, record]);

  const dismissDisclaimer = useCallback(() => {
    if (documentRef.current.disclaimerDismissed) return;
    commit({ ...documentRef.current, disclaimerDismissed: true }, 'disclaimer');
  }, [commit]);

  const markUndoable = useCallback((label: string) => { pendingLabelRef.current = label; }, []);

  const replaceDocument = useCallback((next: PlannerDocument, label: string, replaceOptions?: { notify?: boolean; cause?: ChangeCause }) => {
    pendingLabelRef.current = null;
    record(documentRef.current, label);
    commit(next, replaceOptions?.cause ?? 'replace', replaceOptions?.notify !== false);
  }, [commit, record]);

  const load = useCallback((next: PlannerDocument) => {
    documentRef.current = next;
    setDocument(next);
  }, []);

  const undoNewest = useCallback(() => {
    const newest = entriesRef.current.at(-1);
    if (!newest) return;
    pendingLabelRef.current = null;
    setHistory(entriesRef.current.slice(0, -1));
    commit(newest.document, 'undo');
  }, [commit, setHistory]);

  const clear = useCallback(() => setHistory([]), [setHistory]);

  const history = useMemo<UndoHistory>(() => ({
    entries: entries.map(({ id, label, at }) => ({ id, label, at })),
    canUndo: entries.length > 0,
    undo: undoNewest,
    clear,
  }), [entries, undoNewest, clear]);

  const undo = useMemo(() => {
    const newest = entries.at(-1);
    return newest ? { label: newest.label, apply: undoNewest } : null;
  }, [entries, undoNewest]);

  return { document, documentRef, updatePlan, dismissDisclaimer, markUndoable, replaceDocument, load, history, undo };
}
