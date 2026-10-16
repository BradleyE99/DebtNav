// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell, DRAWER_QUERY } from './AppShell';
import { NAV_ITEMS } from './navItems';
import { SIDEBAR_PREFERENCE_KEY, readSidebarPreference } from './useSidebarPreference';
import { navigateDashboard } from './navigation';

function Shell() {
  const readDashboard = () => {
    try {
      const id = decodeURIComponent(window.location.hash.slice(1));
      return NAV_ITEMS.some(item => item.id === id) ? id : 'overview';
    } catch { return 'overview'; }
  };
  const [active, setActive] = useState(readDashboard);
  useEffect(() => {
    const sync = () => setActive(readDashboard());
    window.addEventListener('debt-nav:navigate', sync);
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('debt-nav:navigate', sync);
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);
  useEffect(() => { document.getElementById(active + '-heading')?.focus(); }, [active]);
  const item = NAV_ITEMS.find(item => item.id === active)!;
  return (
    <AppShell items={NAV_ITEMS} activeDashboard={active} onDashboardChange={navigateDashboard}
      header={<header><h1>DebtNav</h1></header>} footer={<footer>Footer</footer>}>
      <section id={item.id} aria-labelledby={item.id + '-heading'}>
        <h2 id={item.id + '-heading'} tabIndex={-1}>{item.label} dashboard</h2>
        <button type="button">Inside {item.label}</button>
      </section>
    </AppShell>
  );
}

/** Pretend the viewport matches (or not) the narrow-screen query. */
function mockViewport(narrow: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: narrow && query === DRAWER_QUERY,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const nav = () => screen.getByRole('navigation', { name: 'Planner sections' });
const link = (name: string) => within(nav()).getByRole('link', { name });

beforeEach(() => { localStorage.clear(); window.history.replaceState(null, '', '/'); });
afterEach(() => {
  cleanup();
  // @ts-expect-error test cleanup of the mocked API
  delete window.matchMedia;
  document.documentElement.style.overflow = '';
});

describe('desktop sidebar', () => {
  it('renders every nav item as a link to its section, with the skip link first', () => {
    render(<Shell />);
    for (const item of NAV_ITEMS) expect(link(item.label)).toHaveProperty('hash', `#${item.id}`);
    const focusables = document.querySelectorAll('a[href], button');
    expect(focusables[0]).toHaveProperty('textContent', 'Skip to your plan');
    expect(screen.getByRole('main').id).toBe('main');
  });

  it('collapses and expands with a toggle whose name and aria-expanded reflect the state', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    const toggle = screen.getByRole('button', { name: 'Collapse navigation' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('app-sidebar');
    expect(document.getElementById('app-sidebar')).not.toBeNull();
    await user.click(toggle);
    const expand = screen.getByRole('button', { name: 'Expand navigation' });
    expect(expand).toBe(toggle);
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.shell')?.getAttribute('data-sidebar')).toBe('collapsed');
    // Links keep their accessible names in the rail.
    for (const item of NAV_ITEMS) expect(link(item.label)).toBeTruthy();
    await user.click(expand);
    expect(screen.getByRole('button', { name: 'Collapse navigation' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('remembers the collapsed preference on this device and restores it', async () => {
    const user = userEvent.setup();
    const first = render(<Shell />);
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(localStorage.getItem(SIDEBAR_PREFERENCE_KEY)).toBe('collapsed');
    first.unmount();
    render(<Shell />);
    expect(screen.getByRole('button', { name: 'Expand navigation' }).getAttribute('aria-expanded')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Expand navigation' }));
    expect(localStorage.getItem(SIDEBAR_PREFERENCE_KEY)).toBe('expanded');
  });

  it('falls back to expanded when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    expect(readSidebarPreference()).toBe('expanded');
    render(<Shell />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toBeTruthy();
    spy.mockRestore();
    setSpy.mockRestore();
  });

  it('marks the active section with aria-current="page" and moves it on click (focus goes to the heading)', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    expect(link('Overview').getAttribute('aria-current')).toBe('page');
    expect(nav().querySelectorAll('[aria-current]')).toHaveLength(1);
    await user.click(link('Loans'));
    expect(link('Loans').getAttribute('aria-current')).toBe('page');
    expect(link('Overview').hasAttribute('aria-current')).toBe(false);
    expect(document.getElementById('overview')).toBeNull();
    expect(document.getElementById('school')).toBeNull();
    expect(window.location.hash).toBe('#loans');
    expect(document.activeElement?.id).toBe('loans-heading');
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
    // Still highlighted when collapsed.
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(link('Loans').getAttribute('aria-current')).toBe('page');
  });

  it('restores the initial hash and follows hash changes and browser history', () => {
    window.history.replaceState(null, '', '/#loans');
    render(<Shell />);
    expect(link('Loans').getAttribute('aria-current')).toBe('page');
    act(() => {
      window.history.pushState(null, '', '#repayment');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(link('Repayment').getAttribute('aria-current')).toBe('page');
    act(() => {
      window.history.replaceState(null, '', '#school');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(link('Costs').getAttribute('aria-current')).toBe('page');
    expect(nav().querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  it('ignores malformed hash escapes on initial load', () => {
    window.history.replaceState(null, '', '/#%E0%A4%A');
    render(<Shell />);
    expect(link('Overview').getAttribute('aria-current')).toBe('page');
  });

  it('dismisses a rail tooltip when its scroll container moves or the viewport changes', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    await user.hover(link('Results'));
    expect(document.querySelector('.shell-tooltip')).not.toBeNull();
    fireEvent.scroll(document.getElementById('app-sidebar')!);
    expect(document.querySelector('.shell-tooltip')).toBeNull();
    await user.unhover(link('Results'));
    await user.hover(link('Results'));
    expect(document.querySelector('.shell-tooltip')).not.toBeNull();
    fireEvent(window, new Event('resize'));
    expect(document.querySelector('.shell-tooltip')).toBeNull();
  });

  it('shows a tooltip for rail links on keyboard focus and hover, dismissible with Escape', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    expect(document.querySelector('.shell-tooltip')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    // Keyboard focus (jsdom has no CSS, so tabbing would also visit the hidden drawer Close button).
    act(() => link('Timeline').focus());
    expect(document.activeElement).toBe(link('Timeline'));
    expect(document.querySelector('.shell-tooltip')?.textContent).toBe('Timeline');
    await user.keyboard('{Escape}');
    expect(document.querySelector('.shell-tooltip')).toBeNull();
    await user.hover(link('Results'));
    expect(document.querySelector('.shell-tooltip')?.textContent).toBe('Results');
  });

  it('keeps the active dashboard when the page scrolls', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await user.click(link('Loans'));
    fireEvent.scroll(window);
    expect(link('Loans').getAttribute('aria-current')).toBe('page');
    expect(document.querySelectorAll('main > section')).toHaveLength(1);
    expect(document.getElementById('overview')).toBeNull();
  });
});

describe('narrow-screen drawer', () => {
  beforeEach(() => mockViewport(true));

  it('opens from the Menu button, moves focus in, makes the page inert and locks scrolling', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    const menu = screen.getByRole('button', { name: 'Menu' });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(menu.getAttribute('aria-controls')).toBe('app-sidebar');
    await user.click(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    const dialog = screen.getByRole('dialog', { name: 'Navigation' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close navigation' }));
    expect(document.querySelector('.shell-content')?.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.shell-topbar')?.hasAttribute('inert')).toBe(true);
    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('closes on Escape and returns focus to the Menu button', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    const menu = screen.getByRole('button', { name: 'Menu' });
    await user.click(menu);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menu);
    expect(document.querySelector('.shell-content')?.hasAttribute('inert')).toBe(false);
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('closes on backdrop click and on the Close button, returning focus to the Menu button', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    const menu = screen.getByRole('button', { name: 'Menu' });
    await user.click(menu);
    await user.click(screen.getByTestId('nav-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(menu);
    await user.click(menu);
    await user.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(menu);
  });

  it('closes after choosing a link and moves focus to that section heading', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Scenarios' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement?.id).toBe('scenarios-heading');
    expect(window.location.hash).toBe('#scenarios');
    expect(link('Scenarios').getAttribute('aria-current')).toBe('page');
  });

  it('traps Tab inside the open drawer', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    const close = screen.getByRole('button', { name: 'Close navigation' });
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(link('Your data'));
    await user.tab();
    expect(document.activeElement).toBe(close);
  });

  it('never shows the rail even when the collapsed preference is stored', () => {
    localStorage.setItem(SIDEBAR_PREFERENCE_KEY, 'collapsed');
    render(<Shell />);
    expect(document.querySelector('.shell')?.getAttribute('data-sidebar')).toBe('expanded');
  });
});
