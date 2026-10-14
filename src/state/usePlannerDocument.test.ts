// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPlan } from '../engine/planner';
import type { PlannerPlan, StorageLike } from '../engine/planner-contracts';
import { STORAGE_KEY, exportDocument } from '../data/storage';
import { usePlannerDocument } from './usePlannerDocument';

function memory(): StorageLike & { data: Map<string, string>; writes: number } {
  const data = new Map<string, string>();
  const store = {
    data,
    writes: 0,
    getItem: (key: string) => data.get(key) ?? null,
    // Count plan writes only; the startup write probe uses its own key and removes it at once.
    setItem: (key: string, value: string) => { if (key === STORAGE_KEY) store.writes += 1; data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
  return store;
}

const storedPlan = (storage: { data: Map<string, string> }): PlannerPlan => JSON.parse(storage.data.get(STORAGE_KEY)!).document.plan;
const setSalary = (value: string) => (plan: PlannerPlan): PlannerPlan => ({ ...plan, postGradIncome: { ...plan.postGradIncome, annualSalary: value } });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('usePlannerDocument', () => {
  it('starts from the default plan when nothing is stored, without writing', () => {
    const storage = memory();
    const { result } = renderHook(() => usePlannerDocument({ storage }));
    expect(result.current.document.plan).toEqual(createDefaultPlan());
    expect(result.current.document.disclaimerDismissed).toBe(false);
    expect(result.current.saveStatus.state).toBe('saved');
    expect(storage.writes).toBe(0);
  });

  it('applies rapid successive updates to the latest plan and coalesces them into one save', () => {
    const storage = memory();
    const { result } = renderHook(() => usePlannerDocument({ storage }));
    act(() => {
      // Within one tick, before any re-render: each update must see the previous one.
      result.current.updatePlan(setSalary('1.00'));
      result.current.updatePlan(plan => setSalary(String(Number(plan.postGradIncome.annualSalary) + 1) + '.00')(plan));
      result.current.updatePlan(plan => ({ ...plan, postGradIncome: { ...plan.postGradIncome, monthlyDebtBudget: '321.00' } }));
    });
    expect(result.current.document.plan.postGradIncome).toMatchObject({ annualSalary: '2.00', monthlyDebtBudget: '321.00' });
    expect(result.current.saveStatus.state).toBe('pending');
    expect(storage.writes).toBe(0);
    act(() => { vi.advanceTimersByTime(249); });
    expect(storage.writes).toBe(0);
    act(() => { vi.advanceTimersByTime(1); });
    expect(storage.writes).toBe(1);
    expect(result.current.saveStatus.state).toBe('saved');
    expect(result.current.saveStatus.savedAt).not.toBeNull();
    expect(storedPlan(storage).postGradIncome.annualSalary).toBe('2.00');
  });

  it('rejects invalid updates with field-path errors and leaves the plan unchanged', () => {
    const storage = memory();
    const { result } = renderHook(() => usePlannerDocument({ storage }));
    const before = result.current.document;
    let outcome!: ReturnType<typeof result.current.updatePlan>;
    act(() => { outcome = result.current.updatePlan(setSalary('12.345')); });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors[0].path).toBe('postGradIncome.annualSalary');
    expect(result.current.document).toBe(before);
    act(() => { outcome = result.current.updatePlan(() => { throw new Error('bug'); }); });
    expect(outcome.ok).toBe(false);
    act(() => { vi.runAllTimers(); });
    expect(storage.writes).toBe(0);
  });

  it('restores the saved plan after a reload', () => {
    const storage = memory();
    const first = renderHook(() => usePlannerDocument({ storage }));
    act(() => { first.result.current.updatePlan(setSalary('70000.00')); first.result.current.dismissDisclaimer(); });
    act(() => { vi.runAllTimers(); });
    first.unmount();
    const second = renderHook(() => usePlannerDocument({ storage }));
    expect(second.result.current.document.plan.postGradIncome.annualSalary).toBe('70000.00');
    expect(second.result.current.document.disclaimerDismissed).toBe(true);
  });

  it('reconciles school years when timeline dates change', () => {
    const { result } = renderHook(() => usePlannerDocument({ storage: memory() }));
    let outcome!: ReturnType<typeof result.current.updatePlan>;
    act(() => { outcome = result.current.updatePlan(plan => ({ ...plan, settings: { ...plan.settings, graduationDate: '2028-05-20' } })); });
    expect(outcome.ok).toBe(true);
    expect(result.current.document.plan.schoolYears.at(-1)!.endDate).toBe('2028-05-20');
  });

  it('flushes a pending save on pagehide, visibility hidden, and unmount', () => {
    const storage = memory();
    const { result, unmount } = renderHook(() => usePlannerDocument({ storage }));
    act(() => { result.current.updatePlan(setSalary('1.00')); });
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(storage.writes).toBe(1);

    act(() => { result.current.updatePlan(setSalary('2.00')); });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    visibility.mockRestore();
    expect(storage.writes).toBe(2);

    act(() => { result.current.updatePlan(setSalary('3.00')); });
    unmount();
    expect(storage.writes).toBe(3);
    expect(storedPlan(storage).postGradIncome.annualSalary).toBe('3.00');
  });

  it("shows 'unavailable' and keeps working when storage fails", () => {
    const failing: StorageLike = {
      getItem: () => { throw new DOMException('denied', 'SecurityError'); },
      setItem: () => { throw new DOMException('full', 'QuotaExceededError'); },
      removeItem: () => { throw new DOMException('denied', 'SecurityError'); },
    };
    const { result } = renderHook(() => usePlannerDocument({ storage: failing }));
    expect(result.current.saveStatus.state).toBe('unavailable');
    expect(result.current.saveStatus.message).toMatch(/will not be saved/);
    act(() => { result.current.updatePlan(setSalary('5.00')); });
    act(() => { vi.runAllTimers(); });
    expect(result.current.document.plan.postGradIncome.annualSalary).toBe('5.00');
    expect(result.current.saveStatus.state).toBe('unavailable');
    expect(result.current.deleteAllData().ok).toBe(false);
  });

  it('preserves unreadable stored data, pauses saving, and resumes after import', () => {
    const storage = memory();
    storage.setItem(STORAGE_KEY, 'not json');
    storage.writes = 0;
    const { result } = renderHook(() => usePlannerDocument({ storage }));
    expect(result.current.saveStatus.state).toBe('paused');
    expect(result.current.saveStatus.message).toMatch(/preserved/);
    act(() => { result.current.updatePlan(setSalary('9.00')); });
    act(() => { vi.runAllTimers(); window.dispatchEvent(new Event('pagehide')); });
    expect(storage.data.get(STORAGE_KEY)).toBe('not json');
    expect(storage.writes).toBe(0);

    const imported = createDefaultPlan();
    imported.postGradIncome.annualSalary = '88000.00';
    let outcome!: ReturnType<typeof result.current.importText>;
    act(() => { outcome = result.current.importText(exportDocument({ plan: imported, disclaimerDismissed: true })); });
    expect(outcome.ok).toBe(true);
    expect(result.current.saveStatus.state).toBe('saved');
    expect(storedPlan(storage).postGradIncome.annualSalary).toBe('88000.00');
    expect(result.current.undo?.label).toBe('Import');
  });

  it('rejects a bad import and keeps the current plan', () => {
    const storage = memory();
    const { result } = renderHook(() => usePlannerDocument({ storage }));
    const before = result.current.document;
    let outcome!: ReturnType<typeof result.current.importText>;
    act(() => { outcome = result.current.importText('{"app":"debtnav","schemaVersion":99}'); });
    expect(outcome.ok).toBe(false);
    expect(result.current.document).toBe(before);
    expect(storage.writes).toBe(0);
  });

  it('offers one-level undo for marked destructive edits only', () => {
    const storage = memory();
    const { result } = renderHook(() => usePlannerDocument({ storage }));
    act(() => {
      result.current.updatePlan(plan => ({ ...plan, loans: [{ id: 'l1', name: 'Loan', type: 'private', principal: '100.00', annualRate: '0.05', disbursementDate: plan.settings.startDate, termMonths: 120 }] }));
    });
    expect(result.current.undo).toBeNull();
    act(() => {
      result.current.markUndoable('Remove loan Loan');
      result.current.updatePlan(plan => ({ ...plan, loans: [] }));
    });
    expect(result.current.undo?.label).toBe('Remove loan Loan');
    expect(result.current.document.plan.loans).toEqual([]);
    act(() => { result.current.undo!.apply(); });
    expect(result.current.document.plan.loans.map(loan => loan.id)).toEqual(['l1']);
    expect(result.current.undo).toBeNull();
    act(() => { vi.runAllTimers(); });
    expect(storedPlan(storage).loans).toHaveLength(1);

    // A later ordinary edit retires the undo so it can never discard newer work.
    act(() => { result.current.markUndoable('Remove'); result.current.updatePlan(plan => ({ ...plan, loans: [] })); });
    act(() => { result.current.updatePlan(setSalary('1.00')); });
    expect(result.current.undo).toBeNull();
  });

  it('exports JSON and deletes all data back to a fresh plan', () => {
    const storage = memory();
    storage.setItem('unrelated', 'keep');
    const { result } = renderHook(() => usePlannerDocument({ storage }));
    act(() => { result.current.updatePlan(setSalary('1.00')); result.current.dismissDisclaimer(); });
    act(() => { vi.runAllTimers(); });
    const exported = result.current.exportJson();
    expect(exported.ok && JSON.parse(exported.value).schemaVersion).toBe(3);
    let deleted!: ReturnType<typeof result.current.deleteAllData>;
    act(() => { deleted = result.current.deleteAllData(); });
    expect(deleted.ok).toBe(true);
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
    expect(storage.getItem('unrelated')).toBe('keep');
    expect(result.current.document).toEqual({ plan: createDefaultPlan(), disclaimerDismissed: false });
    act(() => { vi.runAllTimers(); });
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
  });
});
