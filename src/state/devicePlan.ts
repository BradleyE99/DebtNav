/**
 * Explicit migration of a plan saved in this browser before accounts existed (key `debtnav.plan`).
 * After sign-in the user is offered "Use my device plan"; nothing is attached automatically, so a
 * plan left on a shared computer never lands in someone else's account without their choice.
 * Accepting replaces the account plan (undoable) and removes the device copy; dismissing is
 * remembered per user and keeps the device copy.
 */
import { useCallback, useMemo, useState } from 'react';
import type { PlannerDocument, PlannerStore, StorageLike } from '../engine/planner-contracts';
import { deleteDocument, loadDocument } from '../data/storage';

export interface DevicePlanSummary { loans: number; schoolYears: number; savedAt: string | null }
export interface DevicePlanOffer {
  summary: DevicePlanSummary | null;
  busy: boolean;
  error: string | null;
  use(): void;
  dismiss(): void;
}

export const dismissKey = (userId: string): string => `debtnav.devicePlanDismissed.${userId}`;

function browserStorage(): StorageLike | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

function savedAtOf(storage: StorageLike | undefined): string | null {
  try {
    const raw = storage?.getItem('debtnav.plan') ?? storage?.getItem('debtnav.plan.v2');
    const savedAt = raw ? (JSON.parse(raw) as { savedAt?: unknown }).savedAt : null;
    return typeof savedAt === 'string' ? savedAt : null;
  } catch {
    return null;
  }
}

/** The legacy device plan (validated and migrated), or null. */
export function findDevicePlan(storage: StorageLike | undefined = browserStorage()): { document: PlannerDocument; savedAt: string | null } | null {
  if (!storage) return null;
  const loaded = loadDocument(storage);
  return loaded.document ? { document: loaded.document, savedAt: savedAtOf(storage) } : null;
}

export function useDevicePlanOffer(store: Pick<PlannerStore, 'replaceDocument'> | null, userId: string, storage: StorageLike | undefined = browserStorage()): DevicePlanOffer {
  const [found] = useState(() => {
    try {
      if (!storage || storage.getItem(dismissKey(userId)) === '1') return null;
    } catch {
      return null;
    }
    return findDevicePlan(storage);
  });
  const [state, setState] = useState<{ done: boolean; error: string | null }>({ done: false, error: null });

  const use = useCallback(() => {
    if (!found || !store) return;
    store.replaceDocument(found.document, 'Use my device plan');
    const removed = deleteDocument(storage);
    setState({ done: true, error: removed.ok ? null : 'Your device plan was added to your account, but the copy in this browser could not be removed.' });
  }, [found, store, storage]);

  const dismiss = useCallback(() => {
    try {
      storage?.setItem(dismissKey(userId), '1');
    } catch {
      // Not remembered: the offer may appear again next time.
    }
    setState({ done: true, error: null });
  }, [storage, userId]);

  const summary = useMemo<DevicePlanSummary | null>(() => (found && !state.done
    ? { loans: found.document.plan.loans.length, schoolYears: found.document.plan.schoolYears.length, savedAt: found.savedAt }
    : null), [found, state.done]);

  return { summary, busy: false, error: state.error, use, dismiss };
}
