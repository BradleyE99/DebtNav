/**
 * Save-status wording (US-1001, optional sign-in). `scope` tells where the plan is saved:
 * 'browser' = this browser only (guest), 'account' = the signed-in user's account on the server.
 * Browser wording never claims the plan is saved when storage is unavailable or a write failed, and
 * account wording says "saved" only after the server confirmed the save.
 */
import type { SaveStatus } from '../../engine/planner-contracts';
import { UNAVAILABLE_NOTICE } from '../../data/storage';

export const BROWSER_SAVED_TEXT = 'Saved on this browser. Sign in to access your plan on other devices.';
export const BROWSER_PENDING_TEXT = 'Saving on this browser…';
export const BROWSER_ERROR_TEXT = 'Your changes could not be saved on this device. Storage may be unavailable or full; export a backup to keep them.';
export const ACCOUNT_SAVED_TEXT = 'Saved to your account.';
export const ACCOUNT_SAVING_TEXT = 'Saving to your account…';
export const ACCOUNT_PENDING_TEXT = 'Changes not yet saved to your account…';

export const WARN_STATES: ReadonlySet<SaveStatus['state']> = new Set<SaveStatus['state']>(['unavailable', 'error', 'paused', 'offline', 'conflict']);

function browserText(status: SaveStatus): string {
  switch (status.state) {
    case 'saved': return status.message ?? BROWSER_SAVED_TEXT;
    case 'pending':
    case 'saving': return status.message ?? BROWSER_PENDING_TEXT;
    case 'unavailable': return status.message ?? UNAVAILABLE_NOTICE;
    case 'error': return status.message ?? BROWSER_ERROR_TEXT;
    case 'paused': return status.message ?? 'Saved data on this browser could not be read, so it was kept untouched and saving is paused. Import a copy or delete the saved data to continue saving.';
    case 'offline':
    case 'conflict': return status.message ?? legacyText(status);
  }
}

function accountText(status: SaveStatus): string {
  switch (status.state) {
    case 'saved': return status.message ?? ACCOUNT_SAVED_TEXT;
    case 'pending': return status.message ?? ACCOUNT_PENDING_TEXT;
    case 'saving': return status.message ?? ACCOUNT_SAVING_TEXT;
    default: return legacyText(status);
  }
}

function legacyText(status: SaveStatus): string {
  switch (status.state) {
    case 'saved': return status.message ?? (status.savedAt ? 'All changes saved.' : 'Your plan is saved as you edit.');
    case 'pending': return status.message ?? 'Unsaved changes…';
    case 'saving': return status.message ?? 'Saving…';
    case 'offline': return status.message ?? 'You\'re offline: your latest changes are not saved yet. DebtNav keeps retrying.';
    case 'conflict': return status.message ?? 'Conflict: your plan was changed on another device or tab. Choose which version to keep.';
    case 'error': return status.message ?? 'Error: your latest changes could not be saved. Try again, or export a copy.';
    case 'unavailable': return status.message ?? 'Saving is unavailable right now. The app still works, but your changes will not be saved. Export a copy.';
    case 'paused': return status.message ?? 'Saved data could not be read, so it was kept untouched and saving is paused. Import a copy or delete the saved data to continue saving.';
  }
}

export function saveStatusText(status: SaveStatus): string {
  if (status.scope === 'browser') return browserText(status);
  if (status.scope === 'account') return accountText(status);
  return legacyText(status);
}
