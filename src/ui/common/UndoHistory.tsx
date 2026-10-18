import { useId, useState } from 'react';
import type { PlannerStore, UndoEntry, UndoHistory as UndoHistoryState } from '../../engine/planner-contracts';
import { ShellIcon } from '../nav/icons';
import './undo.css';

const EMPTY: UndoHistoryState = { entries: [], canUndo: false, undo: () => {}, clear: () => {} };

/** The store's history, or an empty one for stores that predate it (keeps PlannerApp store-agnostic). */
export function historyOf(store: PlannerStore): UndoHistoryState {
  if (store.history) return store.history;
  if (!store.undo) return EMPTY;
  const legacy = store.undo;
  return { entries: [{ id: 'legacy', label: legacy.label, at: '' }], canUndo: true, undo: () => legacy.apply(), clear: () => {} };
}

const timeText = (at: string): string => {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

/**
 * US-904 persistent undo: a compact header button that never disappears on a timer or after later
 * edits, disabled when nothing can be undone. Undo is newest-first (LIFO). The full history list is in
 * the account menu (UndoHistoryPanel).
 */
export function UndoHistory({ store }: { store: PlannerStore }) {
  const history = historyOf(store);
  const [announcement, setAnnouncement] = useState('');
  const stateId = useId();
  const newest: UndoEntry | undefined = history.entries[history.entries.length - 1];

  function undo() {
    if (!history.canUndo || !newest) return;
    history.undo();
    setAnnouncement(`Undone: ${newest.label}.`);
  }

  return (
    <div className="undo-control" role="group" aria-label="Undo">
      <button type="button" className="undo-control__undo" onClick={undo} disabled={!history.canUndo}
        aria-describedby={stateId} title={history.canUndo && newest ? `Undo: ${newest.label}` : 'Nothing to undo'}>
        <ShellIcon name="undo" size={18} />
        <span className="undo-control__label">Undo</span>
      </button>
      <span id={stateId} className="visually-hidden">
        {history.canUndo && newest ? <>Last change: {newest.label}</> : 'Nothing to undo'}
      </span>
      <p className="visually-hidden" role="status">{announcement}</p>
    </div>
  );
}

/** Undo history (account menu): newest first, Undo and Clear history. */
export function UndoHistoryPanel({ store }: { store: PlannerStore }) {
  const history = historyOf(store);
  const [announcement, setAnnouncement] = useState('');
  const entries = history.entries;
  const newest: UndoEntry | undefined = entries[entries.length - 1];
  return (
    <div className="undo-history">
      {entries.length === 0 ? (
        <p className="field-hint">No changes to undo in this session yet.</p>
      ) : (
        <>
          <p className="field-hint">Newest first. Undo reverses the newest change each time.</p>
          <ol className="undo-control__list" reversed>
            {[...entries].reverse().map((entry, index) => (
              <li key={entry.id} aria-current={index === 0 ? 'step' : undefined}>
                <span>{entry.label}</span>
                {entry.at && <time dateTime={entry.at} className="subtle">{timeText(entry.at)}</time>}
              </li>
            ))}
          </ol>
          <div className="button-row">
            <button type="button" disabled={!history.canUndo} onClick={() => {
              if (!history.canUndo || !newest) return;
              history.undo();
              setAnnouncement(`Undone: ${newest.label}.`);
            }}>Undo latest change</button>
            <button type="button" onClick={() => { history.clear(); setAnnouncement('Undo history cleared. Your plan was not changed.'); }}>
              Clear history
            </button>
          </div>
        </>
      )}
      <p className="field-hint">Deleting your data is not part of this history and can't be undone.</p>
      <p className="visually-hidden" role="status">{announcement}</p>
    </div>
  );
}
