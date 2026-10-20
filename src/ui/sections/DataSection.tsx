import { useId, useRef, useState, type ChangeEvent } from 'react';
import type { SaveStatus } from '../../engine/planner-contracts';
import { usePlanner } from '../PlannerContext';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { TableRegion } from '../common/common';
import type { WorkbookApi, WorkbookPreview } from './dataExchange';
import { WARN_STATES, saveStatusText } from './saveStatusText';
import './data.css';

export { saveStatusText } from './saveStatusText';

/**
 * Save state (US-1001). `live` marks the single announced copy (header), which also offers Retry and
 * the conflict choices; other copies are visual only.
 */
export function SaveStatusBadge({ live = true }: { live?: boolean }) {
  const { store } = usePlanner();
  const status = store.saveStatus;
  const warn = WARN_STATES.has(status.state);
  const canRetry = live && store.retrySave && (status.state === 'error' || status.state === 'offline');
  const conflict = live && status.state === 'conflict' && store.resolveConflict;
  return (
    <div className={warn ? 'save-state save-state--warn' : 'save-state'} data-save-state={status.state}>
      <p className={warn ? 'save-status save-status--warn' : 'save-status'} role={live ? 'status' : undefined}>{saveStatusText(status)}</p>
      {canRetry && <button type="button" className="save-state__action" onClick={() => store.retrySave?.()}>Retry saving</button>}
      {conflict && (
        <span className="save-state__choices" role="group" aria-label="Resolve save conflict">
          <button type="button" className="save-state__action" onClick={() => store.resolveConflict?.('reloadServer')}>Load the newer saved plan</button>
          <button type="button" className="save-state__action" onClick={() => store.resolveConflict?.('keepMine')}>Keep my changes</button>
        </span>
      )}
    </div>
  );
}

