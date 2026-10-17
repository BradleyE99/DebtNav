// @vitest-environment jsdom
/** US-904 persistent Undo control and history. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlannerStore, UndoHistory as History } from '../../engine/planner-contracts';
import { navigateTo, renderPlanner, samplePlan } from '../testing/renderPlanner';
import { UndoHistory } from './UndoHistory';

afterEach(() => { cleanup(); vi.useRealTimers(); window.history.replaceState(null, '', '/'); });

const group = () => screen.getByRole('group', { name: 'Undo' });
const undoButton = () => within(group()).getByRole('button', { name: 'Undo' }) as HTMLButtonElement;

describe('in the planner', () => {
  it('is visible and disabled with clear text when nothing can be undone', () => {
    renderPlanner({ plan: samplePlan() });
    expect(undoButton().disabled).toBe(true);
    expect(group().textContent).toContain('Nothing to undo');
    expect(within(group()).getByRole('button', { name: 'History (0)' })).toBeTruthy();
  });

  it('never expires on a timer or after later edits; undoes newest first (LIFO)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const view = renderPlanner({ plan: samplePlan() });
    navigateTo('repayment');
    const budget = screen.getByLabelText('Monthly debt budget (your chosen payment)');
    await user.clear(budget);
    await user.type(budget, '700');
    navigateTo('loans');
    await user.click(screen.getByRole('button', { name: 'Add loan' }));
    expect(view.plan().loans).toHaveLength(3);
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(undoButton().disabled).toBe(false);
    expect(group().textContent).not.toContain('Nothing to undo');

    await user.click(undoButton());
    expect(view.plan().loans).toHaveLength(2);
    expect(view.plan().postGradIncome.monthlyDebtBudget).toBe('700.00');
    expect(undoButton().disabled).toBe(false);
    // Repeated undo walks back through the budget edits, then nothing remains.
    for (let i = 0; i < 10 && !undoButton().disabled; i++) await user.click(undoButton());
    expect(view.plan().postGradIncome.monthlyDebtBudget).toBe('600.00');
    expect(group().textContent).toContain('Nothing to undo');
  });

  it('restores a removed loan with all its fields, and lists changes in the history', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    const before = JSON.stringify(view.plan().loans);
    navigateTo('loans');
    await user.click(within(document.getElementById('loans.loan-b-heading')!).getByRole('button'));
    await user.click(screen.getByRole('button', { name: 'Remove loan Beta loan' }));
    expect(view.plan().loans).toHaveLength(1);
    await user.click(within(group()).getByRole('button', { name: /History/ }));
    expect(within(group()).getByRole('button', { name: /History/ }).getAttribute('aria-expanded')).toBe('true');
    expect(within(group()).getByRole('listitem').textContent).toContain('Remove loan "Beta loan"');
    await user.click(undoButton());
    expect(JSON.stringify(view.plan().loans)).toBe(before);
  });

  it('JSON import replacement can be undone; deletion is not in the history', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    const other = { ...samplePlan(), postGradIncome: { ...samplePlan().postGradIncome, monthlyDebtBudget: '999.00' } };
    act(() => { view.store().importText(JSON.stringify({ app: 'debtnav', schemaVersion: 4, savedAt: '', document: { plan: other, disclaimerDismissed: true } })); });
    expect(view.plan().postGradIncome.monthlyDebtBudget).toBe('999.00');
    await user.click(undoButton());
    expect(view.plan().postGradIncome.monthlyDebtBudget).toBe('600.00');
    navigateTo('data');
    await user.click(screen.getByRole('button', { name: 'Delete all my data' }));
    expect(screen.getByRole('alertdialog').textContent).toMatch(/not part of the Undo history/);
  });
});

describe('component', () => {
  function fakeStore(history: History): PlannerStore {
    return { history, undo: null } as unknown as PlannerStore;
  }

  it('Undo and History are keyboard operable; Clear history empties the list without changing the plan', async () => {
    const user = userEvent.setup();
    const undo = vi.fn();
    const clear = vi.fn();
    const entries = [{ id: '1', label: 'Change monthly debt budget', at: '2026-10-16T10:00:00.000Z' }, { id: '2', label: 'Add loan', at: '2026-10-16T10:01:00.000Z' }];
    render(<UndoHistory store={fakeStore({ entries, canUndo: true, undo, clear })} />);
    expect(group().textContent).toContain('Last change: Add loan');
    undoButton().focus();
    await user.keyboard('{Enter}');
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('Undone: Add loan.');
    const toggle = within(group()).getByRole('button', { name: 'History (2)' });
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const items = within(group()).getAllByRole('listitem');
    expect(items.map(item => item.textContent?.split(/\d/)[0])).toEqual(['Add loan', 'Change monthly debt budget']);
    expect(items[0].getAttribute('aria-current')).toBe('step');
    await user.click(within(group()).getByRole('button', { name: 'Clear history' }));
    expect(clear).toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/plan was not changed/);
  });

  it('works with a store that only has the legacy single undo', async () => {
    const apply = vi.fn();
    render(<UndoHistory store={{ undo: { label: 'Remove cost', apply } } as unknown as PlannerStore} />);
    await userEvent.click(undoButton());
    expect(apply).toHaveBeenCalled();
  });
});
