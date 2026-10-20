/**
 * Local (browser) PlannerStore: the guest plan lives in browser storage under GUEST_PLAN_KEY (the
 * original 'debtnav.plan' key and envelope). Used in guest mode (no sign-in) and by component tests;
 * the signed-in app uses useServerPlannerDocument. Both share documentCore (edits, validation, undo
 * history). Nothing here talks to the network: guest plans are never sent to the server.
 *
 * - Every status carries scope 'browser' so the UI distinguishes browser saving from account saving.
 *
 * - Saving is debounced and flushed on pagehide, visibilitychange → hidden, and unmount. The latest
 *   plan lives in a ref updated synchronously, so an edit immediately followed by a reload (which
 *   fires pagehide) is written before the page goes away.
 * - If stored data exists but cannot be read, it is preserved: autosave is paused until the user
 *   imports a plan or deletes their data.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDefaultPlan } from '../engine/planner';
import type { PlannerDocument, PlannerStore, Result, SaveResult, SaveStatus, StorageLike } from '../engine/planner-contracts';
import { UNAVAILABLE_NOTICE, deleteDocument, importDocumentDetailed, loadDocument, probeStorage, saveDocumentDetailed, serializeDocument } from '../data/storage';
import { useDocumentCore } from './documentCore';

export { attributeDisbursementErrors } from './documentCore';

export const DEFAULT_SAVE_DEBOUNCE_MS = 250;

export interface PlannerDocumentOptions {
  storage?: StorageLike;
  debounceMs?: number;
}

interface Initial {
  document: PlannerDocument;
  status: SaveStatus;
  paused: boolean;
}

export const freshDocument = (): PlannerDocument => ({ plan: createDefaultPlan(), disclaimerDismissed: false });

const browser = (status: Omit<SaveStatus, 'scope'>): SaveStatus => ({ ...status, scope: 'browser' });

function initialize(storage: StorageLike | undefined): Initial {
  const loaded = loadDocument(storage);
  if (loaded.preservedUnreadable) {
    return { document: freshDocument(), paused: true, status: browser({ state: 'paused', message: loaded.notice, savedAt: null }) };
  }
  // A repaired older plan loads normally; the notice names each change. The stored text is not
  // rewritten until the user's first edit (dirty stays false), so merely opening the app changes nothing.
  const repaired = loaded.repairs.length > 0;
  if (loaded.notice && !repaired) {
    return { document: loaded.document ?? freshDocument(), paused: false, status: browser({ state: 'unavailable', message: loaded.notice, savedAt: null }) };
  }
  // Storage that can be read but not written (private modes, full quota): say so before the first edit.
  if (!probeStorage(storage)) {
    const message = repaired ? `${loaded.notice} ${UNAVAILABLE_NOTICE}` : UNAVAILABLE_NOTICE;
    return { document: loaded.document ?? freshDocument(), paused: false, status: browser({ state: 'unavailable', message, savedAt: null }) };
  }
  return { document: loaded.document ?? freshDocument(), paused: false, status: browser({ state: 'saved', message: repaired ? loaded.notice : null, savedAt: null }) };
}

/** The local store's deletion is synchronous. */
export type LocalPlannerStore = Omit<PlannerStore, 'deleteAllData'> & { deleteAllData(): SaveResult };

/** Guest store handle (contract E). */
export type GuestPlannerStore = LocalPlannerStore & {
  /**
   * Writes pending edits immediately (no debounce). `saved` is true only when the plan shown is
   * durably stored in this browser: nothing unsaved remains and storage accepts writes. False when
   * storage is unavailable or full, or when saving is paused with edits that were not written.
   */
  flushNow(): { saved: boolean };
};

