/** Reveal a field across dashboards, school-year selectors, and collapsed editors. */
const REVEAL_EVENT = 'debtnav:reveal';

/** Only the newest reveal keeps retrying, so two reveals never fight over focus. */
let currentReveal = 0;

export function revealField(id: string): boolean {
  const request = () => window.dispatchEvent(new CustomEvent<{ id: string }>(REVEAL_EVENT, { detail: { id } }));
  request();
  // Dashboard selection commits first; the next request reaches newly mounted containers.
  const reveal = ++currentReveal;
  let attempts = 0;
  const focus = () => {
    // Stop if a newer reveal started or the page is gone (e.g. a test environment torn down mid-retry).
    if (reveal !== currentReveal || typeof window === 'undefined' || typeof document === 'undefined') return;
    request();
    const field = document.getElementById(id);
    if (field && !field.closest('[hidden]')) {
      let parent = field.parentElement;
      while (parent) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
      field.focus();
      field.scrollIntoView?.({ block: 'center' });
      if (document.activeElement === field) return;
    }
    if (++attempts < 8) setTimeout(focus, 30);
  };
  requestAnimationFrame(focus);
  return document.getElementById(id) !== null || /^(loans|schoolYears|lifeEvents|settings|postGradIncome|repayment|scenarios|federal|borrower)\./.test(id);
}

/** Subscribes to reveal requests. Returns an effect cleanup function. */
export function onRevealRequest(listener: (id: string) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<{ id: string }>).detail.id);
  window.addEventListener(REVEAL_EVENT, handler);
  return () => window.removeEventListener(REVEAL_EVENT, handler);
}
