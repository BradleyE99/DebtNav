/**
 * Guest-to-account transition (replaces the old "device plan" offer). After Google sign-in, a plan
 * that a guest made in this browser (GUEST_PLAN_KEY, including legacy keys) is never uploaded just
 * because authentication succeeded. Instead the user is asked — before the account store mounts, so
 * the first-sign-in auto-create cannot run first:
 * - account has no plan  → "Save this plan to my account" / "Not now — keep it on this browser"
 * - account has a plan   → "Open my account plan" / "Replace my account plan…" (explicit confirmation;
 *   only one plan per account exists, so there is no "save separately"; nothing is ever merged).
 * Replacing saves with the revision that was shown, so a plan changed elsewhere meanwhile is a
 * conflict, never an overwrite. The guest draft is removed only after the server confirmed the copy.
 * Every async result is checked against the account guard and requests go through
 * client.forUser(userId), so a late response can't act after sign-out or land in another account.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlannerDocument, StorageLike } from '../engine/planner-contracts';
import { createDefaultPlan } from '../engine/planner';
import { deleteDocument, importDocument, LEGACY_STORAGE_KEYS, loadDocument, serializeDocument, STORAGE_KEY } from '../data/storage';
import type { ApiClient, ApiUser } from './api';
import type { AccountGuard } from './accountGuard';
import { guestChoiceKey } from './persistence';
import { readCachedCopy } from './useServerPlannerDocument';

export interface PlanSummary { schoolYears: number; loans: number; startDate: string; graduationDate: string; savedAt: string | null }
export interface GuestDraft { document: PlannerDocument; savedAt: string | null; /** Identifies this exact draft by content (a hash; no plan data). */ fingerprint: string }

function browserStorage(): StorageLike | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

/** Small stable string hash (FNV-1a) so the "handled" marker never stores plan data. */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(36);
}

/** JSON with sorted object keys, so equal plans compare equal regardless of key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : item));
}

/** The default plan as it reads back from storage (validation may fill or normalise fields). */
function defaultPlanJson(): string {
  const fresh = { plan: createDefaultPlan(), disclaimerDismissed: false };
  const serialized = serializeDocument(fresh);
  const loaded = serialized.ok ? importDocument(serialized.value) : null;
  return canonical(loaded?.ok ? loaded.value.plan : fresh.plan);
}

/** True when the plan is the untouched starting plan (nothing worth offering). */
export function isDefaultPlan(document: PlannerDocument): boolean {
  return canonical(document.plan) === defaultPlanJson();
}

function storedSavedAt(storage: StorageLike): string | null {
  try {
    let raw = storage.getItem(STORAGE_KEY);
    for (const key of LEGACY_STORAGE_KEYS) {
      if (raw !== null) break;
      raw = storage.getItem(key);
    }
    const savedAt = raw ? (JSON.parse(raw) as { savedAt?: unknown }).savedAt : null;
    return typeof savedAt === 'string' ? savedAt : null;
  } catch {
    return null;
  }
}

/** The guest plan stored in this browser, when it differs from the default plan; otherwise null. */
export function findGuestDraft(storage: StorageLike | undefined = browserStorage()): GuestDraft | null {
  if (!storage) return null;
  const loaded = loadDocument(storage);
  if (!loaded.document || isDefaultPlan(loaded.document)) return null;
  const savedAt = storedSavedAt(storage);
  return { document: loaded.document, savedAt, fingerprint: hash(canonical(loaded.document.plan)) };
}

export function summarizePlan(document: PlannerDocument, savedAt: string | null = null): PlanSummary {
  const { plan } = document;
  return { schoolYears: plan.schoolYears.length, loans: plan.loans.length, startDate: plan.settings.startDate, graduationDate: plan.settings.graduationDate, savedAt };
}

/** Whether this user already chose what to do with this exact guest draft. */
export function wasHandled(userId: string, draft: GuestDraft, storage: StorageLike | undefined = browserStorage()): boolean {
  try {
    return storage?.getItem(guestChoiceKey(userId)) === draft.fingerprint;
  } catch {
    return false;
  }
}

/** Remembers the choice for this draft (no plan data is stored). Failure only means we ask again. */
export function markHandled(userId: string, draft: GuestDraft, storage: StorageLike | undefined = browserStorage()): void {
  try {
    storage?.setItem(guestChoiceKey(userId), draft.fingerprint);
  } catch {
    // Not remembered: the question may be asked again next time.
  }
}

/**
 * Whether to ask about the guest draft at all. Unsynced account edits restored from this browser
 * (pending or conflicting) take priority: the account store must resolve those first, so no offer.
 */
export function shouldOffer(userId: string, storage: StorageLike | undefined = browserStorage()): GuestDraft | null {
  const draft = findGuestDraft(storage);
  if (!draft || wasHandled(userId, draft, storage)) return null;
  if (readCachedCopy(storage ?? null, userId)) return null;
  return draft;
}

export type GuestChoiceState =
  | { status: 'checking' }
  /** Nothing to ask (or the choice is made): mount the account app. */
  | { status: 'resolved'; notice: string | null }
  | {
    status: 'offer';
    draft: GuestDraft;
    guest: PlanSummary;
    /** null = the account has no plan yet. */
    account: { revision: number | null; summary: PlanSummary } | null;
    busy: boolean;
    error: string | null;
  }
  | { status: 'loadError'; message: string };