export function usePlannerDocument(options: PlannerDocumentOptions = {}): GuestPlannerStore {
  // Options are read once; changing them after mount has no effect.
  const [config] = useState(() => ({
    storage: options.storage,
    debounceMs: Math.max(0, Math.min(options.debounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS, 300)),
  }));
  const [initial] = useState(() => initialize(config.storage));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(initial.status);

  const pausedRef = useRef(initial.paused);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef<PlannerDocument>(initial.document);
  // Whether storage accepts writes, as last observed (initial probe, then each write).
  const writableRef = useRef(initial.status.state !== 'unavailable');

  /** Writes pending edits now. Returns true when nothing unsaved remains in working storage. */
  const flush = useCallback((): boolean => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pausedRef.current) return !dirtyRef.current;
    if (!dirtyRef.current) return writableRef.current;
    const result = saveDocumentDetailed(latestRef.current, config.storage);
    if (result.ok) {
      dirtyRef.current = false;
      writableRef.current = true;
      setSaveStatus(browser({ state: 'saved', message: null, savedAt: new Date().toISOString() }));
      return true;
    }
    // Keep the document dirty so a later edit or flush retries.
    if (result.reason === 'storage') writableRef.current = false;
    setSaveStatus(previous => browser({ state: result.reason === 'storage' ? 'unavailable' : 'error', message: result.notice, savedAt: previous.savedAt }));
    return false;
  }, [config]);

  const flushNow = useCallback((): { saved: boolean } => ({ saved: flush() }), [flush]);

  const onChange = useCallback((next: PlannerDocument): void => {
    latestRef.current = next;
    dirtyRef.current = true;
    if (pausedRef.current) return;
    setSaveStatus(previous => (previous.state === 'pending' ? previous : browser({ state: 'pending', message: null, savedAt: previous.savedAt })));
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, config.debounceMs);
  }, [config, flush]);

  const core = useDocumentCore({ initialDocument: initial.document, onChange });

  useEffect(() => {
    const onPageHide = () => { flush(); };
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

  const { replaceDocument: coreReplace, load, history, documentRef } = core;

  const importText = useCallback((text: string): Result<PlannerDocument> => {
    const { result, repairs } = importDocumentDetailed(text);
    if (!result.ok) return result;
    // The user chose to replace what was stored (the UI confirms overwriting preserved data).
    pausedRef.current = false;
    coreReplace(result.value, 'Import', { cause: 'import' });
    flush();
    if (repairs.length) {
      // Keep the save outcome (saved / unavailable) and prepend what was changed to make the file projectable.
      const repairText = repairs.join(' ');
      setSaveStatus(previous => browser({ ...previous, message: previous.message ? `${repairText} ${previous.message}` : repairText }));
    }
    return result;
  }, [coreReplace, flush]);

  const replaceDocument = useCallback((next: PlannerDocument, label: string): void => {
    pausedRef.current = false;
    coreReplace(next, label);
  }, [coreReplace]);

  const exportJson = useCallback((): Result<string> => serializeDocument(documentRef.current), [documentRef]);

  const deleteAllData = useCallback((): SaveResult => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const result = deleteDocument(config.storage);
    if (!result.ok) {
      setSaveStatus(previous => browser({ state: 'unavailable', message: result.notice, savedAt: previous.savedAt }));
      return result;
    }
    const fresh = freshDocument();
    latestRef.current = fresh;
    pausedRef.current = false;
    dirtyRef.current = false;
    load(fresh);
    history.clear();
    writableRef.current = true;
    setSaveStatus(browser({ state: 'saved', message: 'Your saved data was deleted from this device.', savedAt: null }));
    return result;
  }, [config, load, history]);

  return useMemo<GuestPlannerStore>(() => ({
    document: core.document,
    updatePlan: core.updatePlan,
    dismissDisclaimer: core.dismissDisclaimer,
    saveStatus,
    history: core.history,
    undo: core.undo,
    markUndoable: core.markUndoable,
    importText,
    replaceDocument,
    exportJson,
    deleteAllData,
    flushNow,
  }), [core.document, core.updatePlan, core.dismissDisclaimer, saveStatus, core.history, core.undo, core.markUndoable, importText, replaceDocument, exportJson, deleteAllData, flushNow]);
}
