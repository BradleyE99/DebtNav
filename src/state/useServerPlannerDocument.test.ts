// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPlan } from '../engine/planner';
import type { PlannerDocument, PlannerPlan, StorageLike } from '../engine/planner-contracts';
import { createFakeApi } from './fakeApi';
import { cacheKey, useServerPlanLoad, useServerPlannerDocument, type LoadedPlan, type ServerStoreOptions } from './useServerPlannerDocument';

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}

const setBudget = (value: string) => (plan: PlannerPlan): PlannerPlan => ({ ...plan, postGradIncome: { ...plan.postGradIncome, monthlyDebtBudget: value } });
const docWithBudget = (value: string): PlannerDocument => ({ plan: setBudget(value)(createDefaultPlan()), disclaimerDismissed: true });

async function open(server: ReturnType<typeof createFakeApi>, extra: Partial<ServerStoreOptions> = {}) {
  const options: ServerStoreOptions = { api: server.api, userId: 'user-1', debounceMs: 5, cache: memory(), ...extra };
  const loader = renderHook(() => useServerPlanLoad(options));
  await waitFor(() => expect(loader.result.current.status).not.toBe('loading'));
  const state = loader.result.current;
  if (state.status !== 'ready') throw new Error(`load failed: ${state.status === 'error' ? state.message : ''}`);
  const live = renderHook(() => useServerPlannerDocument(options, state.loaded as LoadedPlan));
  return { live, options, loaded: state.loaded };
}

afterEach(() => { vi.useRealTimers(); });

describe('server store: loading and saving (US-1001)', () => {
  it('first sign-in creates the plan on the server (baseRevision null) and reports saved only after confirmation', async () => {
    const fake = createFakeApi();
    let release!: () => void;
    fake.server.gate = new Promise(resolve => { release = resolve; });
    const { live } = await open(fake);
    await waitFor(() => expect(live.result.current.store.saveStatus.state).toBe('saving'));
    expect(fake.server.revision).toBeNull();
    fake.server.gate = null;
    await act(async () => { release(); });
    await waitFor(() => expect(live.result.current.store.saveStatus).toMatchObject({ state: 'saved', revision: 1 }));
    expect(fake.server.calls).toContain('savePlan:null');
  });

  it('loads an existing plan without saving, then saves edits with the base revision (latest wins, one request in flight)', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    const { live } = await open(fake);
    expect(live.result.current.store.document.plan.postGradIncome.monthlyDebtBudget).toBe('100.00');
    expect(live.result.current.store.saveStatus.state).toBe('saved');
    let release!: () => void;
    fake.server.gate = new Promise(resolve => { release = resolve; });
    act(() => { live.result.current.store.updatePlan(setBudget('200.00')); });
    expect(live.result.current.store.saveStatus.state).toBe('pending');
    await waitFor(() => expect(live.result.current.store.saveStatus.state).toBe('saving'));
    act(() => { live.result.current.store.updatePlan(setBudget('300.00')); });
    act(() => { live.result.current.store.updatePlan(setBudget('400.00')); });
    await new Promise(resolve => setTimeout(resolve, 30));
    // Still one request in flight.
    expect(fake.server.calls.filter(call => call.startsWith('savePlan'))).toEqual(['savePlan:1']);
    fake.server.gate = null;
    await act(async () => { release(); });
    await waitFor(() => expect(live.result.current.store.saveStatus).toMatchObject({ state: 'saved', revision: 3 }));
    expect(fake.server.document?.plan.postGradIncome.monthlyDebtBudget).toBe('400.00');
    expect(fake.server.calls.filter(call => call.startsWith('savePlan'))).toEqual(['savePlan:1', 'savePlan:2']);
  });

  it('offline: shows offline (never saved), keeps an unsynced copy, retries and saves when back', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    const cache = memory();
    const { live } = await open(fake, { cache });
    fake.server.offline = true;
    act(() => { live.result.current.store.updatePlan(setBudget('250.00')); });
    await waitFor(() => expect(live.result.current.store.saveStatus.state).toBe('offline'));
    expect(cache.getItem(cacheKey('user-1'))).toContain('250.00');
    fake.server.offline = false;
    act(() => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(live.result.current.store.saveStatus.state).toBe('saved'));
    expect(fake.server.document?.plan.postGradIncome.monthlyDebtBudget).toBe('250.00');
    expect(cache.getItem(cacheKey('user-1'))).toBeNull();
  });

  it('server errors retry automatically with backoff; Retry saves immediately', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    const { live } = await open(fake);
    fake.server.failWith = 'server';
    act(() => { live.result.current.store.updatePlan(setBudget('260.00')); });
    await waitFor(() => expect(live.result.current.store.saveStatus.state).toBe('offline'));
    act(() => { live.result.current.store.retrySave!(); });
    await waitFor(() => expect(live.result.current.store.saveStatus.state).toBe('saved'));
    expect(fake.server.document?.plan.postGradIncome.monthlyDebtBudget).toBe('260.00');
  });

  it('a 401 stops saving, reports an error and tells the app the session ended', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    const onUnauthorized = vi.fn();
    const { live } = await open(fake, { onUnauthorized });
    fake.server.failWith = 'unauthorized';
    act(() => { live.result.current.store.updatePlan(setBudget('270.00')); });
    await waitFor(() => expect(live.result.current.store.saveStatus.state).toBe('error'));
    expect(onUnauthorized).toHaveBeenCalled();
    expect(fake.server.document?.plan.postGradIncome.monthlyDebtBudget).toBe('100.00');
  });

  it('a restored unsynced copy with the same base revision is saved on load', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    const cache = memory();
    cache.setItem(cacheKey('user-1'), JSON.stringify({ document: docWithBudget('555.00'), baseRevision: 1, at: '2026-10-16T00:00:00Z' }));
    const { live } = await open(fake, { cache });
    expect(live.result.current.store.document.plan.postGradIncome.monthlyDebtBudget).toBe('555.00');
    await waitFor(() => expect(live.result.current.store.saveStatus.state).toBe('saved'));
    expect(fake.server.document?.plan.postGradIncome.monthlyDebtBudget).toBe('555.00');
  });

  it("another user's cached copy is never read (cache is keyed by user id)", async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    const cache = memory();
    cache.setItem(cacheKey('someone-else'), JSON.stringify({ document: docWithBudget('999.00'), baseRevision: 1, at: '2026-10-16T00:00:00Z' }));
    const { live } = await open(fake, { cache });
    expect(live.result.current.store.document.plan.postGradIncome.monthlyDebtBudget).toBe('100.00');
  });
});