export interface GuestChoiceActions {
  /** Account has no plan: copy the guest plan into it. */
  saveToAccount(): void;
  /** Account has a plan: replace it (only after the user confirmed in the dialog). */
  replaceAccountPlan(): void;
  /** Open the account plan / "Not now": keep the guest draft and don't ask again for it. */
  keepSeparate(): void;
  /** Load failed: try again. */
  retry(): void;
  /** Load failed: continue to the account without copying (asked again next time). */
  skip(): void;
}

export interface GuestChoiceOptions {
  client: ApiClient;
  user: ApiUser;
  guard: AccountGuard;
  /** Session ended ('unauthorized') or the browser switched accounts ('accountChanged'): hand back to the session. */
  onUnauthorized(kind: 'unauthorized' | 'accountChanged'): void;
  storage?: StorageLike;
}

const CONFLICT = 'Your account plan changed while you were deciding, so nothing was replaced. Review the latest account plan below and choose again.';
const EXISTS = 'Your account already has a plan (it was created elsewhere a moment ago), so nothing was replaced. Choose what to do below.';

/** Drives the guest-plan question for one mounted account session. Never uploads without a choice. */
export function useGuestPlanChoice(options: GuestChoiceOptions): GuestChoiceState & GuestChoiceActions {
  const [config] = useState(() => ({
    client: options.client.forUser(options.user.id),
    userId: options.user.id,
    guard: options.guard,
    storage: options.storage ?? browserStorage(),
  }));
  const onUnauthorizedRef = useRef(options.onUnauthorized);
  useEffect(() => { onUnauthorizedRef.current = options.onUnauthorized; });
  const [draft] = useState(() => shouldOffer(config.userId, config.storage));
  const [state, setState] = useState<GuestChoiceState>(() => (draft ? { status: 'checking' } : { status: 'resolved', notice: null }));
  const [attempt, setAttempt] = useState(0);
  const busyRef = useRef(false);

  const live = useCallback(() => config.guard.active(), [config]);

  /** Loads the account plan and shows the offer (optionally with a message). */
  const loadOffer = useCallback(async (current: GuestDraft, error: string | null): Promise<void> => {
    const result = await config.client.loadPlan();
    if (!live()) return;
    if (!result.ok) {
      if (result.kind === 'unauthorized' || result.kind === 'accountChanged') {
        onUnauthorizedRef.current(result.kind);
        return;
      }
      setState({ status: 'loadError', message: result.kind === 'offline' ? 'Your account could not be checked because you appear to be offline. Your plan on this browser is unchanged.' : `${result.message} Your plan on this browser is unchanged.` });
      return;
    }
    if (result.unreadable) {
      // The account plan can't be shown here; the account app explains it. Nothing is copied.
      setState({ status: 'resolved', notice: null });
      return;
    }
    setState({
      status: 'offer',
      draft: current,
      guest: summarizePlan(current.document, current.savedAt),
      account: result.document ? { revision: result.revision, summary: summarizePlan(result.document, result.updatedAt) } : null,
      busy: false,
      error,
    });
  }, [config, live]);

  useEffect(() => {
    if (!draft) return;
    // State changes only after the request answers (never synchronously inside the effect).
    void Promise.resolve().then(() => loadOffer(draft, null));
  }, [draft, loadOffer, attempt]);

  const upload = useCallback(async (baseRevision: number | null) => {
    if (!draft || busyRef.current || !live()) return;
    busyRef.current = true;
    setState(previous => (previous.status === 'offer' ? { ...previous, busy: true, error: null } : previous));
    try {
      const result = await config.client.savePlan(draft.document, baseRevision);
      if (!live()) return;
      if (result.ok) {
        // The server confirmed the copy: only now remove the guest draft from this browser.
        markHandled(config.userId, draft, config.storage);
        const removed = deleteDocument(config.storage);
        setState({ status: 'resolved', notice: removed.ok ? null : 'Your plan was saved to your account, but the copy on this browser could not be removed.' });
        return;
      }
      if (result.kind === 'unauthorized' || result.kind === 'accountChanged') {
        onUnauthorizedRef.current(result.kind);
        return;
      }
      if (result.kind === 'conflict') {
        await loadOffer(draft, baseRevision === null ? EXISTS : CONFLICT);
        return;
      }
      const message = result.kind === 'offline'
        ? 'You appear to be offline, so your plan was not saved to your account. Nothing was changed. Try again when you are back online.'
        : `${result.message} Nothing was changed in your account or on this browser.`;
      setState(previous => (previous.status === 'offer' ? { ...previous, busy: false, error: message } : previous));
    } finally {
      busyRef.current = false;
    }
  }, [config, draft, live, loadOffer]);

  const saveToAccount = useCallback(() => {
    if (state.status !== 'offer' || state.account !== null) return;
    void upload(null);
  }, [state, upload]);

  const replaceAccountPlan = useCallback(() => {
    if (state.status !== 'offer' || state.account === null) return;
    void upload(state.account.revision);
  }, [state, upload]);

  const keepSeparate = useCallback(() => {
    if (!draft || busyRef.current || !live()) return;
    markHandled(config.userId, draft, config.storage);
    setState({ status: 'resolved', notice: null });
  }, [config, draft, live]);

  const retry = useCallback(() => {
    setState({ status: 'checking' });
    setAttempt(value => value + 1);
  }, []);

  const skip = useCallback(() => setState({ status: 'resolved', notice: null }), []);

  return { ...state, saveToAccount, replaceAccountPlan, keepSeparate, retry, skip };
}
