import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * After a navigation click, scroll spy stays quiet until the (possibly smooth) scroll ends, so the
 * highlight does not flicker through the sections in between. This is the upper bound; browsers with
 * the scrollend event release the lock as soon as scrolling stops.
 */
const CLICK_LOCK_MS = 1500;

function sectionFromHash(ids: readonly string[]): string | undefined {
  try {
    const id = decodeURIComponent(window.location.hash.slice(1));
    return ids.includes(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Picks the section the reader is in from the live layout: the last section whose top has passed a
 * reading line just below the sticky chrome. At the very bottom of the page the last section wins,
 * so short final sections (e.g. "Your data") can still become active.
 */
export function pickActiveSection(ids: readonly string[], topOffset: number): string | null {
  const sections = ids.map(id => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
  if (!sections.length) return null;
  const doc = document.documentElement;
  const scrolled = window.scrollY > 0;
  const atBottom = scrolled && window.innerHeight + window.scrollY >= doc.scrollHeight - 4;
  if (atBottom) return sections[sections.length - 1].id;
  const line = topOffset + Math.min(160, window.innerHeight * 0.25);
  let active = sections[0].id;
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= line) active = section.id;
  }
  return active;
}

/**
 * Scroll spy. An IntersectionObserver on the section elements (plus a passive scroll listener for the
 * page-bottom case) schedules a recompute on the next animation frame. Where IntersectionObserver is
 * missing (jsdom), clicks and browser history still update the highlight.
 */
export function useActiveSection(ids: readonly string[], getTopOffset: () => number): [active: string, select: (id: string) => void] {
  const [active, setActive] = useState(() => sectionFromHash(ids) ?? ids[0] ?? '');
  const lockUntil = useRef(0);
  const idsKey = ids.join('|');

  useEffect(() => {
    const list = idsKey.split('|');
    if (sectionFromHash(list)) lockUntil.current = performance.now() + CLICK_LOCK_MS;
    let frame = 0;
    const compute = () => {
      frame = 0;
      if (performance.now() < lockUntil.current) return;
      const next = pickActiveSection(list, getTopOffset());
      if (next) setActive(previous => (previous === next ? previous : next));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(compute); };
    const observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(schedule, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] })
      : null;
    for (const id of list) {
      const element = document.getElementById(id);
      if (element) observer?.observe(element);
    }
    const onHistoryChange = () => {
      const id = sectionFromHash(list);
      if (id) {
        // Native hash navigation and Back/Forward can scroll asynchronously, just like link clicks.
        lockUntil.current = performance.now() + CLICK_LOCK_MS;
        setActive(id);
      } else {
        lockUntil.current = 0;
        schedule();
      }
    };
    const onScrollEnd = () => { lockUntil.current = Math.min(lockUntil.current, performance.now() + 50); };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', onHistoryChange);
    window.addEventListener('popstate', onHistoryChange);
    window.addEventListener('scrollend', onScrollEnd);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('hashchange', onHistoryChange);
      window.removeEventListener('popstate', onHistoryChange);
      window.removeEventListener('scrollend', onScrollEnd);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [idsKey, getTopOffset]);

  const select = useCallback((id: string) => {
    lockUntil.current = performance.now() + CLICK_LOCK_MS;
    setActive(id);
  }, []);

  return [active, select];
}
