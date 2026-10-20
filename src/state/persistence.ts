/**
 * Shared persistence contract for optional sign-in. Guests keep their plan in this browser only
 * (GUEST_PLAN_KEY, the same key and envelope as the original local planner, so import/export and
 * legacy drafts keep working). Signed-in users save to their account; the account cache holds unsynced
 * account edits for that user only and is removed on sign-out.
 */
import { STORAGE_KEY } from '../data/storage';
import type { StorageLike } from '../engine/planner-contracts';
import type { ApiUser } from './api';

export const GUEST_PLAN_KEY = STORAGE_KEY;
export const accountCacheKey = (userId: string): string => `debtnav.cache.${userId}`;
/** Records that the guest-plan offer was handled for this account (no plan data). */
export const guestChoiceKey = (userId: string): string => `debtnav.guestChoice.${userId}`;
export const legacyDismissKey = (userId: string): string => `debtnav.devicePlanDismissed.${userId}`;

export type GuestReason = 'signedOut' | 'notConfigured' | 'authUnavailable' | 'accountUnavailable';
export type PersistenceMode =
  | { kind: 'checking' }
  | { kind: 'guest'; reason: GuestReason }
  | { kind: 'account'; user: ApiUser; epoch: number };

function resolve(storage?: StorageLike): StorageLike | null {
  try {
    return storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  } catch {
    return null;
  }
}

/** Removes this user's account-specific keys. Never touches GUEST_PLAN_KEY or other users' keys. */
export function clearAccountCaches(userId: string, storage?: StorageLike): { ok: boolean } {
  const target = resolve(storage);
  if (!target) return { ok: true };
  try {
    target.removeItem(accountCacheKey(userId));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
