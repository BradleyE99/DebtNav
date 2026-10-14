// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPlan } from '../engine/planner';
import type { PlannerPlan, StorageLike } from '../engine/planner-contracts';
import { LEGACY_STORAGE_KEYS, STORAGE_KEY, exportDocument } from '../data/storage';
import { usePlannerDocument } from './usePlannerDocument';

function memory(seed: Record<string, string> = {}): StorageLike & { data: Map<string, string>; failWrites: boolean } {
  const data = new Map(Object.entries(seed));
  const store = {
    data,
    failWrites: false,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (store.failWrites) throw new DOMException('full', 'QuotaExceededError');
      data.set(key, value);
    },
    removeItem: (key: string) => { data.delete(key); },
  };
  return store;
}

const storedPlan = (storage: { data: Map<string, string> }): PlannerPlan => JSON.parse(storage.data.get(STORAGE_KEY)!).document.plan;
const setSalary = (value: string) => (plan: PlannerPlan): PlannerPlan => ({ ...plan, postGradIncome: { ...plan.postGradIncome, annualSalary: value } });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('autosave and reload (US-1001)', () => {
  it('an edit followed immediately by pagehide (reload) is saved and restored on the next mount', () => {
    const storage = memory();
    const first = renderHook(() => usePlannerDocument({ storage }));
    act(() => { first.result.current.updatePlan(setSalary('64000.00')); });
    // No timers advanced: the debounce has not fired when the page goes away.
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    const second = renderHook(() => usePlannerDocument({ storage }));
    expect(second.result.current.document.plan.postGradIncome.annualSalary).toBe('64000.00');
    first.unmount();
    second.unmount();
  });

  it('saves after every change within the debounce window (≤ 300 ms)', () => {
    const storage = memory();
    const { result } = renderHook(() => usePlannerDocument({ storage }));
    for (const salary of ['1.00', '2.00', '3.00']) {
      act(() => { result.current.updatePlan(setSalary(salary)); });
      act(() => { vi.advanceTimersByTime(300); });
      expect(storedPlan(storage).postGradIncome.annualSalary).toBe(salary);
      expect(result.current.saveStatus.state).toBe('saved');
    }
  });

  it('editing → re-mount with the same storage restores a rich plan exactly', () => {
    const storage = memory();
    const first = renderHook(() => usePlannerDocument({ storage }));
    act(() => {
      first.result.current.updatePlan(plan => ({
        ...plan,
        loans: [{ id: 'l1', name: 'Loan', type: 'subsidized', principal: '3500.00', annualRate: '0.0553', disbursementDate: plan.settings.startDate, termMonths: 120, schoolYearId: plan.schoolYears[0].id }],
        scenarios: [{ id: 's1', name: 'Faster', overrides: { 'repayment.extraMonthlyPayment': '100.00' } }],
      }));
      first.result.current.dismissDisclaimer();
    });
    act(() => { vi.runAllTimers(); });
    const edited = first.result.current.document;
    first.unmount();
    const second = renderHook(() => usePlannerDocument({ storage }));
    expect(second.result.current.document).toEqual(edited);
  });
});

describe('storage unavailable (US-1001)', () => {
  it('says up front that changes will not be saved when storage reads but cannot write', () => {
    const storage = memory();
    storage.failWrites = true;
    const { result } = renderHook(() => usePlannerDocument({ storage }));
    expect(result.current.saveStatus).toMatchObject({ state: 'unavailable', message: expect.stringMatching(/will not be saved/) });
    act(() => { result.current.updatePlan(setSalary('5.00')); });
    act(() => { vi.runAllTimers(); });
    expect(result.current.document.plan.postGradIncome.annualSalary).toBe('5.00');
    expect(result.current.saveStatus.state).toBe('unavailable');
  });

  it('recovers when storage becomes writable again (quota freed)', () => {
    const storage = memory();
    const { result } = renderHook(() => usePlannerDocument({ storage }));
    storage.failWrites = true;
    act(() => { result.current.updatePlan(setSalary('5.00')); });
    act(() => { vi.runAllTimers(); });
    expect(result.current.saveStatus.state).toBe('unavailable');
    storage.failWrites = false;
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(result.current.saveStatus.state).toBe('saved');
    expect(storedPlan(storage).postGradIncome.annualSalary).toBe('5.00');
  });
});

describe('preserved unreadable data', () => {
  it('a failed import while paused keeps the preserved data and stays paused', () => {
    const storage = memory({ [STORAGE_KEY]: '{"app":"debtnav","schemaVersion":7}' });
    const { result } = renderHook(() => usePlannerDocument({ storage }));
    expect(result.current.saveStatus.state).toBe('paused');
    act(() => { result.current.importText('not json'); });
    act(() => { result.current.updatePlan(setSalary('1.00')); });
    act(() => { vi.runAllTimers(); window.dispatchEvent(new Event('pagehide')); });
    expect(storage.getItem(STORAGE_KEY)).toBe('{"app":"debtnav","schemaVersion":7}');
    expect(result.current.saveStatus.state).toBe('paused');
  });

  it('deleting (after confirmation) clears preserved data and resumes saving', () => {
    const storage = memory({ [STORAGE_KEY]: 'corrupt', [LEGACY_STORAGE_KEYS[0]]: 'old', unrelated: 'keep' });
    const { result } = renderHook(() => usePlannerDocument({ storage }));
    act(() => { result.current.deleteAllData(); });
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(storage.getItem(LEGACY_STORAGE_KEYS[0])).toBeNull();
    expect(storage.getItem('unrelated')).toBe('keep');
    act(() => { result.current.updatePlan(setSalary('2.00')); });
    act(() => { vi.runAllTimers(); });
    expect(storedPlan(storage).postGradIncome.annualSalary).toBe('2.00');
  });
});

