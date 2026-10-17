// @vitest-environment jsdom
/**
 * Results guidance (tester): "Your plan needs…" checklist, status line, placeholders, and every
 * missing-information action landing on the right dashboard + focused element (brief §5, §8).
 * Expected items come from the shared readiness layer for the same plan, so the UI must render
 * exactly what getPlanReadiness reports (no duplicated rules) and route every action correctly.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CostItem, LifeEvent, PlannerLoan, PlannerPlan, Resource } from '../engine/planner-contracts';
import { createDefaultPlan, calculatePlannerOutputs, calculatePlannerComparisons } from '../engine/planner';
import { getPlanReadiness, type PlanReadiness, type ReadinessItem } from '../data/readiness';
import { memoryStorage, navigateTo, renderPlanner, storedDocument } from './testing/renderPlanner';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

// ------------------------------------------------------------------ fixtures
const loan = (id: string, principal: string, extra: Partial<PlannerLoan> = {}): PlannerLoan => ({
  id, name: `Loan ${id}`, type: 'private', principal, annualRate: '0.065', disbursementDate: '2030-11-20', termMonths: 120, ...extra,
});
const cost = (id: string, amount: string): CostItem => ({ id, category: 'tuition', label: `Cost ${id}`, amount, semester: 'annual' });
const resource = (id: string, type: Resource['type'], amount: string, extra: Partial<Resource> = {}): Resource => ({
  id, type, label: `Res ${id}`, amount, incomeMode: 'fixed', hourlyWage: '0.00', hoursPerWeek: '0', weeksWorked: '0', unavailablePercent: '0', ...extra,
});
const event = (id: string, type: LifeEvent['type'], amount: string, extra: Partial<LifeEvent> = {}): LifeEvent => ({
  id, name: `Event ${id}`, date: '2031-06-01', type, amount, allocationPercent: '50', ...extra,
});
function plan(edit: (p: PlannerPlan) => void = () => {}): PlannerPlan {
  const p = createDefaultPlan();
  edit(p);
  return p;
}
const loanOnly = () => plan(p => { p.loans = [loan('L1', '30000.00', { type: 'subsidized' })]; p.postGradIncome.monthlyDebtBudget = '340.64'; });
const complete = (edit: (p: PlannerPlan) => void = () => {}) => plan(p => {
  p.schoolYears.forEach((y, i) => { y.costItems = [cost(`c${i}`, '10000.00')]; });
  p.loans = [loan('L1', '30000.00')];
  p.postGradIncome.monthlyDebtBudget = '340.64';
  edit(p);
});
function readinessOf(p: PlannerPlan): PlanReadiness {
  const outputs = calculatePlannerOutputs(p);
  const comparisons = calculatePlannerComparisons(p);
  return getPlanReadiness(p, {
    outputs: outputs.ok ? outputs.value : null,
    projectionErrors: outputs.ok ? outputs.value.repaymentUnavailable?.errors ?? [] : outputs.errors,
    comparisons: comparisons.ok ? comparisons.value : null,
  });
}

// ------------------------------------------------------------------ DOM hooks (agreed with ui)
const checklist = () => {
  const heading = screen.getByRole('heading', { name: /your plan needs/i });
  return heading.closest('section, [role="region"], .readiness, div') as HTMLElement;
};
const queryChecklistHeading = () => screen.queryByRole('heading', { name: /your plan needs/i });
const row = (id: string) => document.querySelector<HTMLElement>(`[data-readiness-id="${id.replace(/["\\]/g, '\\$&')}"]`);
const statusLine = () => screen.getAllByRole('status').find(el => /ready|needed|need/i.test(el.textContent ?? ''));
const openAssumptions = () => { for (const d of document.querySelectorAll<HTMLDetailsElement>('main details')) d.open = true; };
const MONTH_YEAR = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{4}(?!\d)/;
/** Text of every readiness-gated figure on the mounted dashboard. */
const figureTexts = () => [...document.querySelectorAll<HTMLElement>('main .result-figure')].map(el => ({ state: el.dataset.state, text: el.textContent ?? '' }));
function expectNoMisleadingFigures() {
  const figures = figureTexts().filter(f => f.state !== 'complete' && f.state !== 'estimate');
  expect(figures.length).toBeGreaterThan(0);
  for (const f of figures) { expect(f.text).not.toMatch(MONTH_YEAR); expect(f.text).not.toMatch(/\$0\.00/); }
}

