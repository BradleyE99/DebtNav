/**
 * Application shell (contract owned by the lead; internals owned by the navigation agent).
 *
 * Props are fixed: PlannerApp passes the page header, an optional banner area (disclaimer, undo),
 * the main content and the footer. The shell renders the navigation for `items` and lays the
 * content out next to it. The skip link and the `<main id="main">` landmark live in the shell.
 *
 * Desktop (> 768 px): a sticky left sidebar beside the content. It collapses to an icon rail and the
 * content column takes the released width; the choice is remembered on this device.
 * Narrow screens (≤ 768 px): a compact sticky top bar with a Menu button that opens the sidebar as a
 * modal off-canvas drawer (backdrop, Escape, focus trap, inert page, scroll lock).
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import type { NavItem } from './navItems';
import { ShellIcon } from './icons';
import { SIDEBAR_ID, Sidebar } from './Sidebar';
import { useActiveSection } from './useActiveSection';
import { useMediaQuery } from './useMediaQuery';
import { useSidebarPreference } from './useSidebarPreference';
import './sidebar.css';

export interface AppShellProps {
  items: readonly NavItem[];
  header: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}

/** Keep in sync with the media queries in sidebar.css. */
export const DRAWER_QUERY = '(max-width: 768px)';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Scrolls to a section and moves focus to its heading (made programmatically focusable if needed). */
export function goToSection(id: string): void {
  const section = document.getElementById(id);
  if (!section) return;
  section.scrollIntoView?.({ block: 'start' });
  if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`);
  const heading = document.getElementById(`${id}-heading`) ?? section.querySelector<HTMLElement>('h1, h2, h3') ?? section;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
}

export function AppShell({ items, header, banner, children, footer }: AppShellProps) {
  const isDrawer = useMediaQuery(DRAWER_QUERY);
  const [collapsed, setCollapsed] = useSidebarPreference();
  const [drawerRequested, setDrawerRequested] = useState(false);
  const [wasDrawer, setWasDrawer] = useState(isDrawer);
  if (wasDrawer !== isDrawer) {
    // Leaving the narrow layout closes the drawer (state adjusted during render, not in an effect).
    setWasDrawer(isDrawer);
    if (!isDrawer) setDrawerRequested(false);
  }
  const drawerOpen = isDrawer && drawerRequested;

  const skipRef = useRef<HTMLAnchorElement>(null);
  const topbarRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  /** Runs once the drawer has closed and the page is interactive again. */
  const afterClose = useRef<(() => void) | null>(null);

  const getTopOffset = useCallback(() => topbarRef.current?.offsetHeight ?? 0, []);
  const [active, selectSection] = useActiveSection(items.map(item => item.id), getTopOffset);

  useEffect(() => {
    if (!drawerOpen) {
      const pending = afterClose.current;
      afterClose.current = null;
      if (pending) pending();
      else if (isDrawer && sidebarRef.current?.contains(document.activeElement)) menuRef.current?.focus();
      else if (!isDrawer && (document.activeElement === closeRef.current || document.activeElement === menuRef.current)) {
        sidebarRef.current?.querySelector<HTMLButtonElement>('.shell-toggle')?.focus();
      }
      return;
    }
    const background = ([skipRef.current, topbarRef.current, contentRef.current] as (HTMLElement | null)[])
      .filter((el): el is HTMLElement => el !== null);
    for (const element of background) element.setAttribute('inert', '');
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      afterClose.current = () => menuRef.current?.focus();
      setDrawerRequested(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      for (const element of background) element.removeAttribute('inert');
      root.style.overflow = previousOverflow;
    };
  }, [drawerOpen, isDrawer]);

  function closeDrawer(then: () => void = () => menuRef.current?.focus()) {
    afterClose.current = then;
    setDrawerRequested(false);
  }

  function onNavigate(id: string, event: MouseEvent<HTMLAnchorElement>) {
    // Let modified clicks (new tab/window) behave natively.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    selectSection(id);
    if (drawerOpen) closeDrawer(() => goToSection(id));
    else goToSection(id);
  }

  function trapTab(event: KeyboardEvent<HTMLDivElement>) {
    if (!drawerOpen || event.key !== 'Tab') return;
    const focusable = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .filter(element => !element.matches('.shell-toggle'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  const railCollapsed = collapsed && !isDrawer;

  return (
    <div className="shell" data-sidebar={railCollapsed ? 'collapsed' : 'expanded'} data-drawer={drawerOpen ? 'open' : 'closed'}>
      <a ref={skipRef} className="skip-link" href="#main">Skip to your plan</a>
      <div ref={topbarRef} className="shell-topbar">
        <button
          type="button"
          ref={menuRef}
          className="shell-menu"
          aria-expanded={drawerOpen}
          aria-controls={SIDEBAR_ID}
          onClick={() => setDrawerRequested(true)}
        >
          <ShellIcon name="menu" />
          <span>Menu</span>
        </button>
        {/* Visual brand only; the page h1 carries the name for assistive technology. */}
        <span className="shell-brand" aria-hidden="true">DebtNav</span>
      </div>
      {drawerOpen && (
        // Pointer convenience only; keyboard users close with Escape or the Close button.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div className="shell-backdrop" data-testid="nav-backdrop" onClick={() => closeDrawer()} />
      )}
      {/* The Tab trap belongs on the modal container (WAI-ARIA dialog pattern). */}
      <div
        ref={sidebarRef}
        id={SIDEBAR_ID}
        className="shell-sidebar"
        role={drawerOpen ? 'dialog' : undefined}
        aria-modal={drawerOpen ? true : undefined}
        aria-label={drawerOpen ? 'Navigation' : undefined}
        onKeyDown={trapTab}
      >
        <Sidebar
          items={items}
          active={active}
          rail={railCollapsed}
          collapsed={railCollapsed}
          onToggle={() => setCollapsed(!collapsed)}
          onClose={() => closeDrawer()}
          onNavigate={onNavigate}
          closeRef={closeRef}
        />
      </div>
      <div ref={contentRef} className="shell-content">
        <div className="app">
          {header}
          {banner}
          <main id="main" tabIndex={-1}>{children}</main>
          {footer}
        </div>
      </div>
    </div>
  );
}
