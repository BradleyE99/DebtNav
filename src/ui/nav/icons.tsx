/**
 * Inline stroke icons for the navigation and header (24 × 24 grid, drawn with currentColor).
 * Icons are decorative: every control that shows one also carries a text name.
 */
import type { ReactNode } from 'react';
import type { NavIconName } from './navItems';

export type ShellIconName = NavIconName | 'account' | 'undo' | 'chevron';

const PATHS: Record<ShellIconName, ReactNode> = {
  overview: (<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>),
  costs: (<><path d="M2 9l10-5 10 5-10 5-10-5z" /><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6" /></>),
  loans: (<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 10v4M18 10v4" /></>),
  results: (<><path d="M4 4v16h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></>),
  account: (<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>),
  undo: (<><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>),
  chevron: (<path d="M6 9l6 6 6-6" />),
};

export function ShellIcon({ name, size = 20 }: { name: ShellIconName; size?: number }) {
  return (
    <svg
      className="shell-icon"
      width={size}
      height={size}
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
