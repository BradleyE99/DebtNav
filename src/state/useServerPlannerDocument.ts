/**
 * Signed-in PlannerStore: the plan lives on the server (US-1001/1201/1202), shares documentCore with
 * the local store (edits, validation, undo history).
 *
 * Saving: debounced (800 ms), one request in flight, the latest document wins, every save carries the
 * revision it was based on. 409 → 'conflict' (never a silent overwrite; the user chooses
 * reloadServer or keepMine). Offline/5xx → automatic retries with exponential backoff (and on the
 * browser's 'online' event). 'saved' is shown only after the server confirmed the save.
 * Unsaved edits are kept in an optional browser cache keyed by user id (debtnav.cache.<userId>) as an
 * "unsynced copy" — never reported as saved — and cleared once saved, on sign-out and on deletion.
 * pagehide/hidden flushes with fetch keepalive; beforeunload warns while changes are unsaved.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlannerDocument, PlannerStore, Result, SaveResult, SaveStatus } from '../engine/planner-contracts';
import { importDocumentDetailed, serializeDocument } from '../data/storage';
import { validateDocument } from '../data/validation';
import { useDocumentCore } from './documentCore';
import { freshDocument } from './usePlannerDocument';
import type { ApiClient, SavePlanResult } from './api';

export const SERVER_SAVE_DEBOUNCE_MS = 800;
export const MAX_RETRY_DELAY_MS = 30_000;
export const cacheKey = (userId: string): string => `debtnav.cache.${userId}`;

export interface ServerStoreOptions {
  api: ApiClient;
  userId: string;
  debounceMs?: number;
  /** Browser storage for the unsynced copy; null disables it. Defaults to localStorage. */
  cache?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** The server said the session ended (401). */
  onUnauthorized?(): void;
  /** deleteAllData succeeded: account and data are gone, the user is signed out. */
  onAccountDeleted?(): void;
}

export type ServerPlanLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string; retry(): void }
  | { status: 'ready'; loaded: LoadedPlan };

interface CachedCopy { document: PlannerDocument; baseRevision: number | null; at: string }

function defaultCache(): ServerStoreOptions['cache'] {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readCachedCopy(cache: ServerStoreOptions['cache'], userId: string): CachedCopy | null {
  try {
    const raw = cache?.getItem(cacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedCopy;
    const checked = validateDocument(parsed.document);
    return checked.ok ? { document: checked.value, baseRevision: typeof parsed.baseRevision === 'number' ? parsed.baseRevision : null, at: String(parsed.at) } : null;
  } catch {
    return null;
  }
}

export function clearCachedCopy(userId: string, cache: ServerStoreOptions['cache'] = defaultCache()): void {
  try {
    cache?.removeItem(cacheKey(userId));
  } catch {
    // Storage unavailable: nothing was cached.
  }
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A plan loaded from the server (plus any unsynced copy from this browser), ready for the live store. */
export interface LoadedPlan { document: PlannerDocument; revision: number | null; status: SaveStatus; needsSave: boolean; conflictWithServer?: { revision: number | null } }

/** Step 1: load the signed-in user's plan. Render the live store (useServerPlannerDocument) once ready. */
export function useServerPlanLoad(options: Pick<ServerStoreOptions, 'api' | 'userId' | 'cache' | 'onUnauthorized'>): ServerPlanLoad {
  const [config] = useState(() => ({
    api: options.api,
    userId: options.userId,
    cache: options.cache === undefined ? defaultCache() : options.cache,
  }));
  const callbacks = useRef(options);
  useEffect(() => { callbacks.current = options; });

  const [loadState, setLoadState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; loaded: LoadedPlan }>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await config.api.loadPlan();
      if (cancelled) return;
      if (!result.ok) {
        if (result.kind === 'unauthorized') callbacks.current.onUnauthorized?.();
        setLoadState({ status: 'error', message: result.kind === 'offline' ? 'Your plan could not be loaded because you appear to be offline.' : result.message });
        return;
      }
      if (result.unreadable) {
        setLoadState({ status: 'error', message: 'Your saved plan could not be read by this version of DebtNav. It has not been changed. Try again later or contact support.' });
        return;
      }
      const cached = readCachedCopy(config.cache, config.userId);
      const serverDocument = result.document;
      let loaded: LoadedPlan;
      if (serverDocument === null) {
        // First sign-in: start from the default plan (or this browser's unsynced copy) and create it on the server.
        loaded = { document: cached?.document ?? freshDocument(), revision: null, needsSave: true, status: { state: 'pending', message: null, savedAt: null } };
      } else if (cached && !sameJson(cached.document, serverDocument)) {
        if (cached.baseRevision === result.revision) {
          loaded = { document: cached.document, revision: result.revision, needsSave: true, status: { state: 'pending', message: 'Restored changes from this browser that had not been saved yet.', savedAt: result.updatedAt, revision: result.revision ?? undefined } };
        } else {
          // The server moved on since these edits: let the user choose instead of overwriting either.
          loaded = {
            document: cached.document, revision: result.revision, needsSave: false, conflictWithServer: { revision: result.revision },
            status: { state: 'conflict', message: 'This browser has changes that were not saved, but your plan was changed elsewhere since. Choose which version to keep.', savedAt: result.updatedAt, revision: result.revision ?? undefined },
          };
        }
      } else {
        loaded = { document: serverDocument, revision: result.revision, needsSave: false, status: { state: 'saved', message: null, savedAt: result.updatedAt, revision: result.revision ?? undefined } };
      }
      setLoadState({ status: 'ready', loaded });
    })();
    return () => { cancelled = true; };
  }, [config, attempt]);

  const retryLoad = useCallback(() => {
    setLoadState({ status: 'loading' });
    setAttempt(value => value + 1);
  }, []);

  if (loadState.status === 'loading') return { status: 'loading' };
  if (loadState.status === 'error') return { status: 'error', message: loadState.message, retry: retryLoad };
  return { status: 'ready', loaded: loadState.loaded };
}

