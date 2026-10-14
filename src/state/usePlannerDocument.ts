/**
 * The single source of truth for the persisted plan document (PlannerStore contract).
 *
 * - Every update is applied to the latest committed plan (held in a ref and updated synchronously),
 *   so rapid successive edits never apply to a stale plan or lose each other.
 * - Invalid results are rejected with field-path errors and leave the document unchanged.
 * - Saving is debounced and flushed on pagehide, visibilitychange → hidden, and unmount. The
 *   latest plan lives in a ref updated synchronously, so an edit immediately followed by a reload
 *   (which fires pagehide) is written before the page goes away.
 * - If stored data exists but cannot be read, it is preserved: autosave is paused until the user
 *   imports a plan or deletes their data.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDefaultPlan, reconcileSchoolYears } from '../engine/planner';
import { pruneDanglingReferences } from '../engine/paths';
import type { FieldError, PlannerDocument, PlannerPlan, PlannerStore, Result, SaveResult, SaveStatus, StorageLike } from '../engine/planner-contracts';
import { UNAVAILABLE_NOTICE, deleteDocument, importDocumentDetailed, loadDocument, probeStorage, saveDocumentDetailed, serializeDocument } from '../data/storage';
import { DISBURSEMENT_PATH, repaymentStartDate, validatePlannerPlan } from '../data/validation';

export const DEFAULT_SAVE_DEBOUNCE_MS = 250;

export interface PlannerDocumentOptions {
  storage?: StorageLike;
  debounceMs?: number;
}

interface UndoSnapshot { label: string; document: PlannerDocument }

interface Initial {
  document: PlannerDocument;
  status: SaveStatus;
  paused: boolean;
}

const freshDocument = (): PlannerDocument => ({ plan: createDefaultPlan(), disclaimerDismissed: false });

function initialize(storage: StorageLike | undefined): Initial {
  const loaded = loadDocument(storage);
  if (loaded.preservedUnreadable) {
    return { document: freshDocument(), paused: true, status: { state: 'paused', message: loaded.notice, savedAt: null } };
  }
  // A repaired older plan loads normally; the notice names each change. The stored text is not
  // rewritten until the user's first edit (dirty stays false), so merely opening the app changes nothing.
  const repaired = loaded.repairs.length > 0;
  if (loaded.notice && !repaired) {
    return { document: loaded.document ?? freshDocument(), paused: false, status: { state: 'unavailable', message: loaded.notice, savedAt: null } };
  }
  // Storage that can be read but not written (private modes, full quota): say so before the first edit.
  if (!probeStorage(storage)) {
    const message = repaired ? `${loaded.notice} ${UNAVAILABLE_NOTICE}` : UNAVAILABLE_NOTICE;
    return { document: loaded.document ?? freshDocument(), paused: false, status: { state: 'unavailable', message, savedAt: null } };
  }
  return { document: loaded.document ?? freshDocument(), paused: false, status: { state: 'saved', message: repaired ? loaded.notice : null, savedAt: null } };
}

const datesChanged = (before: PlannerPlan, after: PlannerPlan): boolean =>
  before.settings.startDate !== after.settings.startDate || before.settings.graduationDate !== after.settings.graduationDate;

/**
 * A loan disbursed after repayment start is reported at 'loans.<id>.disbursementDate'. When the edit
 * that caused it changed graduation or grace (and not that loan's date), the user is editing the
 * settings field, so the error is moved there and names the affected loans.
 */
function attributeDisbursementErrors(before: PlannerPlan, after: PlannerPlan, errors: FieldError[]): FieldError[] {
  const settingsKey = before.settings.graduationDate !== after.settings.graduationDate ? 'graduationDate'
    : before.settings.graceMonths !== after.settings.graceMonths ? 'graceMonths' : null;
  if (!settingsKey) return errors;
  const blocked: string[] = [];
  const rest = errors.filter(error => {
    const loanId = DISBURSEMENT_PATH.exec(error.path)?.[1];
    if (loanId === undefined) return true;
    const previous = before.loans.find(loan => loan.id === loanId);
    const loan = after.loans.find(entry => entry.id === loanId);
    if (!previous || !loan || previous.disbursementDate !== loan.disbursementDate) return true;
    blocked.push(`"${loan.name}" (${loan.disbursementDate})`);
    return false;
  });
  if (!blocked.length) return errors;
  const start = repaymentStartDate(after.settings);
  const message = `Repayment would start ${start}, before ${blocked.length === 1 ? 'loan' : 'loans'} ${blocked.join(', ')} ${blocked.length === 1 ? 'is' : 'are'} disbursed. Move the disbursement ${blocked.length === 1 ? 'date' : 'dates'} earlier or remove the ${blocked.length === 1 ? 'loan' : 'loans'} first.`;
  return [{ path: `settings.${settingsKey}`, code: 'OUT_OF_RANGE', message }, ...rest];
}