describe('server store: conflicts (never a silent overwrite)', () => {
  it('a save based on a stale revision shows conflict; reloadServer adopts the server version (undoable)', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    const { live } = await open(fake);
    fake.server.external(docWithBudget('700.00'));
    act(() => { live.result.current.store.updatePlan(setBudget('150.00')); });
    await waitFor(() => expect(live.result.current.store.saveStatus.state).toBe('conflict'));
    expect(fake.server.document?.plan.postGradIncome.monthlyDebtBudget).toBe('700.00');
    act(() => { live.result.current.store.resolveConflict!('reloadServer'); });
    await waitFor(() => expect(live.result.current.store.saveStatus.state).toBe('saved'));
    expect(live.result.current.store.document.plan.postGradIncome.monthlyDebtBudget).toBe('700.00');
    expect(live.result.current.store.undo?.label).toBe('Load saved version');
    // Undo brings back my version and saves it as a new revision.
    act(() => { live.result.current.store.history.undo(); });
    await waitFor(() => expect(fake.server.document?.plan.postGradIncome.monthlyDebtBudget).toBe('150.00'));
    expect(fake.server.revision).toBe(3);
  });

  it('keepMine saves my version on top of the newest server revision', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    const { live } = await open(fake);
    fake.server.external(docWithBudget('700.00'));
    act(() => { live.result.current.store.updatePlan(setBudget('150.00')); });
    await waitFor(() => expect(live.result.current.store.saveStatus.state).toBe('conflict'));
    act(() => { live.result.current.store.resolveConflict!('keepMine'); });
    await waitFor(() => expect(live.result.current.store.saveStatus).toMatchObject({ state: 'saved', revision: 3 }));
    expect(fake.server.document?.plan.postGradIncome.monthlyDebtBudget).toBe('150.00');
  });

  it('cached edits whose base revision is outdated open in conflict instead of overwriting', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    fake.server.external(docWithBudget('700.00'));
    const cache = memory();
    cache.setItem(cacheKey('user-1'), JSON.stringify({ document: docWithBudget('555.00'), baseRevision: 1, at: '2026-10-16T00:00:00Z' }));
    const { live } = await open(fake, { cache });
    expect(live.result.current.store.saveStatus.state).toBe('conflict');
    expect(fake.server.calls.some(call => call.startsWith('savePlan'))).toBe(false);
  });
});