/** Your data (account menu dialog): saving state, JSON/Excel export and import, print, deletion. */
export function DataTools({ workbook, signedIn = false }: { workbook?: WorkbookApi; signedIn?: boolean }) {
  const { store } = usePlanner();
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
    setMessage(result.ok ? 'Plan imported. You can undo this import with Undo.' : `Import failed; your current plan is unchanged. ${result.errors.map(error => error.message).join(' ')}`);
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

  async function confirmDeletion() {
    setDeleting(true);
    let result;
    try { result = await store.deleteAllData(); } catch { result = { ok: false, notice: 'Your data could not be deleted. Nothing was removed; please try again.' }; }
    setDeleting(false);
    setConfirmDelete(false);
    setMessage(result.ok
      ? (signedIn ? 'Your DebtNav data was deleted.' : 'The plan saved on this browser was deleted. A new blank plan is ready.')
      : result.notice ?? 'Your data could not be deleted. Nothing was removed; please try again.');
  }

  const status = store.saveStatus;
  return (
    <div id="data" className="data-tools">
      <p className="section-intro">{dataIntroText(signedIn, status)}</p>
      <div className="data-block">
        <h3>Saving</h3>
        <SaveStatusBadge live={false} />
        {status.state === 'conflict' && (
          <p className="field-hint">Another device or tab saved a newer version first. <strong>Load the newer saved plan</strong> replaces what you see here; <strong>Keep my changes</strong> saves your version over it. Use the buttons in the header.</p>
        )}
        {(status.state === 'offline' || status.state === 'error') && (
          <p className="field-hint">Your edits stay on screen. Use <strong>Retry saving</strong> in the header, or export a copy so nothing is lost.</p>
        )}
      </div>

      <div className="data-block">
        <h3>JSON file</h3>
        <div className="button-row">
          <button type="button" onClick={exportPlan}>Export plan (JSON)</button>
          <div className="file-picker">
            <label htmlFor="import-file" className="button-like">Import plan (JSON)</label>
            <input id="import-file" className="visually-hidden-file" type="file" accept="application/json,.json" onChange={onFile} />
          </div>
          <button type="button" onClick={() => window.print()}>Print plan</button>
        </div>
        <p className="field-hint">Importing replaces your whole plan. You can undo it during this session.</p>
      </div>

      <ExcelExchange workbook={workbook} onMessage={setMessage} />

      <div className="data-block">
        <h3>Delete my data</h3>
        <p className="field-hint">
          {signedIn
            ? 'Deletes your saved plan, your DebtNav account record and your sessions from DebtNav\'s servers, and clears DebtNav data cached in this browser. Signing out alone never deletes your plan.'
            : 'Deletes the plan saved on this browser. A plan saved to a DebtNav account is not affected.'}
        </p>
        <div className="button-row">
          <button type="button" className="button-danger" onClick={() => setConfirmDelete(true)}>Delete all my data</button>
        </div>
      </div>
      <p role="status" className="field-hint data-message">{message}</p>

      {confirmDelete && (
        <ConfirmDialog
          title={signedIn ? 'Delete your DebtNav account data?' : 'Delete the plan saved on this browser?'}
          confirmLabel={deleting ? 'Deleting…' : 'Delete all data'}
          destructive
          onCancel={() => { if (!deleting) setConfirmDelete(false); }}
          onConfirm={() => { if (!deleting) void confirmDeletion(); }}
        >
          {signedIn ? (
            <>
              <p>This permanently deletes your saved plan, your DebtNav account record (your Google sign-in link and email address) and all signed-in sessions from DebtNav's servers, and clears DebtNav data cached in this browser. You will be signed out. This cannot be undone and is not part of the Undo history.</p>
              <p>Export a JSON or Excel copy first if you want to keep your plan. Your Google account itself is not affected.</p>
              <p>Deleted data is removed from the live database immediately. Encrypted database backups kept by our hosting provider may still contain it for up to 7 days, after which it is gone; backups are used only for disaster recovery.</p>
            </>
          ) : (
            <p>This permanently removes the plan saved on this browser. Export a backup first if you might want it later. This cannot be undone and is not part of the Undo history. A plan saved to a DebtNav account is not affected.</p>
          )}
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
          <p>DebtNav has saved data that could not be read. Importing will overwrite it permanently.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** "Your data" introduction: says truthfully where the plan is saved (account, this browser, or nowhere). */
export function dataIntroText(signedIn: boolean, status: SaveStatus): string {
  if (signedIn || status.scope === 'account') {
    return 'Your plan is saved to your DebtNav account as you edit, so you can continue on any device. Export a copy as JSON or Excel at any time.';
  }
  const working = status.state === 'saved' || status.state === 'pending' || status.state === 'saving';
  if (status.scope === 'browser') {
    return working
      ? 'Your plan is saved on this browser as you edit. It is not sent to DebtNav\'s servers, so it is not available on other devices; sign in to access it elsewhere. Export a copy as JSON at any time.'
      : 'Your changes are not being saved on this browser right now (see Saving below). Export a copy as JSON to keep them.';
  }
  return working ? 'Your plan is saved as you edit. Export a copy as JSON at any time.' : 'Your changes are not being saved right now. Export a copy as JSON to keep them.';
}

const COUNT_LABELS: [string, string][] = [
  ['schoolYears', 'School years'], ['costs', 'Costs'], ['resources', 'Resources'], ['loans', 'Loans'],
  ['lifeEvents', 'Life events'], ['scenarios', 'Scenarios'], ['scenarioOverrides', 'Scenario changes'], ['customOrder', 'Custom order entries'],
];

/** Excel template, export and import (US-1004/1005). Import: preview → explicit confirm → atomic replace. */
function ExcelExchange({ workbook, onMessage }: { workbook?: WorkbookApi; onMessage(message: string): void }) {
  const { store } = usePlanner();
  const id = useId();
  const [years, setYears] = useState('4');
  const [loans, setLoans] = useState('4');
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [preview, setPreview] = useState<{ fileName: string; value: WorkbookPreview } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  if (!workbook) {
    return (
      <div className="data-block">
        <h3>Excel file</h3>
        <p className="field-hint">Excel needs an account: Excel templates, export and import work only when you sign in with Google. JSON export and import work without an account.</p>
      </div>
    );
  }
  const api = workbook;
  const count = (text: string, max: number) => { const value = Number(text); return Number.isInteger(value) && value >= 1 && value <= max ? value : null; };
  const yearCount = count(years, 20);
  const loanCount = count(loans, 50);

  async function onExcelFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPreview(null);
    setError(null);
    if (!/\.xlsx$/i.test(file.name)) {
      setError(/\.xlsm$/i.test(file.name) ? 'Macro-enabled workbooks (.xlsm) can\'t be imported. Save the file as .xlsx and try again.' : 'Choose an Excel workbook (.xlsx).');
      return;
    }
    setBusy('preview');
    const result = await api.importPreview(file).catch(() => ({ ok: false as const, message: 'The file could not be checked. Check your connection and try again.' }));
    setBusy(null);
    if (!result.ok) { setError(result.message); return; }
    setPreview({ fileName: file.name, value: result.preview });
    requestAnimationFrame(() => previewRef.current?.focus());
  }

  async function commit() {
    if (!preview) return;
    setConfirming(false);
    setBusy('commit');
    const result = await api.importCommit(preview.value.previewId, store.saveStatus.revision ?? null)
      .catch(() => ({ ok: false as const, kind: 'offline' as const, message: 'The import could not be sent. Check your connection and try again.' }));
    setBusy(null);
    if (!result.ok) {
      setError(`Import failed; your current plan is unchanged. ${result.message}`);
      if (result.kind === 'expired' || result.kind === 'invalid') setPreview(null);
      return;
    }
    store.replaceDocument(result.document, 'Import Excel file');
    setPreview(null);
    onMessage(`Imported ${preview.fileName}. Your plan was replaced; you can undo this import with Undo.`);
  }

  const issues = preview?.value.errors ?? [];
  return (
    <div className="data-block">
      <h3>Excel file</h3>
      <fieldset className="data-template">
        <legend>Blank template</legend>
        <div className="data-template__fields">
          <div className="field field--narrow">
            <label htmlFor={`${id}-years`}>School year rows</label>
            <input id={`${id}-years`} type="number" inputMode="numeric" min={1} max={20} value={years} onChange={event => setYears(event.target.value)}
              aria-invalid={yearCount === null || undefined} aria-describedby={`${id}-template-hint`} />
          </div>
          <div className="field field--narrow">
            <label htmlFor={`${id}-loans`}>Loan rows</label>
            <input id={`${id}-loans`} type="number" inputMode="numeric" min={1} max={50} value={loans} onChange={event => setLoans(event.target.value)}
              aria-invalid={loanCount === null || undefined} aria-describedby={`${id}-template-hint`} />
          </div>
          {yearCount !== null && loanCount !== null
            ? <a className="button-like" href={api.templateUrl(yearCount, loanCount)} download>Download blank Excel template</a>
            : <button type="button" disabled>Download blank Excel template</button>}
        </div>
        <p id={`${id}-template-hint`} className="field-hint">Starting rows only (school years 1–20, loans 1–50): you can add more rows in Excel. The Instructions sheet explains every column.</p>
      </fieldset>
      <div className="button-row">
        <a className="button-like" href={api.exportUrl()} download>Export my data (.xlsx)</a>
        <div className="file-picker">
          <label htmlFor={`${id}-import`} className="button-like">Import Excel file</label>
          <input id={`${id}-import`} className="visually-hidden-file" type="file" disabled={busy !== null}
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onExcelFile} />
        </div>
      </div>
      <p className="field-hint">Importing checks the whole file first and shows what it contains. Nothing changes until you confirm, and then the whole plan is replaced (never merged).</p>
      {busy === 'preview' && <p className="updating" role="status">Checking the file…</p>}
      {busy === 'commit' && <p className="updating" role="status">Importing…</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {preview && (
        <div className="excel-preview" ref={previewRef} tabIndex={-1} aria-labelledby={`${id}-preview-heading`} role="region">
          <h4 id={`${id}-preview-heading`}>{issues.length ? `${preview.fileName} can't be imported` : `Ready to import ${preview.fileName}`}</h4>
          {issues.length > 0 ? (
            <>
              <p>Fix {issues.length === 1 ? 'this problem' : `these ${issues.length} problems`} in Excel and import the file again. Your current plan is unchanged.</p>
              <TableRegion label="Excel import problems">
                <table>
                  <caption>Problems by sheet, row and column</caption>
                  <thead><tr><th scope="col">Sheet</th><th scope="col">Row</th><th scope="col">Column</th><th scope="col">Problem</th></tr></thead>
                  <tbody>
                    {issues.map((issue, index) => (
                      <tr key={index}>
                        <td>{issue.sheet || 'Whole file'}</td><td>{issue.row ?? '—'}</td><td>{issue.column ?? '—'}</td><td className="wrap">{issue.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableRegion>
              <div className="button-row"><button type="button" onClick={() => setPreview(null)}>Close</button></div>
            </>
          ) : (
            <>
              <dl className="inline-figures excel-preview__counts" aria-label="Records in the file">
                {COUNT_LABELS.filter(([key]) => preview.value.counts[key] !== undefined).map(([key, label]) => (
                  <div key={key}><dt>{label}</dt><dd>{preview.value.counts[key]}</dd></div>
                ))}
              </dl>
              <p>Importing replaces your whole current plan with this file. You can undo it during this session.</p>
              <div className="button-row">
                <button type="button" className="button-primary" onClick={() => setConfirming(true)} disabled={busy !== null}>Replace my plan with this file</button>
                <button type="button" onClick={() => setPreview(null)} disabled={busy !== null}>Cancel import</button>
              </div>
            </>
          )}
        </div>
      )}
      {confirming && preview && (
        <ConfirmDialog title="Replace your plan with this Excel file?" confirmLabel="Replace my plan" destructive
          onCancel={() => setConfirming(false)} onConfirm={() => { void commit(); }}>
          <p>Your current plan will be replaced by the contents of {preview.fileName}. Nothing is merged. You can undo this during this session with Undo.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