export function usePlannerDocument(options: PlannerDocumentOptions = {}): PlannerStore {
  // Options are read once; changing them after mount has no effect.
  const [config] = useState(() => ({
    storage: options.storage,
    debounceMs: Math.max(0, Math.min(options.debounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS, 300)),
  }));
  const [initial] = useState(() => initialize(config.storage));
  const [document, setDocument] = useState<PlannerDocument>(initial.document);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(initial.status);
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);

  const documentRef = useRef<PlannerDocument>(initial.document);
  const pausedRef = useRef(initial.paused);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUndoRef = useRef<UndoSnapshot | null>(null);

  const flush = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!dirtyRef.current || pausedRef.current) return;
    const result = saveDocumentDetailed(documentRef.current, config.storage);
    if (result.ok) {
      dirtyRef.current = false;
      setSaveStatus({ state: 'saved', message: null, savedAt: new Date().toISOString() });
    } else {
      // Keep the document dirty so a later edit or flush retries.
      setSaveStatus(previous => ({ state: result.reason === 'storage' ? 'unavailable' : 'error', message: result.notice, savedAt: previous.savedAt }));
    }
  }, [config]);

  const scheduleSave = useCallback((): void => {
    dirtyRef.current = true;
    if (pausedRef.current) return;
    setSaveStatus(previous => (previous.state === 'pending' ? previous : { state: 'pending', message: null, savedAt: previous.savedAt }));
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, config.debounceMs);
  }, [config, flush]);

  const commit = useCallback((next: PlannerDocument): void => {
    documentRef.current = next;
    setDocument(next);
    scheduleSave();
  }, [scheduleSave]);

  useEffect(() => {
    const onPageHide = () => flush();
    const onVisibility = () => {
      if (window.document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', onPageHide);
    window.document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [flush]);

  const updatePlan = useCallback((update: (plan: PlannerPlan) => PlannerPlan): Result<PlannerPlan> => {
    const current = documentRef.current;
    let next: PlannerPlan;
    try {
      next = update(current.plan);
      // Keep school years consistent with the timeline whenever its dates change, then drop
      // references (scenario overrides, custom order, year links) to records that no longer exist.
      if (datesChanged(current.plan, next)) next = reconcileSchoolYears(next);
      next = pruneDanglingReferences(next);
    } catch {
      pendingUndoRef.current = null;
      return { ok: false, errors: [{ path: 'plan', code: 'OUT_OF_RANGE', message: 'That change could not be applied.' }] };
    }
    const checked = validatePlannerPlan(next);
    if (!checked.ok) {
      pendingUndoRef.current = null;
      return { ok: false, errors: attributeDisbursementErrors(current.plan, next, checked.errors) };
    }
    // One-level undo: a marked (destructive) edit offers undo; any other edit retires it so undo
    // can never silently discard later work.
    setUndoSnapshot(pendingUndoRef.current);
    pendingUndoRef.current = null;
    commit({ ...current, plan: checked.value });
    return checked;
  }, [commit]);

  const dismissDisclaimer = useCallback((): void => {
    if (documentRef.current.disclaimerDismissed) return;
    commit({ ...documentRef.current, disclaimerDismissed: true });
  }, [commit]);

  const markUndoable = useCallback((label: string): void => {
    pendingUndoRef.current = { label, document: documentRef.current };
  }, []);

  const importText = useCallback((text: string): Result<PlannerDocument> => {
    const { result, repairs } = importDocumentDetailed(text);
    if (!result.ok) return result;
    setUndoSnapshot({ label: 'Import', document: documentRef.current });
    pendingUndoRef.current = null;
    // The user chose to replace what was stored (the UI confirms overwriting preserved data).
    pausedRef.current = false;
    documentRef.current = result.value;
    setDocument(result.value);
    dirtyRef.current = true;
    flush();
    if (repairs.length) {
      // Keep the save outcome (saved / unavailable) and prepend what was changed to make the file projectable.
      const repairText = repairs.join(' ');
      setSaveStatus(previous => ({ ...previous, message: previous.message ? `${repairText} ${previous.message}` : repairText }));
    }
    return result;
  }, [flush]);

  const exportJson = useCallback((): Result<string> => serializeDocument(documentRef.current), []);

  const deleteAllData = useCallback((): SaveResult => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const result = deleteDocument(config.storage);
    if (!result.ok) {
      setSaveStatus(previous => ({ state: 'unavailable', message: result.notice, savedAt: previous.savedAt }));
      return result;
    }
    const fresh = freshDocument();
    documentRef.current = fresh;
    pendingUndoRef.current = null;
    pausedRef.current = false;
    dirtyRef.current = false;
    setDocument(fresh);
    setUndoSnapshot(null);
    setSaveStatus({ state: 'saved', message: 'Your saved data was deleted from this device.', savedAt: null });
    return result;
  }, [config]);

  const undo = useMemo(() => {
    if (!undoSnapshot) return null;
    return {
      label: undoSnapshot.label,
      apply: () => {
        setUndoSnapshot(null);
        pendingUndoRef.current = null;
        commit(undoSnapshot.document);
      },
    };
  }, [undoSnapshot, commit]);

  return useMemo<PlannerStore>(() => ({
    document,
    updatePlan,
    dismissDisclaimer,
    saveStatus,
    undo,
    markUndoable,
    importText,
    exportJson,
    deleteAllData,
  }), [document, updatePlan, dismissDisclaimer, saveStatus, undo, markUndoable, importText, exportJson, deleteAllData]);
}
