/**
 * Application shell: page header, the four destination tabs, banner, main content and footer.
 *
 * The tabs are a `nav` of links (`aria-current="page"` on the active one). They stay a single row on
 * every width: labels shorten on narrow screens and the row scrolls inside itself, never the page.
 * The skip link and the `<main id="main">` landmark live in the shell.
 */
import type { MouseEvent, ReactNode } from 'react';
import type { NavItem } from './navItems';
import { ShellIcon } from './icons';
import { navigateDashboard } from './navigation';
import './tabs.css';

export interface AppShellProps {
  items: readonly NavItem[];
  activeDashboard: string;
  onDashboardChange?(id: string): void;
  header: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  /** Per-dashboard count of items still needed, shown as tab badges. */
  badges?: Partial<Record<string, number>>;
}

const neededText = (count: number) => `${count} item${count === 1 ? '' : 's'} needed`;

export function AppShell({ items, header, banner, children, footer, activeDashboard, onDashboardChange, badges = {} }: AppShellProps) {
  function onNavigate(id: string, event: MouseEvent<HTMLAnchorElement>) {
    // Let modified clicks (new tab/window) behave natively.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (onDashboardChange) onDashboardChange(id);
    else navigateDashboard(id);
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main" onClick={event => {
        event.preventDefault();
        const main = document.getElementById('main');
        main?.focus({ preventScroll: true });
        main?.scrollIntoView?.({ block: 'start' });
      }}>Skip to your plan</a>
      <div className="app">
        {header}
        <nav className="tabs" aria-label="Planner sections">
          <ul>
            {items.map(item => {
              const count = badges[item.id] ?? 0;
              const badgeId = `tab-${item.id}-needed`;
              return (
                <li key={item.id}>
                  {/* The count is a description (hidden text referenced by id), not part of the name. */}
                  <a
                    className="tab"
                    href={`#${item.id}`}
                    aria-current={item.id === activeDashboard ? 'page' : undefined}
                    aria-describedby={count > 0 ? badgeId : undefined}
                    onClick={event => onNavigate(item.id, event)}
                  >
                    <ShellIcon name={item.icon} />
                    <span className="tab-label">{item.label}</span>
                    <span className="tab-label tab-label--short" aria-hidden="true">{item.short}</span>
                    {count > 0 && <span className="tab-badge" aria-hidden="true">{count}</span>}
                  </a>
                  {count > 0 && <span id={badgeId} hidden>{neededText(count)}</span>}
                </li>
              );
            })}
          </ul>
        </nav>
        {banner}
        <main id="main" tabIndex={-1}>{children}</main>
        {footer}
      </div>
    </div>
  );
}