/**
 * Step 2: the live server PlannerStore for a loaded plan. Mount it (in a component rendered after
 * useServerPlanLoad is ready) once per user; `flush()` waits for pending saves (used before sign-out).
 */
export function useServerPlannerDocument(options: ServerStoreOptions, loaded: LoadedPlan): { store: PlannerStore; flush(): Promise<void> } {
  const [config] = useState(() => ({
    api: options.api,
    userId: options.userId,
    debounceMs: options.debounceMs ?? SERVER_SAVE_DEBOUNCE_MS,
    cache: options.cache === undefined ? defaultCache() : options.cache,
  }));
  const callbacks = useRef(options);
  useEffect(() => { callbacks.current = options; });

  const [saveStatus, setSaveStatus] = useState<SaveStatus>(loaded.status);
  const revisionRef = useRef<number | null>(loaded.revision);
  const latestRef = useRef<PlannerDocument>(loaded.document);
  /** Last document the server confirmed (null = nothing saved yet). */
  const savedRef = useRef<PlannerDocument | null>(loaded.needsSave || loaded.conflictWithServer ? null : loaded.document);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; attempts: number }>({ timer: null, attempts: 0 });
  const conflictRef = useRef<boolean>(Boolean(loaded.conflictWithServer));
  const blockedRef = useRef<boolean>(false); // invalid or unauthorized: wait for the user
  const adoptedRef = useRef<PlannerDocument | null>(null);
  const deletedRef = useRef(false);
  const mountedRef = useRef(true);

  const isDirty = useCallback(() => savedRef.current !== latestRef.current, []);
  const setStatus = useCallback((status: SaveStatus) => { if (mountedRef.current) setSaveStatus(status); }, []);

  const writeCache = useCallback(() => {
    if (!config.cache || deletedRef.current) return;
    try {
      if (isDirty()) config.cache.setItem(cacheKey(config.userId), JSON.stringify({ document: latestRef.current, baseRevision: revisionRef.current, at: new Date().toISOString() }));
      else config.cache.removeItem(cacheKey(config.userId));
    } catch {
      // Cache is optional (storage full/blocked): the server copy is unaffected.
    }
  }, [config, isDirty]);

  const clearTimers = useCallback(() => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (retryRef.current.timer !== null) { clearTimeout(retryRef.current.timer); retryRef.current.timer = null; }
  }, []);

  // Timers call the newest flush through this ref (flush is defined after handle()).
  const flushRef = useRef<(options?: { keepalive?: boolean }) => Promise<void>>(async () => undefined);

  const scheduleRetry = useCallback(() => {
    const attempts = ++retryRef.current.attempts;
    const delay = Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** Math.min(attempts - 1, 5));
    if (retryRef.current.timer !== null) clearTimeout(retryRef.current.timer);
    retryRef.current.timer = setTimeout(() => { retryRef.current.timer = null; void flushRef.current(); }, delay);
  }, []);

  const handle = useCallback((sent: PlannerDocument, result: SavePlanResult) => {
    if (deletedRef.current) return;
    if (result.ok) {
      retryRef.current.attempts = 0;
      revisionRef.current = result.revision;
      savedRef.current = sent;
      writeCache();
      if (latestRef.current !== sent) {
        // Newer edits arrived while saving: save them next (latest wins).
        setStatus({ state: 'pending', message: null, savedAt: result.savedAt, revision: result.revision });
        timerRef.current = setTimeout(() => { timerRef.current = null; void flushRef.current(); }, 0);
      } else {
        setStatus({ state: 'saved', message: result.repairs?.length ? result.repairs.join(' ') : null, savedAt: result.savedAt, revision: result.revision });
      }
      return;
    }
    writeCache();
    switch (result.kind) {
      case 'conflict':
        conflictRef.current = true;
        setStatus({ state: 'conflict', message: 'This plan was changed on another device or tab since you opened it. Choose which version to keep — nothing has been overwritten.', savedAt: null, revision: revisionRef.current ?? undefined });
        return;
      case 'offline':
        setStatus({ state: 'offline', message: 'You appear to be offline. Your changes are kept in this browser and will be saved when the connection returns.', savedAt: null, revision: revisionRef.current ?? undefined });
        scheduleRetry();
        return;
      case 'server':
        if (retryRef.current.attempts < 5) {
          setStatus({ state: 'offline', message: `${result.message} Retrying automatically.`, savedAt: null, revision: revisionRef.current ?? undefined });
          scheduleRetry();
        } else {
          setStatus({ state: 'error', message: 'Your changes could not be saved after several tries. They are kept in this browser; choose Retry to try again.', savedAt: null, revision: revisionRef.current ?? undefined });
        }
        return;
      case 'unauthorized':
        blockedRef.current = true;
        setStatus({ state: 'error', message: 'Your sign-in has ended, so changes are not being saved. Sign in again — unsaved changes are kept in this browser until then.', savedAt: null, revision: revisionRef.current ?? undefined });
        callbacks.current.onUnauthorized?.();
        return;
      default:
        blockedRef.current = true;
        setStatus({ state: 'error', message: `The server did not accept this plan: ${result.errors?.[0]?.message ?? result.message} Your changes are kept in this browser.`, savedAt: null, revision: revisionRef.current ?? undefined });
    }
  }, [scheduleRetry, setStatus, writeCache]);

  const flush = useCallback(async (flushOptions: { keepalive?: boolean } = {}): Promise<void> => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (deletedRef.current || conflictRef.current || blockedRef.current || !isDirty()) return;
    if (inFlightRef.current) {
      // One request at a time; when it finishes, handle() saves the newest document.
      if (flushOptions.keepalive) writeCache();
      return inFlightRef.current;
    }
    const sent = latestRef.current;
    setStatus({ state: 'saving', message: null, savedAt: null, revision: revisionRef.current ?? undefined });
    const request = config.api.savePlan(sent, revisionRef.current, flushOptions).then(result => {
      inFlightRef.current = null;
      handle(sent, result);
    });
    inFlightRef.current = request;
    return request;
  }, [config, handle, isDirty, setStatus, writeCache]);
  useEffect(() => { flushRef.current = flush; }, [flush]);

  const onChange = useCallback((next: PlannerDocument): void => {
    latestRef.current = next;
    if (adoptedRef.current === next) return;
    writeCache();
    if (conflictRef.current || blockedRef.current) return;
    setSaveStatus(previous => (previous.state === 'pending' || previous.state === 'saving' ? previous : { ...previous, state: 'pending', message: previous.state === 'offline' ? previous.message : null }));
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; void flush(); }, config.debounceMs);
  }, [config, flush, writeCache]);

  const core = useDocumentCore({ initialDocument: loaded.document, onChange });
  const { replaceDocument: coreReplace, load, history, documentRef } = core;

  // Initial save (first sign-in or restored browser changes).
  useEffect(() => {
    if (loaded.needsSave) void flush();
    // Only once, for the initial document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Excel import commits are saved by the server; adopt them as an undoable change without re-saving.
  useEffect(() => config.api.onPlanReplaced((document, revision) => {
    clearTimers();
    adoptedRef.current = document;
    revisionRef.current = revision;
    conflictRef.current = false;
    blockedRef.current = false;
    coreReplace(document, 'Import Excel file', { cause: 'replace' });
    latestRef.current = document;
    savedRef.current = document;
    writeCache();
    setStatus({ state: 'saved', message: null, savedAt: new Date().toISOString(), revision });
  }), [config, clearTimers, coreReplace, setStatus, writeCache]);

  useEffect(() => {
    mountedRef.current = true;
    const onPageHide = () => { writeCache(); void flush({ keepalive: true }); };
    const onVisibility = () => { if (window.document.visibilityState === 'hidden') onPageHide(); };
    const onOnline = () => { if (retryRef.current.timer !== null || saveStatus.state === 'offline') { retryRef.current.attempts = 0; void flush(); } };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (deletedRef.current || !isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('online', onOnline);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flush, isDirty, saveStatus.state, writeCache]);

  useEffect(() => () => {
    mountedRef.current = false;
    if (retryRef.current.timer !== null) clearTimeout(retryRef.current.timer);
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; void flushRef.current(); }
  }, []);

  const retrySave = useCallback(() => {
    blockedRef.current = false;
    retryRef.current.attempts = 0;
    if (retryRef.current.timer !== null) { clearTimeout(retryRef.current.timer); retryRef.current.timer = null; }
    void flush();
  }, [flush]);

  const resolveConflict = useCallback((choice: 'reloadServer' | 'keepMine') => {
    void (async () => {
      setStatus({ state: 'saving', message: choice === 'reloadServer' ? 'Loading the saved version…' : 'Saving your version…', savedAt: null, revision: revisionRef.current ?? undefined });
      const result = await config.api.loadPlan();
      if (!result.ok || result.unreadable) {
        setStatus({ state: 'conflict', message: `The saved version could not be loaded (${result.ok ? 'unreadable' : result.message}). Try again.`, savedAt: null, revision: revisionRef.current ?? undefined });
        return;
      }
      clearTimers();
      revisionRef.current = result.revision;
      conflictRef.current = false;
      blockedRef.current = false;
      if (choice === 'reloadServer') {
        const server = result.document ?? freshDocument();
        // Undoable: "Undo" brings back the version that was replaced (and saves it as a new revision).
        adoptedRef.current = server;
        coreReplace(server, 'Load saved version', { cause: 'replace' });
        latestRef.current = server;
        savedRef.current = result.document ? server : null;
        writeCache();
        setStatus({ state: 'saved', message: 'Loaded the most recently saved version.', savedAt: result.updatedAt, revision: result.revision ?? undefined });
        if (!result.document) void flush();
      } else {
        // Keep mine: save it on top of the newest server revision.
        savedRef.current = null;
        await flush();
      }
    })();
  }, [config, clearTimers, coreReplace, flush, setStatus, writeCache]);

  const importText = useCallback((text: string): Result<PlannerDocument> => {
    const { result, repairs } = importDocumentDetailed(text);
    if (!result.ok) return result;
    coreReplace(result.value, 'Import', { cause: 'import' });
    if (repairs.length) setStatus({ state: 'pending', message: repairs.join(' '), savedAt: null, revision: revisionRef.current ?? undefined });
    return result;
  }, [coreReplace, setStatus]);

  const replaceDocument = useCallback((next: PlannerDocument, label: string): void => {
    // The Excel import commit was already adopted (same object): nothing more to do.
    if (next === adoptedRef.current && latestRef.current === next) return;
    coreReplace(next, label);
  }, [coreReplace]);

  const exportJson = useCallback((): Result<string> => serializeDocument(documentRef.current), [documentRef]);

  const deleteAllData = useCallback(async (): Promise<SaveResult> => {
    clearTimers();
    const result = await config.api.deleteAccountData();
    if (!result.ok) return { ok: false, notice: `Your data was not deleted: ${result.message}` };
    deletedRef.current = true;
    clearCachedCopy(config.userId, config.cache);
    history.clear();
    const fresh = freshDocument();
    latestRef.current = fresh;
    savedRef.current = fresh;
    load(fresh);
    callbacks.current.onAccountDeleted?.();
    return { ok: true, notice: null };
  }, [config, clearTimers, history, load]);

  const store = useMemo<PlannerStore>(() => ({
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
    retrySave,
    resolveConflict,
  }), [core.document, core.updatePlan, core.dismissDisclaimer, saveStatus, core.history, core.undo, core.markUndoable, importText, replaceDocument, exportJson, deleteAllData, retrySave, resolveConflict]);

  const flushAll = useCallback(async () => {
    await flush();
    if (inFlightRef.current) await inFlightRef.current;
  }, [flush]);

  return { store, flush: flushAll };
}
