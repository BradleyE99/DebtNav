/**
 * Independent acceptance checks for the simplified app (tester), team/test-plan.md A1–A19.
 * Numbers come from the tester's reference model (R1, R6, R7, R8, R10); none are read back from the engine.
 * Run: E2E_PORT=58xx npx playwright test e2e/simplified.spec.ts
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect, goTo, openPlanner, seedPlan, getPlan, secondDevice, openSections } from './support/fixtures';

/* eslint-disable @typescript-eslint/no-explicit-any */
const nav = (page: Page) => page.getByRole('navigation', { name: 'Planner sections' });
const R = '2030-11-20';
const loan = (id: string, principal: string, annualRate: string, extra: Record<string, unknown> = {}) => ({
  id, name: `Loan ${id}`, type: 'unsubsidized', principal, annualRate, disbursementDate: R, termMonths: 120, academicYear: 'unassigned', ...extra,
});
const windfall = (id: string, date: string, amount: string, pct: string) => ({ id, name: id, type: 'windfall', date, amount, allocationPercent: pct, recurrence: 'once' });
const income = (id: string, date: string, amount: string, pct: string) => ({ id, name: id, type: 'income', date, amount, allocationPercent: pct, recurrence: 'once' });
function repaymentPlan(plan: any, loans: unknown[], budget: string, lifeEvents: unknown[] = []) {
  plan.loans = loans;
  plan.lifeEvents = lifeEvents;
  plan.postGradIncome.annualSalary = '55000.00';
  plan.postGradIncome.monthlyDebtBudget = budget;
  plan.repayment.strategyId = 'avalanche';
  plan.repayment.extraMonthlyPayment = '0.00';
  plan.repayment.customOrder = [];
  plan.repayment.payoffTarget = { mode: 'budget' };
  plan.repayment.voluntaryStart = { kind: 'afterGraduation', months: 6 };
}
async function retype(page: Page, field: Locator, value: string) {
  await field.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(value);
  await field.blur();
}
/** Opens one Results section (idempotent: a summary click would close a section that is open by default). */
async function openSection(page: Page, id: string) {
  await page.locator(`#results-${id}`).evaluate(el => { (el as HTMLDetailsElement).open = true; });
}
const headline = (page: Page, id: string) => page.getByTestId(`headline-${id}`);
async function openBreakdown(page: Page, count: '5' | '10' | 'all' = 'all', basis: 'calendar' | 'repayment' = 'calendar') {
  await openSection(page, 'breakdown');
  await page.locator('#breakdown-years').selectOption(count);
  await page.locator(`input[name="breakdown-basis"][value="${basis}"]`).check();
  return page.getByRole('table').filter({ has: page.locator('caption', { hasText: /calendar year|repayment year/ }) });
}

test.beforeEach(async ({ page, user }) => { await openPlanner(page, user); });

test('A1: exactly four primary destinations, in order', async ({ page }) => {
  const links = nav(page).getByRole('link');
  await expect(links).toHaveCount(4);
  for (const [i, name] of ['Introduction', 'College Costs', 'Loan Amounts', 'Results'].entries()) await expect(links.nth(i)).toHaveAccessibleName(name);
  for (const old of ['Timeline', 'Income', 'Repayment Plan', 'Life events', 'Scenarios', 'Federal', 'Your data']) {
    await expect(nav(page).getByRole('link', { name: old, exact: true })).toHaveCount(0);
  }
});

test('A12: old hashes land on the new homes', async ({ page }) => {
  for (const [legacy, home] of [['setup', 'school'], ['income', 'school'], ['school', 'school'], ['repayment', 'results'], ['events', 'results']]) {
    await page.goto(`/?v=${legacy}#${legacy}`);
    await expect(page.locator('.dashboard')).toHaveAttribute('data-dashboard', home);
  }
});

test('A2: an existing user recovers the saved plan on another device', async ({ page, context, user }) => {
  await seedPlan(page, plan => repaymentPlan(plan, [loan('keep', '12345.00', '0.05', { name: 'Recovered loan' })], '400.00'));
  const other = await secondDevice(context, user);
  await goTo(other, 'loans');
  await expect(other.locator('article.loan-card')).toHaveCount(1);
  await expect(other.locator('article.loan-card')).toContainText('Recovered loan');
  await expect(other.locator('article.loan-card')).toContainText('$12,345.00');
});