describe('import and export through the store (US-1002)', () => {
  it('export → import into a fresh device yields an identical document', () => {
    const source = renderHook(() => usePlannerDocument({ storage: memory() }));
    act(() => {
      source.result.current.updatePlan(setSalary('72000.00'));
      source.result.current.dismissDisclaimer();
    });
    const exported = source.result.current.exportJson();
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const targetStorage = memory();
    const target = renderHook(() => usePlannerDocument({ storage: targetStorage }));
    act(() => { target.result.current.importText(exported.value); });
    expect(target.result.current.document).toEqual(source.result.current.document);
    expect(JSON.parse(targetStorage.data.get(STORAGE_KEY)!).document).toEqual(source.result.current.document);
  });

  it('a future-version import is rejected and changes neither the plan nor storage', () => {
    const storage = memory();
    const { result } = renderHook(() => usePlannerDocument({ storage }));
    act(() => { result.current.updatePlan(setSalary('10.00')); });
    act(() => { vi.runAllTimers(); });
    const before = storage.getItem(STORAGE_KEY);
    const plan = result.current.document;
    const future = exportDocument({ plan: createDefaultPlan(), disclaimerDismissed: false }).replace('"schemaVersion": 3', '"schemaVersion": 4');
    let outcome!: ReturnType<typeof result.current.importText>;
    act(() => { outcome = result.current.importText(future); });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors[0].message).toMatch(/newer version/);
    expect(result.current.document).toBe(plan);
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
    expect(result.current.undo).toBeNull();
  });

  it('an older-version (v2) import is migrated and saved', () => {
    const storage = memory();
    const { result } = renderHook(() => usePlannerDocument({ storage }));
    const v2plan = { ...createDefaultPlan(), repayment: { ...createDefaultPlan().repayment, strategyId: 'input-order' } };
    const text = JSON.stringify({ schemaVersion: 2, savedAt: '2026-01-01T00:00:00.000Z', document: { plan: v2plan, drafts: {}, disclaimerDismissed: true } });
    act(() => { result.current.importText(text); });
    expect(result.current.document.plan.repayment.strategyId).toBe('avalanche');
    expect(JSON.parse(storage.data.get(STORAGE_KEY)!).schemaVersion).toBe(3);
  });

  it('exportJson never includes derived projection data', () => {
    const { result } = renderHook(() => usePlannerDocument({ storage: memory() }));
    const exported = result.current.exportJson();
    expect(exported.ok && exported.value).not.toMatch(/amortizationSchedule|debtFreeDate|totalInterestPaid/);
  });
});

describe('reference integrity on edits', () => {
  it('shortening graduation drops references to removed school years instead of rejecting the edit', () => {
    const storage = memory();
    const { result } = renderHook(() => usePlannerDocument({ storage }));
    const lastYear = result.current.document.plan.schoolYears.at(-1)!;
    act(() => {
      result.current.updatePlan(plan => ({
        ...plan,
        loans: [{ id: 'l1', name: 'Loan', type: 'private', principal: '100.00', annualRate: '0.05', disbursementDate: lastYear.startDate, termMonths: 120, schoolYearId: lastYear.id }],
        scenarios: [{ id: 's1', name: 'S', overrides: { [`schoolYears.${lastYear.id}.bufferPercent`]: '10', 'postGradIncome.annualSalary': '1.00' } }],
      }));
    });
    let outcome!: ReturnType<typeof result.current.updatePlan>;
    act(() => { outcome = result.current.updatePlan(plan => ({ ...plan, settings: { ...plan.settings, graduationDate: '2028-05-20' } })); });
    expect(outcome.ok).toBe(true);
    const plan = result.current.document.plan;
    expect(plan.schoolYears.some(year => year.id === lastYear.id)).toBe(false);
    expect(plan.loans[0].schoolYearId).toBeUndefined();
    expect(plan.scenarios[0].overrides).toEqual({ 'postGradIncome.annualSalary': '1.00' });
  });

  it('rejects graduation on the start date at settings.graduationDate', () => {
    const { result } = renderHook(() => usePlannerDocument({ storage: memory() }));
    let outcome!: ReturnType<typeof result.current.updatePlan>;
    act(() => { outcome = result.current.updatePlan(plan => ({ ...plan, settings: { ...plan.settings, graduationDate: plan.settings.startDate } })); });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors.map(e => e.path)).toContain('settings.graduationDate');
  });
});
