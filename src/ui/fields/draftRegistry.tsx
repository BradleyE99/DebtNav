/**
 * Draft registry (shared UI contract).
 *
 * Dashboards unmount when you leave them, and a field's typed text lives in the field. Fields built
 * on useDraftField store text that could not be saved (a parse error or a rejected commit) here, so
 * the draft and its error come back when the dashboard is opened again, and readiness can list it
 * ("A value you typed is not valid yet") while the dashboard is closed. An entry is dropped when its
 * draft becomes valid, or when the field mounts again and the stored value has changed meanwhile.
 */
import { createContext, useContext, useMemo, useRef, useState } from 'react';

export interface DraftEntry {
  text: string;
  error: string;
  /** The stored value the draft was typed against. */
  seenValue: unknown;
}

export interface DraftRegistry {
  get(id: string): DraftEntry | undefined;
  /** Records an invalid draft, or clears it with null. */
  set(id: string, entry: DraftEntry | null): void;
}

const DraftRegistryContext = createContext<DraftRegistry | null>(null);

export const DraftRegistryProvider = DraftRegistryContext.Provider;

export function useDraftRegistry(): DraftRegistry | null {
  return useContext(DraftRegistryContext);
}

/** Owns a registry. Re-renders only when the set of invalid field ids changes, not on every keystroke. */
export function useDraftRegistryState(): { registry: DraftRegistry; invalidFieldIds: readonly string[] } {
  const entries = useRef(new Map<string, DraftEntry>());
  const [invalidFieldIds, setInvalidFieldIds] = useState<readonly string[]>([]);
  const registry = useMemo<DraftRegistry>(() => ({
    get: id => entries.current.get(id),
    set: (id, entry) => {
      const had = entries.current.has(id);
      if (entry) entries.current.set(id, entry); else entries.current.delete(id);
      if (had !== Boolean(entry)) setInvalidFieldIds([...entries.current.keys()].sort());
    },
  }), []);
  return { registry, invalidFieldIds };
}
