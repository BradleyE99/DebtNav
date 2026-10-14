import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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

/**
 * Modal confirmation: rendered at the end of <body>; the rest of the page is made inert and hidden
 * from assistive technology while it is open. Focus moves in, Tab is trapped, Escape cancels, and
 * focus is restored on close.
 */
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel = 'Cancel', destructive, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backdrop = dialogRef.current?.parentElement ?? null;
    const background = Array.from(document.body.children).filter((element): element is HTMLElement =>
      element instanceof HTMLElement && element !== backdrop && !element.inert);
    for (const element of background) { element.inert = true; element.setAttribute('aria-hidden', 'true'); }
    cancelRef.current?.focus();
    return () => {
      for (const element of background) { element.inert = false; element.removeAttribute('aria-hidden'); }
      if (previous?.isConnected) previous.focus();
    };
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

  return createPortal(
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
    </div>,
    document.body,
  );
}
