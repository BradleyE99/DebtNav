import { useId, useState } from 'react';
import type { PlannerStore, UndoEntry, UndoHistory as UndoHistoryState } from '../../engine/planner-contracts';
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
 * US-904 persistent undo: a stable control that never disappears on a timer or after later edits.
 * Undo is newest-first (LIFO); the history list shows what can still be undone in this session.
 * Account deletion is never part of this history.
 */
export function UndoHistory({ store }: { store: PlannerStore }) {
  const history = historyOf(store);
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const panelId = useId();
  const entries = history.entries;
  const newest: UndoEntry | undefined = entries[entries.length - 1];

  function undo() {
    if (!history.canUndo || !newest) return;
    history.undo();
    setAnnouncement(`Undone: ${newest.label}.`);
  }

  return (
    <div className="undo-control" role="group" aria-label="Undo">
      <button type="button" className="undo-control__undo" onClick={undo} disabled={!history.canUndo}
        aria-describedby={`${panelId}-state`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        </svg>
        Undo
      </button>
      <span id={`${panelId}-state`} className="undo-control__state">
        {history.canUndo && newest ? <>Last change: {newest.label}</> : 'Nothing to undo'}
      </span>
      <button type="button" className="link-button undo-control__toggle" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(value => !value)}>
        History ({entries.length})
      </button>
      <div id={panelId} className="undo-control__panel" hidden={!open}>
        {entries.length === 0 ? (
          <p className="field-hint">No changes to undo in this session yet. Changes you make appear here until you undo them, clear the list, or end the session.</p>
        ) : (
          <>
            <p className="field-hint">Newest first. Undo reverses the newest change each time and saves the result.</p>
            <ol className="undo-control__list" reversed>
              {[...entries].reverse().map((entry, index) => (
                <li key={entry.id} aria-current={index === 0 ? 'step' : undefined}>
                  <span>{entry.label}</span>
                  {entry.at && <time dateTime={entry.at} className="subtle">{timeText(entry.at)}</time>}
                </li>
              ))}
            </ol>
            <button type="button" onClick={() => { history.clear(); setAnnouncement('Undo history cleared. Your plan was not changed.'); }}>
              Clear history
            </button>
          </>
        )}
        <p className="field-hint">Deleting your data is not part of this history and can't be undone.</p>
      </div>
      <p className="visually-hidden" role="status">{announcement}</p>
    </div>
  );
}
