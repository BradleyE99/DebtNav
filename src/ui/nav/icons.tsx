/**
 * Inline stroke icons for the navigation (24 × 24 grid, drawn with currentColor).
 * Icons are decorative: every control that shows one also carries a text name.
 */
import type { ReactNode } from 'react';
import type { NavIconName } from './navItems';

export type ShellIconName = NavIconName | 'menu' | 'close' | 'collapse' | 'expand';

const PATHS: Record<ShellIconName, ReactNode> = {
  timeline: (<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M7 14h4M7 17h7" /></>),
  costs: (<><path d="M2 9l10-5 10 5-10 5-10-5z" /><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6" /></>),
  loans: (<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 10v4M18 10v4" /></>),
  repayment: (<><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" /><path d="M3 21v-5h5" /></>),
  events: (<><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>),
  scenarios: (<><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7v10M18 10c0 4-4 4-10 7" /></>),
  federal: (<><path d="M3 9l9-5 9 5H3z" /><path d="M5 9v9M9.5 9v9M14.5 9v9M19 9v9M3 21h18" /></>),
  results: (<><path d="M4 4v16h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></>),
  data: (<><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>),
  menu: (<path d="M4 6h16M4 12h16M4 18h16" />),
  close: (<path d="M6 6l12 12M18 6L6 18" />),
  collapse: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M16 9l-3 3 3 3" /></>),
  expand: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M13 9l3 3-3 3" /></>),
};

export function ShellIcon({ name }: { name: ShellIconName }) {
  return (
    <svg
      className="shell-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
