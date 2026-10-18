import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog (account menu tools): rendered at the end of <body>; the rest of the page is inert and
 * hidden from assistive technology while it is open. Focus moves to the title, Tab is trapped, Escape
 * and the Close button close it, and focus returns to the control that opened it.
 */
export function Dialog({ title, children, onClose, className }: { title: string; children: ReactNode; onClose(): void; className?: string }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backdrop = dialogRef.current?.parentElement ?? null;
    const background = Array.from(document.body.children).filter((element): element is HTMLElement =>
      element instanceof HTMLElement && element !== backdrop && !element.inert);
    for (const element of background) { element.inert = true; element.setAttribute('aria-hidden', 'true'); }
    titleRef.current?.focus();
    return () => {
      for (const element of background) { element.inert = false; element.removeAttribute('aria-hidden'); }
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  // Escape closes even when focus was lost (e.g. the focused button disappeared). A nested
  // confirmation handles its own Escape first (defaultPrevented).
  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [onClose]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return;
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return createPortal(
    <div className="dialog-backdrop">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div ref={dialogRef} className={`dialog dialog--wide${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <div className="dialog-head">
          <h2 id={titleId} ref={titleRef} tabIndex={-1}>{title}</h2>
          <button type="button" className="dialog-close" onClick={() => onClose()}>Close<span className="visually-hidden"> {title}</span></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