describe('server store: undo history and replacement (US-904, US-1005)', () => {
  it('undo restores related records and saves the reversal as a new revision', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    const { live } = await open(fake);
    act(() => {
      live.result.current.store.updatePlan(plan => ({ ...plan, loans: [{ id: 'l1', name: 'Loan', type: 'unsubsidized', principal: '100.00', annualRate: '0.05', disbursementDate: plan.settings.startDate, termMonths: 120 }], repayment: { ...plan.repayment, customOrder: ['l1'] } }), { undoLabel: 'Add loan' });
    });
    await waitFor(() => expect(fake.server.revision).toBe(2));
    act(() => { live.result.current.store.updatePlan(plan => ({ ...plan, loans: [] }), { undoLabel: 'Remove loan Loan' }); });
    await waitFor(() => expect(fake.server.revision).toBe(3));
    expect(fake.server.document?.plan.repayment.customOrder).toEqual([]);
    act(() => { live.result.current.store.history.undo(); });
    await waitFor(() => expect(fake.server.revision).toBe(4));
    expect(fake.server.document?.plan.loans.map(loan => loan.id)).toEqual(['l1']);
    expect(fake.server.document?.plan.repayment.customOrder).toEqual(['l1']);
  });

  it('an Excel import commit is adopted as saved (no re-save), is undoable, and replaceDocument with it is a no-op', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    const { live } = await open(fake);
    fake.server.document = docWithBudget('800.00');
    let committed: Awaited<ReturnType<typeof fake.api.importCommit>> | undefined;
    await act(async () => { committed = await fake.api.importCommit('preview-1', live.result.current.store.saveStatus.revision ?? null); });
    expect(committed?.ok).toBe(true);
    if (!committed?.ok) return;
    act(() => { live.result.current.store.replaceDocument(committed!.ok ? committed!.document : docWithBudget('0'), 'Import Excel file'); });
    expect(live.result.current.store.document.plan.postGradIncome.monthlyDebtBudget).toBe('800.00');
    expect(live.result.current.store.saveStatus).toMatchObject({ state: 'saved', revision: 2 });
    expect(live.result.current.store.history.entries.map(entry => entry.label)).toEqual(['Import Excel file']);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(fake.server.calls.filter(call => call.startsWith('savePlan'))).toEqual([]);
    act(() => { live.result.current.store.history.undo(); });
    await waitFor(() => expect(fake.server.revision).toBe(3));
    expect(fake.server.document?.plan.postGradIncome.monthlyDebtBudget).toBe('100.00');
  });
});

describe('server store: account deletion (US-1003)', () => {
  it('deletes server data, clears the cache and history, and reports the account as deleted', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    const cache = memory();
    const onAccountDeleted = vi.fn();
    const { live } = await open(fake, { cache, onAccountDeleted });
    fake.server.offline = true;
    act(() => { live.result.current.store.updatePlan(setBudget('123.00')); });
    await waitFor(() => expect(cache.getItem(cacheKey('user-1'))).not.toBeNull());
    fake.server.offline = false;
    let outcome!: { ok: boolean };
    await act(async () => { outcome = await live.result.current.store.deleteAllData(); });
    expect(outcome.ok).toBe(true);
    expect(fake.server.deleted).toBe(true);
    expect(cache.getItem(cacheKey('user-1'))).toBeNull();
    expect(live.result.current.store.history.canUndo).toBe(false);
    expect(onAccountDeleted).toHaveBeenCalled();
  });

  it('a failed deletion keeps everything and says so', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    const onAccountDeleted = vi.fn();
    const { live } = await open(fake, { onAccountDeleted });
    fake.server.failWith = 'server';
    let outcome!: { ok: boolean; notice: string | null };
    await act(async () => { outcome = await live.result.current.store.deleteAllData(); });
    expect(outcome.ok).toBe(false);
    expect(outcome.notice).toMatch(/not deleted/);
    expect(onAccountDeleted).not.toHaveBeenCalled();
    expect(fake.server.document).not.toBeNull();
  });
});
