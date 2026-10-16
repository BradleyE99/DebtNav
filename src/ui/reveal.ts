/** Reveal a field across dashboards, school-year selectors, and collapsed editors. */
const REVEAL_EVENT = 'debtnav:reveal';

export function revealField(id: string): boolean {
  const request = () => window.dispatchEvent(new CustomEvent<{ id: string }>(REVEAL_EVENT, { detail: { id } }));
  request();
  // Dashboard selection commits first; the next request reaches newly mounted containers.
  let attempts = 0;
  const focus = () => {
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
