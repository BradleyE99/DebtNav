// @vitest-environment jsdom
/** US-507 per-loan required-payment settings on the compact loan cards. */
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { navigateTo, renderPlanner, samplePlan } from '../testing/renderPlanner';
import { revealField } from '../reveal';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

const byId = (id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`No element with id ${id}`);
  return element as HTMLInputElement;
};
const card = (id: string) => byId(`loans.${id}-heading`).closest('article') as HTMLElement;
const open = async (id: string) => { await userEvent.click(within(byId(`loans.${id}-heading`)).getByRole('button')); };

it('federal loans show the labeled 6-month estimate and accept an actual first due date', async () => {
  const user = userEvent.setup();
  const view = renderPlanner({ plan: samplePlan() });
  navigateTo('loans');
  // The collapsed summary shows the first required payment.
  expect(card('loan-a').querySelector('.loan-card__summary')?.textContent).toContain('First required payment Dec 2030');
  await open('loan-a');
  const terms = within(card('loan-a')).getByRole('group', { name: 'When payments are required' });
  expect(terms.textContent).toMatch(/estimated 6 months after graduation/);
  expect(within(terms).queryByLabelText("Lender's payment terms")).toBeNull();
  await user.type(byId('loans.loan-a.requiredPayment.firstDueDate'), '2030-09-15');
  expect(view.plan().loans[0].requiredPayment).toEqual({ firstDueDate: '2030-09-15' });
  expect(terms.textContent).toContain('First required payment: Sep 15, 2030');
  // Clearing the date removes the override (no empty object is stored).
  await user.clear(byId('loans.loan-a.requiredPayment.firstDueDate'));
  expect(view.plan().loans[0].requiredPayment).toBeUndefined();
});

it('private loans have no default grace: "Not set" until the lender\'s terms are entered', async () => {
  const user = userEvent.setup();
  const view = renderPlanner({ plan: samplePlan() });
  navigateTo('loans');
  expect(card('loan-b').querySelector('.loan-card__summary')?.textContent).toContain('First required payment Not set');
  await open('loan-b');
  const select = byId('loans.loan-b.requiredPayment') as unknown as HTMLSelectElement;
  expect(select.value).toBe('notSet');

  // Choosing a grace period stores nothing until a number is entered.
  await user.selectOptions(select, 'grace');
  const grace = byId('loans.loan-b.requiredPayment.graceMonths');
  expect(grace.value).toBe('');
  expect(view.plan().loans[1].requiredPayment).toBeUndefined();
  await user.type(grace, '0');
  expect(view.plan().loans[1].requiredPayment).toEqual({ graceMonths: 0 });
  expect(card('loan-b').textContent).toContain('First required payment: Jun 20, 2030');
  await user.clear(grace);
  await user.type(grace, '61');
  expect(grace.getAttribute('aria-invalid')).toBe('true');

  await user.selectOptions(select, 'inSchool');
  expect(view.plan().loans[1].requiredPayment).toEqual({ inSchoolPayments: true });
  expect(screen.queryByLabelText('Grace period (months after graduation)')).toBeNull();

  await user.selectOptions(select, 'notSet');
  expect(view.plan().loans[1].requiredPayment).toBeUndefined();
});

it('the readiness item for unset private terms opens the loan card at its terms', async () => {
  renderPlanner({ plan: samplePlan() });
  navigateTo('results');
  act(() => { revealField('loans.loan-b.requiredPayment'); });
  await waitFor(() => expect(document.activeElement?.id).toBe('loans.loan-b.requiredPayment'));
  expect(within(byId('loans.loan-b-heading')).getByRole('button').getAttribute('aria-expanded')).toBe('true');
});
