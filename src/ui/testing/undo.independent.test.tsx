// @vitest-environment jsdom
/**
 * Independent US-904 checks (tester) on the local PlannerStore + PlannerApp: undo never expires on a timer or on
 * later edits, is LIFO, restores related records together, covers import replacement, and is disabled when empty.
 * (Server-saving of the reversal is covered in e2e/undo.spec.ts.)
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import { renderPlanner, samplePlan } from './renderPlanner';
import { exportDocument } from '../../data/storage';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const undoButton = () => screen.getByRole('group', { name: 'Undo' }).querySelector<HTMLButtonElement>('.undo-control__undo')!;

describe('US-904 persistent undo', () => {
  it('is visible and disabled when nothing can be undone', () => {
    renderPlanner({ plan: samplePlan() });
    expect(undoButton()).toBeTruthy();
    expect(undoButton().disabled).toBe(true);
  });

  it('survives 60 seconds and later edits; undo is LIFO', () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const view = renderPlanner({ plan: samplePlan() });
    act(() => { view.store().updatePlan(plan => ({ ...plan, postGradIncome: { ...plan.postGradIncome, monthlyDebtBudget: '700.00' } }), { undoLabel: 'Edit budget' }); });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(view.store().history.canUndo).toBe(true);
    expect(undoButton().disabled).toBe(false);
    act(() => { view.store().updatePlan(plan => ({ ...plan, loans: plan.loans.filter(l => l.id !== 'loan-b') }), { undoLabel: 'Delete loan Beta loan' }); });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(view.store().history.entries.map(e => e.label)).toEqual(['Edit budget', 'Delete loan Beta loan']);
    act(() => { view.store().history.undo(); });
    expect(view.plan().loans.map(l => l.id)).toEqual(['loan-a', 'loan-b']);
    expect(view.plan().repayment.customOrder).toEqual(['loan-a', 'loan-b']);
    expect(view.plan().postGradIncome.monthlyDebtBudget).toBe('700.00');
    act(() => { view.store().history.undo(); });
    expect(view.plan().postGradIncome.monthlyDebtBudget).toBe('600.00');
    expect(view.store().history.canUndo).toBe(false);
  });

  it('deleting a loan prunes its references and undo restores them together', () => {
    const view = renderPlanner({ plan: samplePlan() });
    const before = view.plan();
    act(() => { view.store().updatePlan(plan => ({ ...plan, loans: plan.loans.filter(l => l.id !== 'loan-a') }), { undoLabel: 'Delete loan' }); });
    expect(view.plan().repayment.customOrder).toEqual(['loan-b']);
    act(() => { view.store().history.undo(); });
    expect(view.plan().loans).toEqual(before.loans);
    expect(view.plan().repayment.customOrder).toEqual(before.repayment.customOrder);
  });

  it('import replacement can be undone in the session', () => {
    const view = renderPlanner({ plan: samplePlan() });
    const base = samplePlan();
    const other = { ...base, loans: [], repayment: { ...base.repayment, customOrder: [] } };
    act(() => { expect(view.store().importText(exportDocument({ plan: other, disclaimerDismissed: true })).ok).toBe(true); });
    expect(view.plan().loans).toEqual([]);
    act(() => { view.store().history.undo(); });
    expect(view.plan().loans.map(l => l.id)).toEqual(['loan-a', 'loan-b']);
  });

  it('clearing the history disables Undo without changing the plan', () => {
    const view = renderPlanner({ plan: samplePlan() });
    act(() => { view.store().updatePlan(plan => ({ ...plan, postGradIncome: { ...plan.postGradIncome, monthlyDebtBudget: '650.00' } })); });
    act(() => { view.store().history.clear(); });
    expect(view.store().history.canUndo).toBe(false);
    expect(view.plan().postGradIncome.monthlyDebtBudget).toBe('650.00');
    expect(undoButton().disabled).toBe(true);
  });
});
