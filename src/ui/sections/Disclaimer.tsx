import { useEffect, useRef } from 'react';

/** US-103: shown on first visit; dismissible; re-openable from the footer. */
export function Disclaimer({ onDismiss, focusOnOpen }: { onDismiss(): void; focusOnOpen: boolean }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focusOnOpen) headingRef.current?.focus(); }, [focusOnOpen]);
  return (
    <aside className="disclaimer" aria-labelledby="disclaimer-heading">
      <h2 id="disclaimer-heading" ref={headingRef} tabIndex={-1}>Estimates, not financial advice</h2>
      <p>DebtNav shows estimates based on what you enter and on simplified rules: simple interest (actual days ÷ 365) in school and grace, monthly interest during repayment, and half-up rounding to cents. Real servicers may use daily interest, different payment application, and rules that change. Borrowing gaps are calculations, not recommendations — you decide what to borrow.</p>
      <p>Your plan stays in this browser. Nothing you enter is sent anywhere unless you use the optional College Scorecard lookup, which sends only a school name and year.</p>
      <button type="button" className="button-primary" onClick={onDismiss}>I understand</button>
    </aside>
  );
}