test('A3/A4: College Costs totals (R1) and a loan edit on Loan Amounts updates them; academic year intact', async ({ page }) => {
  await seedPlan(page, plan => {
    repaymentPlan(plan, [
      loan('y1a', '8000.00', '0.0639', { disbursementDate: '2026-08-24', academicYear: '2026-2027' }),
      loan('y1b', '3000.00', '0.0639', { disbursementDate: '2027-01-10', academicYear: '2026-2027' }),
    ], '400.00');
    plan.schoolYears[0].costItems = [
      { id: 'tuition', category: 'tuition', label: 'Tuition', amount: '20000.00', semester: 'annual' },
      { id: 'housing', category: 'housing', label: 'Housing', amount: '5000.00', semester: 'annual' },
    ];
    const res = (id: string, type: string, amount: string, extra = {}) => ({ id, type, label: id, amount, incomeMode: 'fixed', hourlyWage: '0', hoursPerWeek: '0', weeksWorked: '0', unavailablePercent: '0', ...extra });
    plan.schoolYears[0].resources = [res('pell', 'grant', '6000.00'), res('merit', 'scholarship', '2000.00'),
      res('job', 'job', '0.00', { incomeMode: 'hourly', hourlyWage: '15.00', hoursPerWeek: '10', weeksWorked: '30', unavailablePercent: '20' })];
  });
  await goTo(page, 'school');
  const totals = page.locator('dl.gap-figures');
  await expect(totals).toContainText('$25,000.00');
  await expect(totals).toContainText('$11,600.00');
  await expect(totals).toContainText('$13,400.00');
  await expect(totals).toContainText('$11,000.00');
  await expect(totals.locator('.gap-remaining')).toContainText('$2,400.00');

  await goTo(page, 'loans');
  const card = page.locator('article.loan-card').filter({ hasText: 'Loan y1a' });
  await card.locator('.loan-card__toggle').click();
  await retype(page, card.locator('[id="loans.y1a.principal"]'), '9000');
  await expect(card.locator('.loan-card__summary')).toContainText('2026');
  await goTo(page, 'school');
  await expect(page.locator('dl.gap-figures .gap-remaining')).toContainText('$1,400.00');
  const saved = await getPlan(page.request);
  await expect.poll(async () => ((await getPlan(page.request)).document!.plan as any).loans.find((l: any) => l.id === 'y1a').principal).toBe('9000.00');
  expect((saved.document!.plan as any).loans.map((l: any) => l.academicYear)).toEqual(['2026-2027', '2026-2027']);
});

test('A5/A19: bonus split and raise effect are visible and change the headline (R6, R7)', async ({ page }) => {
  await seedPlan(page, plan => repaymentPlan(plan, [loan('f', '30000.00', '0.065')], '400.00', [windfall('bonus', '2032-06-15', '5000.00', '60')]));
  await goTo(page, 'results');
  await expect(headline(page, 'total-debt')).toContainText('$30,000.00');
  await expect(headline(page, 'debt-free')).toContainText('Jan 2038');
  await expect(headline(page, 'interest')).toContainText('$7,163.66');
  await openSection(page, 'bonuses');
  await expect(page.locator('#results-bonuses')).toContainText(/To debt:\s*\$3,000\.00\s*·\s*Kept:\s*\$2,000\.00/);

  await seedPlan(page, plan => repaymentPlan(plan, [loan('g', '30000.00', '0.065')], '400.00', [income('raise', '2033-01-01', '65000.00', '30')]));
  await goTo(page, 'results');
  await expect(headline(page, 'debt-free')).toContainText('May 2036');
  await expect(headline(page, 'interest')).toContainText('$6,424.73');
  await openSection(page, 'income-changes');
  await expect(page.locator('#results-income-changes')).toContainText('Payment $400.00 → $650.00/mo from Jan 2033');
});