async function goToResults() {
  act(() => navigateTo('results'));
  await screen.findByRole('heading', { name: /your plan needs|your live results|results/i, level: 2 });
}

/** Clicks an item's action and asserts dashboard + focused element. */
async function followAction(item: ReadinessItem) {
  await goToResults();
  openAssumptions();
  const r = row(item.id);
  expect(r, `row for ${item.id}`).not.toBeNull();
  const button = within(r!).getByRole('button', { name: new RegExp(item.actionLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
  await userEvent.click(button);
  await waitFor(() => expect(window.location.hash, item.id).toBe(`#${item.target.dashboard}`));
  await waitFor(() => expect(document.activeElement?.id, item.id).toBe(item.target.fieldId), { timeout: 1500 });
  expect(document.querySelector('.dashboard')?.getAttribute('data-dashboard')).toBe(item.target.dashboard);
  // The focused element is visible: not inside a closed <details> or [hidden].
  const focused = document.activeElement as HTMLElement;
  expect(focused.closest('[hidden]')).toBeNull();
  let parent = focused.parentElement;
  while (parent) { if (parent instanceof HTMLDetailsElement) expect(parent.open, `${item.id} details open`).toBe(true); parent = parent.parentElement; }
}

// ------------------------------------------------------------------ tests
describe('empty plan (§8.1)', () => {
  it('Results shows the checklist with "Add a loan" and "Add school costs" and no misleading figures', async () => {
    renderPlanner({ plan: createDefaultPlan() });
    await goToResults();
    const list = checklist();
    expect(row('loans.none')).not.toBeNull();
    expect(row('costs.none')).not.toBeNull();
    expect(within(row('loans.none')!).getByRole('button').textContent).toMatch(/add.*loan/i);
    expect(within(row('costs.none')!).getByRole('button').textContent).toMatch(/cost/i);
    // Each row says why it matters.
    expect(row('loans.none')!.textContent).toMatch(/debt-free|interest/i);
    expectNoMisleadingFigures();
    expect(figureTexts().some(f => f.state === 'complete')).toBe(false);
    expect(list).toBeTruthy();
  });

  it('the status line is a polite live region that counts what is needed', async () => {
    renderPlanner({ plan: createDefaultPlan() });
    await goToResults();
    const status = statusLine();
    expect(status, 'role=status line').toBeDefined();
    expect(status!.getAttribute('aria-live') ?? 'polite').toBe('polite');
    expect(status!.textContent).toMatch(/0 of \d+ key results ready · 2 items needed/);
  });

  it('Overview "At a glance" shows no debt-free date and no $0.00 totals', async () => {
    renderPlanner({ plan: createDefaultPlan() });
    act(() => navigateTo('overview'));
    const card = document.querySelector('.key-figures') as HTMLElement;
    expect(card).not.toBeNull();
    const values = [...card.querySelectorAll('dd')].map(dd => dd.textContent ?? '');
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).not.toMatch(MONTH_YEAR);
      expect(value).not.toMatch(/\$0\.00/);
    }
    for (const id of ['key-debt-free', 'key-interest', 'key-gap']) {
      expect(screen.getByTestId(id).getAttribute('data-state'), id).toBe('incomplete');
    }
    // Same checklist component on Overview.
    expect(row('loans.none')).not.toBeNull();
  });
});

describe('partial plans', () => {
  it('loan-only plan: debt-free date and interest shown, no checklist item blocks repayment (§8.2)', async () => {
    renderPlanner({ plan: loanOnly() });
    await goToResults();
    const results = document.getElementById('results')!;
    expect(results.textContent).toMatch(/Nov(ember)? 2040/);
    expect(results.textContent).toMatch(/10,877\.41/);
    // Costs may be listed, but only as blocking the borrowing gap.
    const costs = row('costs.none');
    if (costs) expect(costs.textContent).not.toMatch(/debt-free date/i);
  });

  it('school-only plan: gap shown, repayment asks for a loan (§8.3)', async () => {
    renderPlanner({ plan: plan(p => { p.schoolYears[0].costItems = [cost('c', '20000.00')]; }) });
    await goToResults();
    expect(row('costs.none')).toBeNull();
    expect(row('loans.none')).not.toBeNull();
    act(() => navigateTo('overview'));
    expect(screen.getByTestId('key-gap').textContent).toMatch(/20,000\.00/);
    expect(screen.getByTestId('key-gap').getAttribute('data-state')).toBe('complete');
    expect(screen.getByTestId('key-debt-free').getAttribute('data-state')).toBe('incomplete');
  });

  it('all loans at $0 → asks for the loan amount, no debt-free date', async () => {
    renderPlanner({ plan: plan(p => { p.loans = [loan('A', '0.00')]; }) });
    await goToResults();
    expect(row('loans.allZero')).not.toBeNull();
    expectNoMisleadingFigures();
  });

  it('a complete plan shows no "Your plan needs" checklist', async () => {
    renderPlanner({ plan: complete() });
    await goToResults();
    expect(queryChecklistHeading()).toBeNull();
  });
});

describe('budget states (§8.7, §8.8)', () => {
  it('budget $0 → budget.zero missing, action opens Repayment Plan and focuses the monthly budget', async () => {
    const p = complete(p => { p.postGradIncome.monthlyDebtBudget = '0.00'; });
    renderPlanner({ plan: p });
    await goToResults();
    expect(row('budget.zero')).not.toBeNull();
    await followAction(readinessOf(p).items.find(i => i.id === 'budget.zero')!);
  });

  it('budget below interest → not paid off, with a budget action', async () => {
    renderPlanner({ plan: complete(p => { p.postGradIncome.monthlyDebtBudget = '10.00'; }) });
    await goToResults();
    const results = document.getElementById('results')!;
    expect(results.textContent).toMatch(/not paid off|no debt-free date/i);
    expect(row('repayment.nonPayoff')).not.toBeNull();
    expect(within(row('repayment.nonPayoff')!).getByRole('button').textContent).toMatch(/budget/i);
  });

  it('budget below minimums → shortfall warning visible on Results', async () => {
    renderPlanner({ plan: complete(p => { p.postGradIncome.monthlyDebtBudget = '200.00'; }) });
    await goToResults();
    openAssumptions();
    expect(row('budget.shortfall')).not.toBeNull();
    expect(document.getElementById('results')!.textContent).toMatch(/140\.64/);
  });

  it('untouched default budget → debt-free date shown with an Estimate marker; editing removes it', async () => {
    const view = renderPlanner({ plan: complete(p => { p.postGradIncome.monthlyDebtBudget = '400.00'; }) });
    await goToResults();
    openAssumptions();
    expect(row('budget.default')).not.toBeNull();
    expect(document.getElementById('results')!.textContent).toMatch(/estimate/i);
    act(() => { view.store().updatePlan(p => ({ ...p, postGradIncome: { ...p.postGradIncome, monthlyDebtBudget: '450.00' } })); });
    await waitFor(() => expect(row('budget.default')).toBeNull());
  });
});

describe('every checklist action lands on its target (§8.5)', () => {
  const plans: [string, () => PlannerPlan][] = [
    ['empty plan', () => createDefaultPlan()],
    ['all-zero loans', () => plan(p => { p.loans = [loan('A', '0.00'), loan('B', '0.00')]; })],
    ['mixed warnings', () => plan(p => {
      const [y1, y2] = p.schoolYears;
      y1.costItems = [cost('real', '12000.00'), cost('blank', '0.00')];
      y1.resources = [resource('grant0', 'grant', '0.00'), resource('job0', 'job', '0.00', { incomeMode: 'hourly', hoursPerWeek: '10', weeksWorked: '30' })];
      void y2; // year 2+ left empty → costs.year.<id>.empty
      p.loans = [loan('L1', '20000.00', { type: 'unsubsidized', disbursementDate: y1.startDate }), loan('Z', '0.00')];
      p.postGradIncome.monthlyDebtBudget = '0.00';
      p.lifeEvents = [event('raise', 'income', '65000.00')];
      p.scenarios = [{ id: 'sc1', name: 'Later grad', overrides: { 'postGradIncome.monthlyDebtBudget': '500.00' } }];
    })],
    ['non-payoff', () => complete(p => { p.postGradIncome.monthlyDebtBudget = '10.00'; })],
    ['shortfall + default AGI', () => complete(p => { p.loans[0].type = 'subsidized'; p.postGradIncome.monthlyDebtBudget = '200.00'; })],
  ];
  for (const [name, make] of plans) {
    it(name, async () => {
      const p = make();
      const items = readinessOf(p).items;
      expect(items.length).toBeGreaterThan(0);
      renderPlanner({ plan: p });
      for (const item of items) await followAction(item);
    }, 30_000);
  }

  it('engine error after an edit (graduation moved before a disbursement) → fix link focuses the loan date', async () => {
    const view = renderPlanner({ plan: complete() });
    act(() => { view.store().updatePlan(p => ({ ...p, loans: p.loans.map(l => ({ ...l, disbursementDate: '2030-12-01' })) })); });
    const p = view.plan();
    const items = readinessOf(p).items.filter(i => i.severity === 'invalid');
    if (p.loans[0].disbursementDate !== '2030-12-01') return; // store rejected the edit: nothing invalid can reach Results
    expect(items.map(i => i.id)).toContain('engine.loans.L1.disbursementDate');
    for (const item of items) await followAction(item);
  });
});

describe('completion flow: checklist updates after editing (§8.6)', () => {
  it('Add a loan → focus → add → enter principal → back on Results the item is gone and the count drops', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: plan(p => { p.schoolYears.forEach((y, i) => { y.costItems = [cost(`c${i}`, '1000.00')]; }); }) });
    await goToResults();
    const before = statusLine()?.textContent;
    await user.click(within(row('loans.none')!).getByRole('button'));
    await waitFor(() => expect(document.activeElement?.id).toBe('loans-add'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(view.plan().loans).toHaveLength(1));
    const id = view.plan().loans[0].id;
    const principal = document.getElementById(`loans.${id}.principal`) as HTMLInputElement;
    expect(principal).not.toBeNull();
    await user.clear(principal);
    await user.type(principal, '5000');
    await user.tab();
    await waitFor(() => expect(view.plan().loans[0].principal).toBe('5000.00'));
    await goToResults();
    await waitFor(() => expect(row('loans.none')).toBeNull());
    expect(row('loans.allZero')).toBeNull();
    expect(statusLine()?.textContent).not.toBe(before);
    expect(document.getElementById('results')!.textContent).toMatch(/5,000\.00/);
  });

  it('Add school costs → focus lands on the first year add-cost button; adding a cost clears costs.none', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: loanOnly() });
    const yearId = view.plan().schoolYears[0].id;
    await goToResults();
    await user.click(within(row('costs.none')!).getByRole('button'));
    await waitFor(() => expect(document.activeElement?.id).toBe(`schoolYears.${yearId}.costItems-add`));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(view.plan().schoolYears[0].costItems).toHaveLength(1));
    const amount = document.getElementById(`schoolYears.${yearId}.costItems.${view.plan().schoolYears[0].costItems[0].id}.amount`) as HTMLInputElement;
    await user.clear(amount);
    await user.type(amount, '9000');
    await user.tab();
    await goToResults();
    await waitFor(() => expect(row('costs.none')).toBeNull());
  });

  it('invalid draft: typing an invalid rate never reaches the store; correcting it recovers', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: complete() });
    act(() => navigateTo('loans'));
    // Expand the card through the same reveal mechanism the checklist uses.
    const { revealField } = await import('./reveal');
    act(() => { revealField('loans.L1.annualRate'); });
    await waitFor(() => expect(document.activeElement?.id).toBe('loans.L1.annualRate'));
    const rate = document.activeElement as HTMLInputElement;
    await user.clear(rate);
    await user.type(rate, 'x');
    await user.tab();
    expect(view.plan().loans[0].annualRate).toBe('0.065');
    expect(rate.getAttribute('aria-invalid')).toBe('true');
    await user.clear(rate);
    await user.type(rate, '5');
    await user.tab();
    await waitFor(() => expect(view.plan().loans[0].annualRate).toBe('0.05'));
    expect(rate.getAttribute('aria-invalid')).not.toBe('true');
  });
});

