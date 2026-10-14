/**
 * Revealing fields inside collapsible containers (shared UI contract).
 *
 * `revealField(id)` asks any collapsed container (e.g. a loan card) that holds the field to expand,
 * then focuses and scrolls to the field on the next frame. Containers subscribe with
 * `onRevealRequest` and expand when the requested id belongs to them.
 */
const REVEAL_EVENT = 'debtnav:reveal';

export function revealField(id: string): boolean {
  window.dispatchEvent(new CustomEvent<{ id: string }>(REVEAL_EVENT, { detail: { id } }));
  const focus = () => {
    const field = document.getElementById(id);
    if (!field) return false;
    field.focus();
    field.scrollIntoView?.({ block: 'center' });
    return true;
  };
  // Containers expand synchronously on the event, but React commits on the next render.
  requestAnimationFrame(() => { if (!focus()) setTimeout(focus, 50); });
  return document.getElementById(id) !== null;
}

/** Subscribes to reveal requests. Returns an unsubscribe function (use it as an effect cleanup). */
export function onRevealRequest(listener: (id: string) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<{ id: string }>).detail.id);
  window.addEventListener(REVEAL_EVENT, handler);
  return () => window.removeEventListener(REVEAL_EVENT, handler);
}