test('A6: yearly rows reconcile (R10) and the display count / basis never change results', async ({ page }) => {
  await seedPlan(page, plan => repaymentPlan(plan, [loan('f', '30000.00', '0.065')], '400.00'));
  await goTo(page, 'results');
  const before = await Promise.all(['total-debt', 'payment', 'debt-free', 'time', 'interest'].map(id => headline(page, id).innerText()));
  let table = await openBreakdown(page, 'all', 'calendar');
  await expect(table.locator('tbody tr')).toHaveCount(9);
  await expect(table.locator('tbody tr').nth(0)).toContainText('$30,000.00');
  await expect(table.locator('tbody tr').nth(0)).toContainText('$162.50');
  await expect(table.locator('tbody tr').nth(1)).toContainText('$1,847.64');
  await expect(table.locator('tbody tr').nth(8)).toContainText('$4,600.22');
  await expect(table.locator('tfoot')).toContainText('$38,600.22');
  await expect(table.locator('tfoot')).toContainText('$8,600.22');
  const footer = await table.locator('tfoot').innerText();
  table = await openBreakdownAgain(page, '5', 'calendar');
  await expect(table.locator('tbody tr')).toHaveCount(5);
  expect(await table.locator('tfoot').innerText()).toBe(footer);
  table = await openBreakdownAgain(page, 'all', 'repayment');
  await expect(table.locator('tbody tr').nth(0)).toContainText('$1,863.55');
  await expect(table.locator('tbody tr').nth(8)).toContainText(/1 month/);
  const after = await Promise.all(['total-debt', 'payment', 'debt-free', 'time', 'interest'].map(id => headline(page, id).innerText()));
  expect(after).toEqual(before);
  // A18 (D7): durations are months of payments, never "N payments".
  await expect(page.locator('#results-breakdown')).toContainText('97 months of payments');
  // "12 payments from your first payment" (repayment-year caption) defines the basis, not a duration.
  expect((await page.locator('#results').innerText()).replace('12 payments from your first payment', '')).not.toMatch(/\b\d+ payments\b/);
});
async function openBreakdownAgain(page: Page, count: '5' | '10' | 'all', basis: 'calendar' | 'repayment') {
  await page.locator('#breakdown-years').selectOption(count);
  await page.locator(`input[name="breakdown-basis"][value="${basis}"]`).check();
  return page.getByRole('table').filter({ has: page.locator('caption', { hasText: /calendar year|repayment year/ }) });
}

test('A7/A15: non-payoff (R8) is explained once, with the remaining balance and no date', async ({ page }) => {
  await seedPlan(page, plan => repaymentPlan(plan, [loan('h', '30000.00', '0.065')], '150.00'));
  await goTo(page, 'results');
  await expect(headline(page, 'debt-free')).toContainText('No debt-free date');
  await expect(headline(page, 'interest')).not.toContainText('$0.00');
  const main = await page.locator('#results').innerText();
  // UX A15: the reason appears once (baseline: 4 — checklist + 3 headline figures).
  expect(main.match(/(don.t|do not) cover (the )?interest/gi)?.length ?? 0).toBeLessThanOrEqual(1);
  await openBreakdown(page, 'all');
  await expect(page.locator('#results-breakdown')).toContainText('Not paid off: $30,012.50');
});

test('A7: invalid typed money is rejected without fake results', async ({ page }) => {
  await seedPlan(page, plan => repaymentPlan(plan, [loan('f', '30000.00', '0.065')], '400.00'));
  await goTo(page, 'results');
  await openSection(page, 'earnings');
  const field = page.locator('[id="postGradIncome.monthlyDebtBudget"]');
  await retype(page, field, 'abc');
  await expect(page.locator('#results')).toContainText(/enter|number|amount/i);
  await expect(headline(page, 'debt-free')).not.toContainText('$0.00');
  expect(((await getPlan(page.request)).document!.plan as any).postGradIncome.monthlyDebtBudget).toBe('400.00');
});

test('A14: missing inputs say "Needs …" with a link that reaches the field; no $0 or date', async ({ page }) => {
  await seedPlan(page, plan => repaymentPlan(plan, [], '400.00'));
  await goTo(page, 'results');
  for (const id of ['debt-free', 'interest']) {
    await expect(headline(page, id)).not.toContainText(/\$0\.00|\b20\d\d\b/);
  }
  await expect(page.locator('#results')).toContainText(/Needs/);
  const action = page.getByRole('button', { name: /add a loan/i }).or(page.getByRole('link', { name: /add a loan/i })).first();
  await action.click();
  await expect(page.locator('.dashboard')).toHaveAttribute('data-dashboard', 'loans');
});

test('A13/A11: account menu holds data, undo history and sign out; undo reverts a Results edit', async ({ page }) => {
  await seedPlan(page, plan => repaymentPlan(plan, [loan('f', '30000.00', '0.065')], '400.00'));
  await goTo(page, 'results');
  await openSection(page, 'earnings');
  const field = page.locator('[id="postGradIncome.monthlyDebtBudget"]');
  await retype(page, field, '500');
  await expect(headline(page, 'payment')).toContainText('$500.00');
  await page.getByRole('group', { name: 'Undo' }).getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(headline(page, 'payment')).toContainText('$400.00');
  await page.getByRole('button', { name: /^Account/ }).click();
  for (const name of ['Your data', 'Undo history', 'Sign out']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Your data', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Your data' })).toContainText(/Export/i);
});

