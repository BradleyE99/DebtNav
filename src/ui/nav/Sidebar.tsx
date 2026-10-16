import { useEffect, useRef, useState, type MouseEvent, type Ref } from 'react';
import type { NavItem } from './navItems';
import { ShellIcon } from './icons';

export const SIDEBAR_ID = 'app-sidebar';

interface SidebarProps {
  items: readonly NavItem[];
  active: string;
  /** Desktop icon rail (labels visually hidden, shown as tooltips on hover and keyboard focus). */
  rail: boolean;
  collapsed: boolean;
  onToggle(): void;
  onClose(): void;
  onNavigate(id: string, event: MouseEvent<HTMLAnchorElement>): void;
  closeRef: Ref<HTMLButtonElement>;
  /** Items still needed per dashboard id (readiness missing + invalid); 0 or absent shows no badge. */
  badges?: Partial<Record<string, number>>;
}

const neededText = (count: number) => `${count} item${count === 1 ? '' : 's'} needed`;

interface Tip { text: string; top: number; left: number }

/** Delay before a hover tooltip hides, so the pointer can move onto it (WCAG 1.4.13 hoverable). */
const HIDE_DELAY_MS = 120;

export function Sidebar({ items, active, rail, collapsed, onToggle, onClose, onNavigate, closeRef, badges = {} }: SidebarProps) {
  const [tip, setTip] = useState<Tip | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  const cancelHide = () => window.clearTimeout(hideTimer.current);
  const show = (target: HTMLElement, text: string) => {
    if (!rail) return;
    cancelHide();
    const rect = target.getBoundingClientRect();
    setTip({ text, top: rect.top + rect.height / 2, left: rect.right });
  };
  const hideSoon = () => { cancelHide(); hideTimer.current = window.setTimeout(() => setTip(null), HIDE_DELAY_MS); };
  const hideNow = () => { cancelHide(); setTip(null); };

  // Escape dismisses a visible tooltip without moving focus (WCAG 1.4.13 dismissible).
  useEffect(() => {
    if (!tip) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setTip(null); };
    const dismiss = () => setTip(null);
    document.addEventListener('keydown', onKey);
    // The sidebar itself scrolls at short viewport heights. A viewport-positioned tooltip must not
    // remain behind when its control moves (scroll does not bubble, hence the capture listener).
    document.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [tip]);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const showFor = (event: { currentTarget: HTMLElement }) => show(event.currentTarget, event.currentTarget.dataset.tip ?? '');

  const toggleLabel = collapsed ? 'Expand navigation' : 'Collapse navigation';

  return (
    <>
      <div className="shell-sidebar-head">
        <button
          type="button"
          className="shell-toggle"
          aria-expanded={!collapsed}
          aria-controls={SIDEBAR_ID}
          onClick={() => { hideNow(); onToggle(); }}
          data-tip={toggleLabel}
          onMouseEnter={showFor}
          onMouseLeave={hideSoon}
          onFocus={showFor}
          onBlur={hideNow}
        >
          <ShellIcon name={collapsed ? 'expand' : 'collapse'} />
          <span className="shell-label">{collapsed ? 'Expand' : 'Collapse'}<span className="visually-hidden"> navigation</span></span>
        </button>
        <button type="button" ref={closeRef} className="shell-close" onClick={onClose}>
          <ShellIcon name="close" />
          <span>Close<span className="visually-hidden"> navigation</span></span>
        </button>
      </div>
      <nav className="shell-nav" aria-label="Planner sections" onScroll={hideNow}>
        <ul>
          {items.map(item => {
            const count = badges[item.id] ?? 0;
            const badgeId = `${SIDEBAR_ID}-${item.id}-needed`;
            return (
              <li key={item.id}>
                {/* The count is a description (hidden text referenced by id), not part of the name, so the link keeps its plain label. */}
                <a
                  className="shell-link"
                  href={`#${item.id}`}
                  aria-current={item.id === active ? 'page' : undefined}
                  aria-describedby={count > 0 ? badgeId : undefined}
                  onClick={event => { hideNow(); onNavigate(item.id, event); }}
                  data-tip={count > 0 ? `${item.label} · ${neededText(count)}` : item.label}
                  onMouseEnter={showFor}
                  onMouseLeave={hideSoon}
                  onFocus={showFor}
                  onBlur={hideNow}
                >
                  <ShellIcon name={item.icon} />
                  <span className="shell-label">{item.label}</span>
                  {count > 0 && <span className="shell-badge" aria-hidden="true">{count}</span>}
                </a>
                {count > 0 && <span id={badgeId} hidden>{neededText(count)}</span>}
              </li>
            );
          })}
        </ul>
      </nav>
      {rail && tip && (
        // Decorative duplicate of the control's accessible name; stays open while hovered.
        <div
          className="shell-tooltip"
          aria-hidden="true"
          style={{ top: tip.top, left: tip.left }}
          onMouseEnter={cancelHide}
          onMouseLeave={hideSoon}
        >
          <span>{tip.text}</span>
        </div>
      )}
    </>
  );
}
