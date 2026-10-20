/**
 * Asks before signing out while account edits are not saved to the account (pending, offline, failed
 * or conflicting). Escape and "Stay signed in" keep the user signed in with every edit intact.
 */
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Result } from '../../engine/contracts';
import type { SignOutDecision } from '../../state/signOut';
import { ConfirmDialog } from '../common/ConfirmDialog';

export const SIGN_OUT_UNSAVED_TITLE = 'You have changes not saved to your account.';

export interface SignOutDialogProps {
  onSignOutAnyway(): void;
  onStay(): void;
  onExport(): void;
  /** Result of the last export attempt, announced in the dialog. */
  exportMessage?: string | null;
}

export function SignOutDialog({ onSignOutAnyway, onStay, onExport, exportMessage }: SignOutDialogProps) {
  return (
    <ConfirmDialog
      title={SIGN_OUT_UNSAVED_TITLE}
      confirmLabel="Sign out anyway"
      cancelLabel="Stay signed in"
      destructive
      onConfirm={onSignOutAnyway}
      onCancel={onStay}
    >
      <p>Your latest changes could not be saved to your account. If you sign out now, they are discarded and your account keeps its last saved plan. Nothing is copied to this browser&apos;s guest plan.</p>
      <p>Export a copy first to keep them, or stay signed in and try saving again.</p>
      <p><button type="button" onClick={onExport}>Export a copy</button></p>
      <p role="status" aria-live="polite">{exportMessage ?? ''}</p>
    </ConfirmDialog>
  );
}

/** Downloads the plan JSON as a file. Returns a message describing the result. */
export function downloadPlanJson(exportJson: () => Result<string>): string {
  const result = exportJson();
  if (!result.ok) return `Export failed. ${result.errors[0]?.message ?? ''}`.trim();
  const url = URL.createObjectURL(new Blob([result.value], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `debtnav-plan-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return 'Plan exported as a JSON file. You can import it later as a guest or after signing in.';
}

/**
 * Promise-based confirmation for signOutFlow: render `dialog`, pass `confirmUnsaved` as
 * SignOutFlowOptions.confirmUnsaved. Export downloads a copy and keeps the dialog open.
 */
export function useSignOutConfirm(options: { exportJson(): Result<string> }): { confirmUnsaved(): Promise<SignOutDecision>; dialog: ReactNode } {
  const [open, setOpen] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const resolver = useRef<((decision: SignOutDecision) => void) | null>(null);
  const exportRef = useRef(options.exportJson);
  useLayoutEffect(() => { exportRef.current = options.exportJson; }, [options.exportJson]);

  const confirmUnsaved = useCallback(() => new Promise<SignOutDecision>(resolve => {
    resolver.current?.('stay');
    resolver.current = resolve;
    setExportMessage(null);
    setOpen(true);
  }), []);

  const finish = (decision: SignOutDecision) => {
    const resolve = resolver.current;
    resolver.current = null;
    setOpen(false);
    resolve?.(decision);
  };

  const dialog = open ? (
    <SignOutDialog
      onSignOutAnyway={() => finish('signOutAnyway')}
      onStay={() => finish('stay')}
      onExport={() => setExportMessage(downloadPlanJson(() => exportRef.current()))}
      exportMessage={exportMessage}
    />
  ) : null;

  return { confirmUnsaved, dialog };
}