test('A9: keyboard reaches every destination and the yearly breakdown', async ({ page }) => {
  await seedPlan(page, plan => repaymentPlan(plan, [loan('f', '30000.00', '0.065')], '400.00'));
  for (const id of ['school', 'loans', 'results', 'overview']) {
    await nav(page).locator(`a[href="#${id}"]`).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.dashboard')).toHaveAttribute('data-dashboard', id);
    await expect(page.locator(`#${id}-heading`)).toBeFocused();
  }
  await nav(page).locator('a[href="#results"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('#results-breakdown > summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#results-breakdown')).toHaveAttribute('open', '');
  await page.locator('#breakdown-years').focus();
  await expect(page.locator('#breakdown-years')).toBeFocused();
});

test('A10/A16: 360 px — no horizontal scroll on any destination; first-visit height targets', async ({ page }) => {
  await seedPlan(page, plan => repaymentPlan(plan, [loan('f', '30000.00', '0.065')], '400.00'));
  await page.setViewportSize({ width: 360, height: 780 });
  const heights: Record<string, number> = {};
  for (const id of ['overview', 'school', 'loans', 'results']) {
    await page.goto(`/#${id}`);
    await expect(page.locator('.dashboard')).toHaveAttribute('data-dashboard', id);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${id} horizontal overflow`).toBeLessThanOrEqual(0);
    heights[id] = await page.evaluate(() => document.documentElement.scrollHeight / window.innerHeight);
  }
  test.info().annotations.push({ type: 'heights@360', description: JSON.stringify(heights) });
  for (const [id, screens] of Object.entries(heights)) expect.soft(screens, `${id} screens at 360×780`).toBeLessThanOrEqual(2.5);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const id of ['overview', 'school', 'loans', 'results']) {
    await page.goto(`/#${id}`);
    await expect(page.locator('.dashboard')).toHaveAttribute('data-dashboard', id);
    const screens = await page.evaluate(() => document.documentElement.scrollHeight / window.innerHeight);
    expect.soft(screens, `${id} screens at 1440×900`).toBeLessThanOrEqual(1.3);
  }
});

test('A8/A17: hidden data (scenarios, aid/expense events, federal settings) survives edits in the simplified UI', async ({ page }) => {
  await seedPlan(page, plan => {
    repaymentPlan(plan, [loan('f', '30000.00', '0.065', { academicYear: '2026-2027', disbursementDate: '2026-08-24' })], '400.00', [
      windfall('bonus', '2032-06-15', '5000.00', '60'),
      { id: 'aid', name: 'Extra aid', type: 'aid', date: '2027-02-01', amount: '2000.00', allocationPercent: '0' },
      { id: 'exp', name: 'Laptop', type: 'expense', date: '2027-01-05', amount: '1500.00', allocationPercent: '0' },
    ]);
    plan.scenarios = [{ id: 's1', name: 'Higher payment', overrides: { 'postGradIncome.monthlyDebtBudget': '900.00' } }];
    Object.assign(plan.repayment, { mode: 'federal', federalPlan: 'ibr', familySize: 3, annualAGI: '61000.00' });
  });
  const before = (await getPlan(page.request)).document!.plan as any;
  await goTo(page, 'results');
  await openSection(page, 'earnings');
  await retype(page, page.locator('[id="postGradIncome.monthlyDebtBudget"]'), '450');
  await expect.poll(async () => ((await getPlan(page.request)).document!.plan as any).postGradIncome.monthlyDebtBudget).toBe('450.00');
  const after = (await getPlan(page.request)).document!.plan as any;
  expect(after.scenarios).toEqual(before.scenarios);
  expect(after.lifeEvents).toEqual(before.lifeEvents);
  expect(after.loans).toEqual(before.loans);
  expect({ ...after.repayment }).toEqual({ ...before.repayment });
  expect({ ...after, postGradIncome: { ...after.postGradIncome, monthlyDebtBudget: '400.00' } }).toEqual(before);
});

test('P2 (UI): time until debt-free counts from today', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-17T12:00:00Z'));
  await seedPlan(page, plan => repaymentPlan(plan, [loan('a', '30000.00', '0.065')], '340.64'));
  await goTo(page, 'results');
  await expect(headline(page, 'debt-free')).toContainText('Nov 2040');
  await expect(headline(page, 'time')).toContainText('14 yr 1 mo');
  await openSections(page);
});
