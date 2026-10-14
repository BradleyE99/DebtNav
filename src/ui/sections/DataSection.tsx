import { useState, type ChangeEvent } from 'react';
import type { SaveStatus } from '../../engine/planner-contracts';
import { usePlanner } from '../PlannerContext';
import { ConfirmDialog } from '../common/ConfirmDialog';

export function saveStatusText(status: SaveStatus): string {
  switch (status.state) {
    case 'saved': return status.message ?? (status.savedAt ? 'All changes saved on this device.' : 'Your plan is saved on this device as you edit.');
    case 'pending': return 'Saving…';
    case 'unavailable': return status.message ?? 'Browser storage is unavailable (for example, in private browsing). The app still works, but your changes will not be saved. Export a backup.';
    case 'error': return status.message ?? 'Your latest changes could not be saved. Export a backup.';
    case 'paused': return status.message ?? 'Saved data on this device could not be read, so it was kept untouched and autosave is paused. Import a backup or delete the saved data to continue saving.';
  }
}

/** `live` marks the single announced copy (header); other copies are visual only (m7). */
export function SaveStatusBadge({ live = true }: { live?: boolean }) {
  const { store } = usePlanner();
  const status = store.saveStatus;
  const warn = status.state === 'unavailable' || status.state === 'error' || status.state === 'paused';
  return <p className={warn ? 'save-status save-status--warn' : 'save-status'} role={live ? 'status' : undefined}>{saveStatusText(status)}</p>;
}

export function DataSection() {
  const { store } = usePlanner();
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingImport, setPendingImport] = useState<string | null>(null);

  function exportPlan() {
    const result = store.exportJson();
    if (!result.ok) { setMessage(result.errors[0]?.message ?? 'Export failed.'); return; }
    const url = URL.createObjectURL(new Blob([result.value], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `debtnav-plan-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage('Plan exported as a JSON file.');
  }

  function applyImport(text: string) {
    const result = store.importText(text);
    setMessage(result.ok ? 'Plan imported. You can undo this import.' : `Import failed; your current plan is unchanged. ${result.errors.map(error => error.message).join(' ')}`);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    let text: string;
    try { text = await file.text(); } catch { setMessage('Could not read that file. Your current plan is unchanged.'); return; }
    if (store.saveStatus.state === 'paused') setPendingImport(text);
    else applyImport(text);
  }

  return (
    <section id="data" className="panel" aria-labelledby="data-heading">
      <h2 id="data-heading">Your data, on your device</h2>
      <p className="section-intro">No account and no server: your plan lives in this browser. Export a backup before clearing browser data or switching devices.</p>
      <SaveStatusBadge live={false} />
      <div className="button-row">
        <button type="button" onClick={exportPlan}>Export plan (JSON)</button>
        <div className="file-picker">
          <label htmlFor="import-file" className="button-like">Import plan (JSON)</label>
          <input id="import-file" className="visually-hidden-file" type="file" accept="application/json,.json" onChange={onFile} />
        </div>
        <button type="button" onClick={() => window.print()}>Print plan</button>
        <button type="button" className="button-danger" onClick={() => setConfirmDelete(true)}>Delete all my data</button>
      </div>
      <p role="status" className="field-hint">{message}</p>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete all DebtNav data?"
          confirmLabel="Delete all data"
          destructive
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            const result = store.deleteAllData();
            setConfirmDelete(false);
            setMessage(result.ok ? 'All DebtNav data was deleted from this device. A new blank plan is ready.' : result.notice ?? 'Could not delete saved data.');
          }}
        >
          <p>This permanently removes your saved plan from this browser. Export a backup first if you might want it later. This cannot be undone.</p>
        </ConfirmDialog>
      )}
      {pendingImport !== null && (
        <ConfirmDialog
          title="Replace preserved saved data?"
          confirmLabel="Import and replace"
          destructive
          onCancel={() => { setPendingImport(null); setMessage('Import cancelled. The preserved saved data was not changed.'); }}
          onConfirm={() => { const text = pendingImport; setPendingImport(null); applyImport(text); }}
        >
          <p>This device has saved DebtNav data that could not be read. Importing will overwrite it permanently.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
