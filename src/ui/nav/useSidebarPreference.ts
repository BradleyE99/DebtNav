import { useCallback, useState } from 'react';

/**
 * UI preference only (not plan data): whether the desktop sidebar is collapsed on this device.
 * It is deliberately not one of the data layer's plan keys, so "Delete all my data" leaves it alone.
 */
export const SIDEBAR_PREFERENCE_KEY = 'debtnav.ui.sidebar';

export type SidebarPreference = 'expanded' | 'collapsed';

/** Storage can be missing or throw (private modes, disabled storage, SecurityError on access). */
export function readSidebarPreference(): SidebarPreference {
  try {
    return window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY) === 'collapsed' ? 'collapsed' : 'expanded';
  } catch {
    return 'expanded';
  }
}

export function writeSidebarPreference(value: SidebarPreference): void {
  try {
    window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, value);
  } catch {
    // Not remembered on this device; the sidebar still works for this visit.
  }
}

export function useSidebarPreference(): [collapsed: boolean, setCollapsed: (collapsed: boolean) => void] {
  const [collapsed, setState] = useState(() => readSidebarPreference() === 'collapsed');
  const setCollapsed = useCallback((next: boolean) => {
    setState(next);
    writeSidebarPreference(next ? 'collapsed' : 'expanded');
  }, []);
  return [collapsed, setCollapsed];
}
