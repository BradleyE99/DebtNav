// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPlan } from '../engine/planner';
import { SCHEMA_VERSION } from '../engine/planner-contracts';
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

  it('keeps a persistent LIFO undo history: later edits never retire earlier entries (US-904)', () => {
    const storage = memory();
    const { result } = renderHook(() => usePlannerDocument({ storage }));
    expect(result.current.history.canUndo).toBe(false);
    expect(result.current.undo).toBeNull();
    act(() => {
      result.current.updatePlan(plan => ({ ...plan, loans: [{ id: 'l1', name: 'Loan', type: 'private', principal: '100.00', annualRate: '0.05', disbursementDate: plan.settings.startDate, termMonths: 120 }] }), { undoLabel: 'Add loan' });
    });
    act(() => {
      result.current.markUndoable('Remove loan Loan');
      result.current.updatePlan(plan => ({ ...plan, loans: [] }));
    });
    act(() => { vi.advanceTimersByTime(5000); });
    // An ordinary edit later does not retire the deletion's undo entry.
    act(() => { result.current.updatePlan(setSalary('1.00')); });
    expect(result.current.history.entries.map(entry => entry.label)).toEqual(['Add loan', 'Remove loan Loan', 'Edit']);
    // No timer expires history.
    act(() => { vi.advanceTimersByTime(60 * 60_000); });
    expect(result.current.history.canUndo).toBe(true);

    act(() => { result.current.history.undo(); });
    expect(result.current.document.plan.postGradIncome.annualSalary).not.toBe('1.00');
    act(() => { result.current.history.undo(); });
    expect(result.current.document.plan.loans.map(loan => loan.id)).toEqual(['l1']);
    expect(result.current.undo?.label).toBe('Add loan');
    act(() => { vi.runAllTimers(); });
    // The reversal is saved like any edit.
    expect(storedPlan(storage).loans).toHaveLength(1);
    act(() => { result.current.undo!.apply(); });
    expect(result.current.document.plan.loans).toEqual([]);
    expect(result.current.history.canUndo).toBe(false);
  });

  it('coalesces a burst of unlabelled edits (typing) into one undo entry; labelled edits stay separate', () => {
    const { result } = renderHook(() => usePlannerDocument({ storage: memory() }));
    const original = result.current.document.plan.postGradIncome.annualSalary;
    act(() => { result.current.updatePlan(setSalary('4.00')); });
    act(() => { vi.advanceTimersByTime(200); result.current.updatePlan(setSalary('45.00')); });
    act(() => { vi.advanceTimersByTime(200); result.current.updatePlan(setSalary('450.00')); });
    expect(result.current.history.entries).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(2000); result.current.updatePlan(setSalary('5.00')); });
    act(() => { result.current.updatePlan(setSalary('6.00'), { undoLabel: 'Set salary' }); });
    expect(result.current.history.entries.map(entry => entry.label)).toEqual(['Edit', 'Edit', 'Set salary']);
    act(() => { result.current.history.undo(); });
    act(() => { result.current.history.undo(); });
    expect(result.current.document.plan.postGradIncome.annualSalary).toBe('450.00');
    act(() => { result.current.history.undo(); });
    expect(result.current.document.plan.postGradIncome.annualSalary).toBe(original);
  });

  it('coalesces a burst of labelled field edits only with coalesce and the same label', () => {
    const { result } = renderHook(() => usePlannerDocument({ storage: memory() }));
    const original = result.current.document.plan.postGradIncome.annualSalary;
    const field = { undoLabel: 'Change salary', coalesce: true };
    act(() => { result.current.updatePlan(setSalary('5.00'), field); });
    act(() => { vi.advanceTimersByTime(100); result.current.updatePlan(setSalary('50.00'), field); });
    act(() => { vi.advanceTimersByTime(100); result.current.updatePlan(setSalary('501.00'), field); });
    expect(result.current.history.entries.map(entry => entry.label)).toEqual(['Change salary']);
    // A different label, or a labelled edit without coalesce (e.g. a removal), starts a new entry.
    act(() => { result.current.updatePlan(setSalary('600.00'), { undoLabel: 'Change budget', coalesce: true }); });
    act(() => { result.current.updatePlan(setSalary('700.00'), { undoLabel: 'Change budget' }); });
    expect(result.current.history.entries.map(entry => entry.label)).toEqual(['Change salary', 'Change budget', 'Change budget']);
    act(() => { result.current.history.undo(); result.current.history.undo(); });
    expect(result.current.document.plan.postGradIncome.annualSalary).toBe('501.00');
    act(() => { result.current.history.undo(); });
    expect(result.current.document.plan.postGradIncome.annualSalary).toBe(original);
  });

  it('caps the history at 50 entries, dropping the oldest; clear() empties it without changing the plan', () => {
    const { result } = renderHook(() => usePlannerDocument({ storage: memory() }));
    for (let i = 1; i <= 55; i++) act(() => { result.current.updatePlan(setSalary(`${i}.00`), { undoLabel: `Salary ${i}` }); });
    expect(result.current.history.entries).toHaveLength(50);
    expect(result.current.history.entries[0].label).toBe('Salary 6');
    const plan = result.current.document;
    act(() => { result.current.history.clear(); });
    expect(result.current.history.canUndo).toBe(false);
    expect(result.current.document).toBe(plan);
  });

  it('import and replaceDocument are undoable; a rejected edit adds no entry', () => {
    const { result } = renderHook(() => usePlannerDocument({ storage: memory() }));
    const original = result.current.document;
    const other = { plan: { ...createDefaultPlan(), postGradIncome: { ...createDefaultPlan().postGradIncome, annualSalary: '77.00' } }, disclaimerDismissed: true };
    act(() => { result.current.importText(exportDocument(other)); });
    expect(result.current.undo?.label).toBe('Import');
    act(() => { result.current.replaceDocument({ ...other, disclaimerDismissed: false }, 'Import Excel file'); });
    expect(result.current.undo?.label).toBe('Import Excel file');
    act(() => { result.current.updatePlan(setSalary('-1')); });
    expect(result.current.history.entries).toHaveLength(2);
    act(() => { result.current.history.undo(); });
    act(() => { result.current.history.undo(); });
    expect(result.current.document).toEqual(original);
  });

  it('exports JSON and deletes all data back to a fresh plan', () => {
    const storage = memory();
    storage.setItem('unrelated', 'keep');
    const { result } = renderHook(() => usePlannerDocument({ storage }));
    act(() => { result.current.updatePlan(setSalary('1.00')); result.current.dismissDisclaimer(); });
    act(() => { vi.runAllTimers(); });
    const exported = result.current.exportJson();
    expect(exported.ok && JSON.parse(exported.value).schemaVersion).toBe(SCHEMA_VERSION);
    let deleted!: ReturnType<typeof result.current.deleteAllData>;
    act(() => { deleted = result.current.deleteAllData(); });
    expect(deleted.ok).toBe(true);
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
    expect(storage.getItem('unrelated')).toBe('keep');
    expect(result.current.document).toEqual({ plan: createDefaultPlan(), disclaimerDismissed: false });
    // Deletion is not undoable and clears the history.
    expect(result.current.history.canUndo).toBe(false);
    act(() => { vi.runAllTimers(); });
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
  });
});
