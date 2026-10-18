import { useEffect, useRef } from 'react';

/** US-103: shown on first visit; dismissible; re-openable from the footer. */
export function Disclaimer({ onDismiss, focusOnOpen }: { onDismiss(): void; focusOnOpen: boolean }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focusOnOpen) headingRef.current?.focus(); }, [focusOnOpen]);
  return (
    <aside className="disclaimer" aria-labelledby="disclaimer-heading">
      <h2 id="disclaimer-heading" ref={headingRef} tabIndex={-1}>Estimates, not financial advice</h2>
      <p>DebtNav shows estimates based on what you enter and on simplified rules: simple interest (actual days ÷ 365) in school and grace, monthly interest during repayment, and half-up rounding to cents. Real servicers may use daily interest, different payment application, and rules that change. Borrowing gaps are calculations, not recommendations — you decide what to borrow.</p>
      <p>Your plan is sent only to DebtNav's server, which saves it to your account so you can continue on any device. It is not shared with analytics, advertising or AI services. You can export or delete it under Account → Your data.</p>
      <button type="button" className="button-primary" onClick={onDismiss}>I understand</button>
    </aside>
  );
}
