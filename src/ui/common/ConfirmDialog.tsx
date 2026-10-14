import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm(): void;
  /** Called on Cancel or Escape. Focus returns to the element that was focused when the dialog opened. */
  onCancel(): void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal confirmation: focus moves in, Tab is trapped, Escape cancels, focus is restored on close. */
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel = 'Cancel', destructive, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return (
    <div className="dialog-backdrop">
      {/* Keyboard handling (Escape, focus trap) belongs on the dialog container per the WAI-ARIA dialog pattern. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={dialogRef}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>{title}</h2>
        <div id={bodyId}>{children}</div>
        <div className="dialog-actions">
          <button type="button" ref={cancelRef} onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className={destructive ? 'button-danger' : 'button-primary'} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
