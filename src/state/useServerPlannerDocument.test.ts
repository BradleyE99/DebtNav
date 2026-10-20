// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPlan } from '../engine/planner';
import type { PlannerDocument, PlannerPlan, StorageLike } from '../engine/planner-contracts';
import { createFakeApi } from './fakeApi';
import { createApiClient } from './api';
import { createAccountGuard } from './accountGuard';
import { saveStatusText } from '../ui/sections/saveStatusText';
import { UNAVAILABLE_NOTICE } from '../data/storage';
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

describe('optional sign-in: account scope, guard and account pinning', () => {
  it('every status is scoped to the account and uses account wording', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    const { live } = await open(fake);
    expect(live.result.current.store.saveStatus.scope).toBe('account');
    expect(saveStatusText(live.result.current.store.saveStatus)).toBe('Saved to your account.');
    let release!: () => void;
    fake.server.gate = new Promise(resolve => { release = resolve; });
    act(() => { live.result.current.store.updatePlan(setBudget('200.00')); });
    await waitFor(() => expect(live.result.current.store.saveStatus.state).toBe('saving'));
    expect(live.result.current.store.saveStatus.scope).toBe('account');
    expect(saveStatusText(live.result.current.store.saveStatus)).toBe('Saving to your account…');
    fake.server.gate = null;
    await act(async () => { release(); });
    await waitFor(() => expect(live.result.current.store.saveStatus).toMatchObject({ state: 'saved', scope: 'account' }));
    fake.server.offline = true;
    act(() => { live.result.current.store.updatePlan(setBudget('300.00')); });
    await waitFor(() => expect(live.result.current.store.saveStatus).toMatchObject({ state: 'offline', scope: 'account' }));
    expect(saveStatusText(live.result.current.store.saveStatus)).not.toMatch(/^Saved/);
    expect(live.result.current.isDirty()).toBe(true);
  });

  it('a save response that arrives after the guard is revoked is dropped: no status, cache or callbacks', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    const cache = memory();
    const guard = createAccountGuard('user-1', 1);
    const onUnauthorized = vi.fn();
    const { live } = await open(fake, { cache, guard, onUnauthorized });
    let release!: () => void;
    fake.server.gate = new Promise(resolve => { release = resolve; });
    act(() => { live.result.current.store.updatePlan(setBudget('200.00')); });
    await waitFor(() => expect(live.result.current.store.saveStatus.state).toBe('saving'));
    // Sign-out happens while the save is in flight; the caches are cleared.
    guard.revoke();
    cache.data.clear();
    fake.server.failWith = 'unauthorized';
    fake.server.gate = null;
    await act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(live.result.current.store.saveStatus.state).toBe('saving');
    expect(cache.data.size).toBe(0);
    expect(onUnauthorized).not.toHaveBeenCalled();
    // Further edits neither save nor cache.
    act(() => { live.result.current.store.updatePlan(setBudget('300.00')); });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(fake.server.calls.filter(call => call.startsWith('savePlan'))).toEqual(['savePlan:1']);
    expect(cache.data.size).toBe(0);
  });

  it('revoking cancels a pending debounced save and the unmount flush, and pagehide writes nothing', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    const cache = memory();
    const guard = createAccountGuard('user-1', 1);
    const { live } = await open(fake, { cache, guard, debounceMs: 1000 });
    act(() => { live.result.current.store.updatePlan(setBudget('200.00')); });
    guard.revoke();
    cache.data.clear();
    window.dispatchEvent(new Event('pagehide'));
    live.unmount();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(fake.server.calls.filter(call => call.startsWith('savePlan'))).toEqual([]);
    expect(cache.data.size).toBe(0);
  });

  it('a load that finishes after revocation never becomes ready or calls back', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    const guard = createAccountGuard('user-1', 1);
    fake.server.failWith = 'unauthorized';
    const onUnauthorized = vi.fn();
    const loader = renderHook(() => useServerPlanLoad({ api: fake.api, userId: 'user-1', cache: memory(), guard, onUnauthorized }));
    guard.revoke();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(loader.result.current.status).toBe('loading');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('a pinned client refuses another account: saving is blocked, edits stay in memory, nothing is cached or written', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00') });
    const cache = memory();
    const onAccountChanged = vi.fn();
    const onUnauthorized = vi.fn();
    const { live } = await open(fake, { api: fake.api.forUser('user-1'), cache, onAccountChanged, onUnauthorized });
    // Another tab signs in as someone else.
    fake.server.user = { id: 'user-2', email: 'bob@example.test' };
    act(() => { live.result.current.store.updatePlan(setBudget('555.00')); });
    await waitFor(() => expect(onAccountChanged).toHaveBeenCalledTimes(1));
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(live.result.current.store.saveStatus).toMatchObject({ state: 'error', scope: 'account' });
    expect(live.result.current.store.saveStatus.message).toMatch(/another tab/);
    expect(live.result.current.store.document.plan.postGradIncome.monthlyDebtBudget).toBe('555.00');
    expect(fake.server.document?.plan.postGradIncome.monthlyDebtBudget).toBe('100.00');
    expect(cache.getItem(cacheKey('user-1'))).toBeNull();
    // Blocked: further edits do not try again.
    act(() => { live.result.current.store.updatePlan(setBudget('556.00')); });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(fake.server.calls.filter(call => call.startsWith('savePlan'))).toEqual(['savePlan:1']);
  });

  it('a pinned load while another account is signed in reports accountChanged (falls back to onUnauthorized)', async () => {
    const fake = createFakeApi({ document: docWithBudget('100.00'), user: { id: 'user-2', email: null } });
    const onUnauthorized = vi.fn();
    const loader = renderHook(() => useServerPlanLoad({ api: fake.api.forUser('user-1'), userId: 'user-1', cache: memory(), onUnauthorized }));
    await waitFor(() => expect(loader.result.current.status).toBe('error'));
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});