describe('persistence', () => {
  it('checklist state survives navigation and a reload from storage', async () => {
    const storage = memoryStorage(storedDocument(plan(p => { p.loans = [loan('A', '0.00')]; })));
    const first = renderPlanner({ storage });
    act(() => { first.store().updatePlan(p => ({ ...p, loans: p.loans.map(l => ({ ...l, principal: '7000.00' })) })); });
    act(() => navigateTo('income'));
    await goToResults();
    expect(row('loans.allZero')).toBeNull();
    await waitFor(() => expect(storage.data.get('debtnav.plan')).toContain('7000.00'));
    cleanup();
    renderPlanner({ storage });
    await goToResults();
    expect(row('loans.allZero')).toBeNull();
    expect(row('loans.none')).toBeNull();
  });
});

describe('accessibility', () => {
  it('checklist actions are native buttons in item order (keyboard reachable)', async () => {
    const p = plan(p => { p.loans = [loan('A', '0.00')]; p.postGradIncome.monthlyDebtBudget = '0.00'; });
    renderPlanner({ plan: p });
    await goToResults();
    const expected = readinessOf(p).items.filter(i => i.severity === 'missing' || i.severity === 'invalid').map(i => i.id);
    const rows = [...checklist().querySelectorAll<HTMLElement>('[data-readiness-id]')].map(el => el.dataset.readinessId);
    expect(rows.slice(0, expected.length)).toEqual(expected);
    for (const id of expected) {
      const button = within(row(id)!).getByRole('button');
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('tabindex')).not.toBe('-1');
      expect(button.hasAttribute('disabled')).toBe(false);
    }
  });

  it('valid zeros produce no "needs" rows', async () => {
    renderPlanner({ plan: complete(p => { p.loans[0].annualRate = '0'; p.loans[0].requiredPayment = { graceMonths: 0 }; p.loans[0].disbursementDate = '2030-05-20'; p.repayment.annualAGI = '0.00'; }) });
    await goToResults();
    expect(queryChecklistHeading()).toBeNull();
  });
});

