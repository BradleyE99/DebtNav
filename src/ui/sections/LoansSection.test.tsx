// @vitest-environment jsdom
/** Expandable loan cards: collapsed summaries, toggling, bulk controls, focus, and draft/error preservation. */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlannerPlan, PlannerStore } from '../../engine/planner-contracts';
import { renderPlanner, samplePlan } from '../testing/renderPlanner';
import { revealField } from '../reveal';
import PlannerApp from '../PlannerApp';

afterEach(cleanup);

const byId = (id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`No element with id ${id}`);
  return element as HTMLInputElement;
};
const toggle = (loanId: string) => within(byId(`loans.${loanId}-heading`)).getByRole('button');
const details = (loanId: string) => byId(`loans.${loanId}-details`);
const isOpen = (loanId: string) => toggle(loanId).getAttribute('aria-expanded') === 'true';

describe('loan cards', () => {
  it('start collapsed with a header summary of name, type, principal, and rate', async () => {
    renderPlanner({ plan: samplePlan() });
    for (const id of ['loan-a', 'loan-b']) {
      expect(isOpen(id)).toBe(false);
      expect(details(id).hidden).toBe(true);
      expect(toggle(id).getAttribute('aria-controls')).toBe(`loans.${id}-details`);
    }
    const header = toggle('loan-a');
    expect(header.closest('h3')).toBeTruthy();
    expect(header.textContent).toContain('Alpha loan');
    expect(header.textContent).toContain('Federal Direct Unsubsidized');
    expect(header.textContent).toMatch(/Principal\s*\$5,000\.00/);
    expect(header.textContent).toMatch(/Annual rate\s*5%/);
    await waitFor(() => expect(header.textContent).toMatch(/Balance at repayment\s*\$6,060\.96/));
    expect(toggle('loan-b').textContent).toMatch(/Beta loan.*Private.*Principal\s*\$20,000\.00.*Annual rate\s*9%/);
    // Collapsed fields stay mounted (so drafts survive) but are hidden from the accessibility tree.
    expect(document.getElementById('loans.loan-a.principal')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /Amount borrowed/ })).toBeNull();
  });

  it('toggles with the header button; several cards can be open at once', async () => {
    const user = userEvent.setup();
    renderPlanner({ plan: samplePlan() });
    await user.click(toggle('loan-a'));
    expect(isOpen('loan-a')).toBe(true);
    expect(details('loan-a').hidden).toBe(false);
    await user.click(toggle('loan-b'));
    expect(isOpen('loan-a')).toBe(true);
    expect(isOpen('loan-b')).toBe(true);
    await user.click(toggle('loan-a'));
    expect(isOpen('loan-a')).toBe(false);
    expect(details('loan-a').hidden).toBe(true);
    expect(isOpen('loan-b')).toBe(true);
    // Keyboard: Enter and Space on the focused header toggle it.
    toggle('loan-a').focus();
    await user.keyboard('{Enter}');
    expect(isOpen('loan-a')).toBe(true);
    await user.keyboard(' ');
    expect(isOpen('loan-a')).toBe(false);
  });

  it('expands and collapses all loans', async () => {
    const user = userEvent.setup();
    renderPlanner({ plan: samplePlan() });
    const expandAll = screen.getByRole('button', { name: 'Expand all' });
    const collapseAll = screen.getByRole('button', { name: 'Collapse all' });
    expect(collapseAll.getAttribute('aria-disabled')).toBe('true');
    await user.click(expandAll);
    expect(isOpen('loan-a') && isOpen('loan-b')).toBe(true);
    expect(expandAll.getAttribute('aria-disabled')).toBe('true');
    expect(collapseAll.getAttribute('aria-disabled')).toBeNull();
    await user.click(collapseAll);
    expect(isOpen('loan-a') || isOpen('loan-b')).toBe(false);
  });

  it('hides the bulk controls when there are no loans', () => {
    renderPlanner({ plan: { ...samplePlan(), loans: [], repayment: { ...samplePlan().repayment, customOrder: [] } } });
    expect(screen.queryByRole('button', { name: 'Expand all' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Collapse all' })).toBeNull();
  });

  it('opens a newly added loan and focuses its name field', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    await user.click(screen.getByRole('button', { name: 'Add loan' }));
    const loan = view.plan().loans[2];
    expect(isOpen(loan.id)).toBe(true);
    await act(async () => { await new Promise(resolve => requestAnimationFrame(() => resolve(null))); });
    expect(document.activeElement?.id).toBe(`loans.${loan.id}.name`);
    expect(isOpen('loan-a')).toBe(false);
  });

  it('opens a loan created from a year gap', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: { ...samplePlan(), loans: [], repayment: { ...samplePlan().repayment, customOrder: [] } } });
    await user.click(screen.getByRole('button', { name: 'Create loan from gap for Year 1' }));
    const [loan] = view.plan().loans;
    expect(isOpen(loan.id)).toBe(true);
    expect(document.activeElement?.id).toBe(`loans.${loan.id}.name`);
  });

  it('keeps invalid draft text and its error through collapse and shows an indicator while collapsed', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    await user.click(toggle('loan-a'));
    const principal = byId('loans.loan-a.principal');
    await user.clear(principal);
    await user.type(principal, 'abc');
    await user.tab();
    expect(principal.getAttribute('aria-invalid')).toBe('true');
    expect(view.plan().loans[0].principal).toBe('5000.00');
    await user.click(toggle('loan-a'));
    expect(details('loan-a').hidden).toBe(true);
    const indicator = byId('loans.loan-a-attention');
    expect(indicator.textContent).toBe('!Needs attention: 1 field');
    expect(toggle('loan-a').getAttribute('aria-describedby')).toBe('loans.loan-a-attention');
    expect(document.getElementById('loans.loan-b-attention')).toBeNull();
    await user.click(toggle('loan-a'));
    expect(byId('loans.loan-a.principal').value).toBe('abc');
    expect(byId('loans.loan-a.principal-error').textContent).toBeTruthy();
    // A cleared amount is incomplete: it is flagged too and never saved as 0.
    await user.clear(principal);
    await user.tab();
    expect(view.plan().loans[0].principal).toBe('5000.00');
    await user.click(toggle('loan-a'));
    expect(byId('loans.loan-a-attention').textContent).toContain('Needs attention: 1 field');
    // Fixing the value clears the indicator.
    await user.click(toggle('loan-a'));
    await user.type(principal, '6000');
    await user.tab();
    expect(view.plan().loans[0].principal).toBe('6000.00');
    expect(document.getElementById('loans.loan-a-attention')).toBeNull();
  });

  it('updates the summary as valid edits are committed', async () => {
    const user = userEvent.setup();
    renderPlanner({ plan: samplePlan() });
    await user.click(toggle('loan-a'));
    const principal = byId('loans.loan-a.principal');
    await user.clear(principal);
    await user.type(principal, '7500');
    const rate = byId('loans.loan-a.annualRate');
    await user.clear(rate);
    await user.type(rate, '6.52');
    const name = byId('loans.loan-a.name');
    await user.clear(name);
    await user.type(name, 'Stafford');
    await user.tab();
    expect(toggle('loan-a').textContent).toMatch(/Stafford.*Principal\s*\$7,500\.00.*Annual rate\s*6\.52%/);
  });

  it('does not toggle when a field or the Remove button is used', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    await user.click(toggle('loan-a'));
    await user.click(byId('loans.loan-a.principal'));
    await user.click(byId('loans.loan-a.capitalizeInterest'));
    expect(isOpen('loan-a')).toBe(true);
    await user.click(toggle('loan-b'));
    await user.click(screen.getByRole('button', { name: 'Remove loan Alpha loan' }));
    expect(view.plan().loans.map(loan => loan.id)).toEqual(['loan-b']);
    expect(isOpen('loan-b')).toBe(true);
    expect(view.plan().repayment.customOrder).toEqual(['loan-b']);
    await waitFor(() => expect(document.activeElement?.id).toBe('loans-heading'));
  });

  it('keeps an invalid draft while editing another loan and using bulk expansion', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    const principal = byId('loans.loan-a.principal');
    await user.clear(principal);
    await user.type(principal, 'unfinished');
    const rate = byId('loans.loan-b.annualRate');
    await user.clear(rate);
    await user.type(rate, '8.25');
    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(byId('loans.loan-a-attention').textContent).toContain('Needs attention: 1 field');
    expect(document.getElementById('loans.loan-b-attention')).toBeNull();
    expect(view.plan().loans[0].principal).toBe('5000.00');
    expect(view.plan().loans[1].annualRate).toBe('0.0825');
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(principal.value).toBe('unfinished');
    expect(principal.getAttribute('aria-invalid')).toBe('true');
  });

  it('opens a gap-created loan while retaining other cards and their edits', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: samplePlan() });
    await user.click(toggle('loan-a'));
    const principal = byId('loans.loan-a.principal');
    await user.clear(principal);
    await user.type(principal, '6100');
    await user.click(screen.getByRole('button', { name: 'Create loan from gap for Year 1' }));
    const loan = view.plan().loans[2];
    expect(isOpen(loan.id)).toBe(true);
    expect(document.activeElement?.id).toBe(`loans.${loan.id}.name`);
    expect(isOpen('loan-a')).toBe(true);
    expect(isOpen('loan-b')).toBe(false);
    expect(principal.value).toBe('6,100.00');
    expect(view.plan().loans[0].principal).toBe('6100.00');
    expect(view.plan().loans[2].principal).toBe('6000.00');
  });

  it('expands the loan that holds a revealed field', async () => {
    renderPlanner({ plan: samplePlan() });
    expect(isOpen('loan-b')).toBe(false);
    act(() => { revealField('loans.loan-b.disbursementDate'); });
    expect(isOpen('loan-b')).toBe(true);
    expect(isOpen('loan-a')).toBe(false);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
    expect(document.activeElement?.id).toBe('loans.loan-b.disbursementDate');
  });

  it('labels a loan and its separate removal action with the same numbered fallback', async () => {
    const user = userEvent.setup();
    const base = samplePlan();
    const plan: PlannerPlan = { ...base, loans: base.loans.map(loan => (loan.id === 'loan-b' ? { ...loan, name: '   ' } : loan)) };
    const store: PlannerStore = {
      document: { plan, disclaimerDismissed: true },
      updatePlan: () => ({ ok: true, value: plan }),
      dismissDisclaimer: () => {}, saveStatus: { state: 'saved', message: null, savedAt: null }, undo: null,
      markUndoable: () => {}, importText: () => ({ ok: false, errors: [] }), exportJson: () => ({ ok: true, value: '' }),
      deleteAllData: () => ({ ok: true, notice: null }),
    };
    render(<PlannerApp store={store} />);
    expect(toggle('loan-b').textContent).toContain('Unnamed loan 2');
    expect(screen.getByRole('article', { name: 'Unnamed loan 2' })).toBeTruthy();
    await user.click(toggle('loan-b'));
    expect(screen.getByRole('button', { name: 'Remove loan Unnamed loan 2' })).toBeTruthy();
  });
});