describe('api client account pinning (X-DebtNav-User)', () => {
  const recorder = (status: number, body: unknown) => {
    const seen: Headers[] = [];
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    return { seen, fetchFn };
  };

  it('forUser sends the header on every request; the unpinned client never does', async () => {
    const { seen, fetchFn } = recorder(200, { document: null, revision: 1, updatedAt: null });
    const client = createApiClient({ fetch: fetchFn });
    await client.loadPlan();
    const pinned = client.forUser('u-1');
    await pinned.loadPlan();
    await pinned.savePlan(docWithBudget('1.00'), null);
    await pinned.deleteAccountData();
    expect(seen[0].get('X-DebtNav-User')).toBeNull();
    expect(seen.slice(1).map(headers => headers.get('X-DebtNav-User'))).toEqual(['u-1', 'u-1', 'u-1']);
  });

  it('409 accountChanged is its own failure kind, distinct from a revision conflict', async () => {
    const changed = createApiClient({ fetch: recorder(409, { error: 'accountChanged' }).fetchFn }).forUser('u-1');
    expect(await changed.savePlan(docWithBudget('1.00'), 1)).toMatchObject({ ok: false, kind: 'accountChanged' });
    expect(await changed.loadPlan()).toMatchObject({ ok: false, kind: 'accountChanged' });
    const conflict = createApiClient({ fetch: recorder(409, { error: 'conflict', serverRevision: 4 }).fetchFn }).forUser('u-1');
    expect(await conflict.savePlan(docWithBudget('1.00'), 1)).toMatchObject({ ok: false, kind: 'conflict', serverRevision: 4 });
  });
});

describe('save status wording by scope', () => {
  it('browser wording never claims saved when storage is unavailable or failed', () => {
    expect(saveStatusText({ state: 'saved', message: null, savedAt: 'x', scope: 'browser' })).toBe('Saved on this browser. Sign in to access your plan on other devices.');
    expect(saveStatusText({ state: 'unavailable', message: null, savedAt: null, scope: 'browser' })).toBe(UNAVAILABLE_NOTICE);
    expect(saveStatusText({ state: 'error', message: null, savedAt: null, scope: 'browser' })).not.toMatch(/^Saved/);
    expect(saveStatusText({ state: 'saved', message: null, savedAt: 'x', scope: 'account' })).toBe('Saved to your account.');
    expect(saveStatusText({ state: 'saving', message: null, savedAt: null, scope: 'account' })).toBe('Saving to your account…');
    expect(saveStatusText({ state: 'saved', message: null, savedAt: 'x' })).toBe('All changes saved.');
  });
});