describe('Costs: Create loan from gap (§8.10)', () => {
  it('is disabled when the year has no gap', async () => {
    renderPlanner({ plan: createDefaultPlan() });
    act(() => navigateTo('school'));
    const button = screen.getAllByRole('button', { name: /create loan from gap/i })[0];
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('is enabled when the year has a gap', async () => {
    renderPlanner({ plan: plan(p => { p.schoolYears[0].costItems = [cost('c', '5000.00')]; }) });
    act(() => navigateTo('school'));
    const button = screen.getAllByRole('button', { name: /create loan from gap/i })[0];
    expect(button.hasAttribute('disabled')).toBe(false);
  });
});

describe('follow-up guidance (brief §10 gaps)', () => {
  const sidebarLink = (name: string) => within(screen.getByRole('navigation', { name: 'Planner sections' })).getByRole('link', { name });
  const badgeText = (link: HTMLElement) => {
    const id = link.getAttribute('aria-describedby');
    return id ? document.getElementById(id)?.textContent ?? '' : '';
  };

  it('an invalid draft survives leaving its dashboard, is listed on Results and its action restores it', async () => {
    const user = userEvent.setup();
    const view = renderPlanner({ plan: complete() });
    act(() => navigateTo('loans'));
    const { revealField } = await import('./reveal');
    act(() => { revealField('loans.L1.annualRate'); });
    await waitFor(() => expect(document.activeElement?.id).toBe('loans.L1.annualRate'));
    await user.clear(document.activeElement as HTMLInputElement);
    await user.type(document.activeElement as HTMLInputElement, 'x');
    await user.tab();
    expect(view.plan().loans[0].annualRate).toBe('0.065');

    await goToResults();
    const draftRow = await waitFor(() => { const r = row('draft.loans.L1.annualRate'); expect(r).not.toBeNull(); return r!; });
    expect(draftRow.dataset.severity).toBe('invalid');
    expect(badgeText(sidebarLink('Loans'))).toMatch(/1 item needed/);

    await user.click(within(draftRow).getByRole('button', { name: /fix this value/i }));
    await waitFor(() => expect(document.activeElement?.id).toBe('loans.L1.annualRate'));
    const rate = document.activeElement as HTMLInputElement;
    expect(rate.value).toBe('x');
    expect(rate.getAttribute('aria-invalid')).toBe('true');

    await user.clear(rate);
    await user.type(rate, '5');
    await user.tab();
    await waitFor(() => expect(view.plan().loans[0].annualRate).toBe('0.05'));
    await goToResults();
    await waitFor(() => expect(row('draft.loans.L1.annualRate')).toBeNull());
  });

  it('sidebar badges show missing + invalid counts per dashboard, as a description that keeps the link name', async () => {
    const p = createDefaultPlan();
    const expected = readinessOf(p).byDashboard;
    const view = renderPlanner({ plan: p });
    expect(expected.loans).toBeGreaterThan(0);
    for (const item of [['Loans', expected.loans], ['Costs', expected.school], ['Results', expected.results]] as const) {
      const link = sidebarLink(item[0]);
      if (item[1]) expect(badgeText(link), item[0]).toBe(`${item[1]} item${item[1] === 1 ? '' : 's'} needed`);
      else expect(link.hasAttribute('aria-describedby'), item[0]).toBe(false);
    }
    // The visible count is hidden from assistive tech (the description carries it).
    const badge = sidebarLink('Loans').querySelector('.shell-badge');
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
    expect(badge?.textContent).toBe(String(expected.loans));

    act(() => { view.store().updatePlan(plan => ({ ...plan, loans: [loan('L1', '5000.00')] })); });
    await waitFor(() => expect(sidebarLink('Loans').hasAttribute('aria-describedby')).toBe(false));
  });

  it('following a checklist action shows "Back to Results" on the destination; other navigation clears it', async () => {
    const user = userEvent.setup();
    renderPlanner({ plan: complete(p => { p.postGradIncome.monthlyDebtBudget = '0.00'; }) });
    await goToResults();
    expect(screen.queryByRole('link', { name: /back to/i })).toBeNull();
    await user.click(within(row('budget.zero')!).getByRole('button'));
    await waitFor(() => expect(document.activeElement?.id).toBe('postGradIncome.monthlyDebtBudget'));
    await user.click(screen.getByRole('link', { name: 'Back to Results' }));
    await waitFor(() => expect(window.location.hash).toBe('#results'));
    expect(document.querySelector('.dashboard')?.getAttribute('data-dashboard')).toBe('results');
    expect(screen.queryByRole('link', { name: /back to/i })).toBeNull();

    await user.click(within(row('budget.zero')!).getByRole('button'));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Back to Results' })).toBeTruthy());
    act(() => navigateTo('loans'));
    expect(screen.queryByRole('link', { name: /back to/i })).toBeNull();
  });

  it('actions followed from Overview offer "Back to Overview"', async () => {
    const user = userEvent.setup();
    renderPlanner({ plan: createDefaultPlan() });
    act(() => navigateTo('overview'));
    const action = within(screen.getByRole('main')).getAllByRole('button', { name: /add a loan/i })[0];
    await user.click(action);
    await waitFor(() => expect(window.location.hash).toBe('#loans'));
    expect(screen.getByRole('link', { name: 'Back to Overview' })).toBeTruthy();
  });

  // US-506 replaced the user-facing projection horizon (and its "Lengthen projection horizon" action) with an
  // internal 100-year cap: the only action left is the budget, which opens Repayment Plan.
  it('payoff beyond the modeled limit: the checklist says so and its budget action opens Repayment Plan', async () => {
    const user = userEvent.setup();
    const base = complete();
    const outputs = calculatePlannerOutputs(base);
    if (!outputs.ok || !outputs.value.repayment) throw new Error('precondition');
    const interest = Number(outputs.value.repayment.balanceAtRepaymentStart) * 0.065 / 12;
    renderPlanner({ plan: complete(p => { p.postGradIncome.monthlyDebtBudget = (Math.ceil(interest * 100) / 100 + 0.05).toFixed(2); }) });
    await goToResults();
    const nonPayoff = await waitFor(() => { const r = row('repayment.nonPayoff'); expect(r, document.querySelector('.readiness')?.textContent ?? '').not.toBeNull(); return r!; });
    expect(nonPayoff.textContent).toMatch(/modeled limit of 100 years/);
    expect(within(nonPayoff).getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /horizon/i })).toBeNull();
    await user.click(within(nonPayoff).getByRole('button', { name: /budget/i }));
    await waitFor(() => expect(window.location.hash).toBe('#repayment'));
    await waitFor(() => expect(document.activeElement?.id).toBe('postGradIncome.monthlyDebtBudget'));
    expect(screen.getByRole('link', { name: 'Back to Results' })).toBeTruthy();
    expect(screen.queryByLabelText(/projection horizon/i)).toBeNull();
  });
});
