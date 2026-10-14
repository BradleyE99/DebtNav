import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

// ------------------------------------------------------------------ helpers (real mouse + keyboard input)

/** Click into a field, select everything, delete it with the keyboard, then type like a person. */
async function retype(page: Page, field: Locator, text: string) {
  await field.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await expect(field).toHaveValue('');
  if (text) await page.keyboard.type(text);
}

/** Valid fields drop aria-invalid entirely (it is never "false"). */
const expectValid = (field: Locator) => expect(field).not.toHaveAttribute('aria-invalid', 'true');
const expectInvalid = (field: Locator) => expect(field).toHaveAttribute('aria-invalid', 'true');

/** Types a date into a native date input: click the month segment, then type MMDDYYYY and press Enter. */
async function typeDate(page: Page, field: Locator, mmddyyyy: string) {
  await field.click({ position: { x: 16, y: 22 } });
  await page.keyboard.type(mmddyyyy);
  await page.keyboard.press('Enter');
}

const byId = (page: Page, id: string) => page.locator(`[id="${id}"]`);
const yearCard = (page: Page, n: number) => page.locator('article.year-card').nth(n - 1);
const costRows = (card: Locator) => card.locator('li.record').filter({ has: card.page().locator('[id*=".costItems."]') });
const resourceRows = (card: Locator) => card.locator('li.record').filter({ has: card.page().locator('[id*=".resources."]') });
const gapFigure = (card: Locator, label: string | RegExp) => card.locator('.gap-figures > div').filter({ hasText: label }).locator('dd');
const loanCard = (page: Page, name: string | RegExp) => page.locator('article.loan-card').filter({ has: page.getByRole('heading', { name }) });
const keyFigure = (page: Page, id: 'key-debt-free' | 'key-interest' | 'key-gap') => page.getByTestId(id);

async function dismissDisclaimer(page: Page) {
  await page.getByRole('button', { name: 'I understand' }).click();
  await expect(page.getByRole('heading', { name: 'Estimates, not financial advice' })).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

// ------------------------------------------------------------------ the full journey

test('complete planning journey with real typing, persistence, export/import and deletion', async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await test.step('US-103 disclaimer: shown first, dismissible, reopenable from the footer', async () => {
    const heading = page.getByRole('heading', { name: 'Estimates, not financial advice' });
    await expect(heading).toBeVisible();
    await dismissDisclaimer(page);
    await page.getByRole('button', { name: 'About these estimates (disclaimer)' }).click();
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await page.getByRole('button', { name: 'I understand' }).click();
    await expect(heading).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'About these estimates (disclaimer)' })).toBeFocused();
  });

  await test.step('US-101/102 school dates and grace period', async () => {
    await expect(page.locator('article.year-card')).toHaveCount(4);
    const start = byId(page, 'settings.startDate');
    await typeDate(page, start, '08262026');
    await expect(start).toHaveValue('2026-08-26');
    await expect(yearCard(page, 1).locator('h3')).toContainText('Aug 26, 2026');

    const graduation = byId(page, 'settings.graduationDate');
    await typeDate(page, graduation, '05202031');
    await expect(graduation).toHaveValue('2031-05-20');
    await expect(page.locator('article.year-card')).toHaveCount(5);
    // Graduation before start: field error, plan unchanged.
    await typeDate(page, graduation, '05202025');
    await expectInvalid(graduation);
    await expect(page.locator('article.year-card')).toHaveCount(5);
    await typeDate(page, graduation, '05202030');
    await expectValid(graduation);
    await expect(page.locator('article.year-card')).toHaveCount(4);

    const grace = byId(page, 'settings.graceMonths');
    await retype(page, grace, '');
    await expectInvalid(grace);
    await expect(byId(page, 'settings.graceMonths-error')).toBeVisible();
    await page.keyboard.type('13');
    await expectInvalid(grace);
    await retype(page, grace, '3');
    await expectValid(grace);
    await expect(page.locator('#setup')).toContainText('Repayment starts Aug 20, 2030');
    await retype(page, grace, '6');
    await expect(page.locator('#setup')).toContainText('Repayment starts Nov 20, 2030');
  });

  const year1 = yearCard(page, 1);
  await test.step('US-201 costs: add, clear (error, not zero), type, edit, remove', async () => {
    const amounts = ['12000', '9500', '1200'];
    const categories = ['tuition', 'housing', 'books'];
    for (let i = 0; i < amounts.length; i++) {
      await page.getByRole('button', { name: 'Add cost to Year 1' }).click();
      const row = costRows(year1).nth(i);
      await row.locator('select[id$=".category"]').selectOption(categories[i]);
      const amount = row.locator('input[id$=".amount"]');
      await retype(page, amount, '');
      await expectInvalid(amount);
      await expect(row.locator('.field-error')).toContainText('Enter a dollar amount');
      await page.keyboard.type(amounts[i]);
      await expectValid(amount);
    }
    await retype(page, costRows(year1).nth(1).locator('input[id$=".label"]'), 'Dorm');
    await expect(year1.locator('.subtotal-total dd')).toHaveText('$22,700.00');

    // Invalid text stays visible with an error; the total is unchanged (NFR-11).
    const tuition = costRows(year1).nth(0).locator('input[id$=".amount"]');
    await retype(page, tuition, 'abc');
    await expect(tuition).toHaveValue('abc');
    await expectInvalid(tuition);
    await expect(year1.locator('.subtotal-total dd')).toHaveText('$22,700.00');
    await retype(page, tuition, '-5');
    await expectInvalid(tuition);
    await retype(page, tuition, '12,000');
    await expectValid(tuition);

    // Add and remove an extra item.
    await page.getByRole('button', { name: 'Add cost to Year 1' }).click();
    await retype(page, costRows(year1).nth(3).locator('input[id$=".amount"]'), '500');
    await expect(year1.locator('.subtotal-total dd')).toHaveText('$23,200.00');
    await costRows(year1).nth(3).getByRole('button', { name: /^Remove cost/ }).click();
    await expect(costRows(year1)).toHaveCount(3);
    await expect(year1.locator('.subtotal-total dd')).toHaveText('$22,700.00');
  });

  await test.step('US-202 copy forward with a percentage increase', async () => {
    const year2 = yearCard(page, 2);
    await retype(page, year2.locator('input[id^="copy-"]'), '3');
    await year2.getByRole('button', { name: 'Copy Year 1 costs into Year 2' }).click();
    await expect(costRows(year2)).toHaveCount(3);
    await expect(year2.locator('.subtotal-total dd')).toHaveText('$23,381.00');
    await expect(costRows(year2).nth(0).locator('input[id$=".amount"]')).toHaveValue('12,360.00');
  });

  await test.step('US-203 semester costs', async () => {
    const year3 = yearCard(page, 3);
    for (const [period, amount] of [['fall', '10000'], ['spring', '10500']] as const) {
      await page.getByRole('button', { name: 'Add cost to Year 3' }).click();
      const row = costRows(year3).last();
      await row.locator('select[id$=".semester"]').selectOption(period);
      await retype(page, row.locator('input[id$=".amount"]'), amount);
    }
    await expect(year3.locator('.subtotals')).toContainText('Fall subtotal$10,000.00');
    await expect(year3.locator('.subtotals')).toContainText('Spring subtotal$10,500.00');
    await expect(year3.locator('.subtotal-total dd')).toHaveText('$20,500.00');
  });

  await test.step('US-301/302/303 resources incl. hourly job income, fixed amount, unavailable %', async () => {
    // Grant $4,000.
    await page.getByRole('button', { name: 'Add resource to Year 1' }).click();
    await retype(page, resourceRows(year1).nth(0).locator('input[id$=".amount"]'), '4000');
    await expect(gapFigure(year1, 'Resources')).toHaveText('$4,000.00');
    await expect(gapFigure(year1, /^Borrowing gap/)).toHaveText('$18,700.00');

    // Job: hourly $15 × 15 h × 30 weeks = $6,750.
    await page.getByRole('button', { name: 'Add resource to Year 1' }).click();
    const job = resourceRows(year1).nth(1);
    await job.locator('select[id$=".type"]').selectOption('job');
    await job.locator('select[id$=".incomeMode"]').selectOption('hourly');
    await retype(page, job.locator('input[id$=".hourlyWage"]'), '15.00');
    await retype(page, job.locator('input[id$=".hoursPerWeek"]'), '15');
    await retype(page, job.locator('input[id$=".weeksWorked"]'), '30');
    await expect(job.locator('.record-result')).toHaveText('Counts as $6,750.00');
    const hours = job.locator('input[id$=".hoursPerWeek"]');
    await retype(page, hours, '-1');
    await expectInvalid(hours);
    await expect(job.locator('.record-result')).toHaveText('Counts as $6,750.00');
    await retype(page, hours, '15');
    // 40% unavailable → only 60% counts.
    const unavailable = job.locator('input[id$=".unavailablePercent"]');
    await retype(page, unavailable, '40');
    await expect(job.locator('.record-result')).toHaveText('Counts as $4,050.00');
    await retype(page, unavailable, '0');
    // Fixed yearly amount instead.
    await job.locator('select[id$=".incomeMode"]').selectOption('fixed');
    await retype(page, job.locator('input[id$=".amount"]'), '3000');
    await expect(job.locator('.record-result')).toHaveText('Counts as $3,000.00');
    await job.locator('select[id$=".incomeMode"]').selectOption('hourly');
    await expect(job.locator('.record-result')).toHaveText('Counts as $6,750.00');

    // Savings $2,000 and family help (added then removed).
    await page.getByRole('button', { name: 'Add resource to Year 1' }).click();
    const savings = resourceRows(year1).nth(2);
    await savings.locator('select[id$=".type"]').selectOption('savings');
    await retype(page, savings.locator('input[id$=".amount"]'), '2000');
    await page.getByRole('button', { name: 'Add resource to Year 1' }).click();
    const family = resourceRows(year1).nth(3);
    await family.locator('select[id$=".type"]').selectOption('family');
    await retype(page, family.locator('input[id$=".amount"]'), '750');
    await expect(gapFigure(year1, 'Resources')).toHaveText('$13,500.00');
    await family.getByRole('button', { name: /^Remove resource/ }).click();
    await expect(resourceRows(year1)).toHaveCount(3);

    // US-304: cost 22,700 − resources 12,750 = gap 9,950, labeled as a calculation.
    await expect(gapFigure(year1, 'Resources')).toHaveText('$12,750.00');
    await expect(gapFigure(year1, /^Borrowing gap/)).toHaveText('$9,950.00');
    await expect(year1.locator('.gap-main dt')).toContainText('a calculation, not a recommendation');
    await expect(keyFigure(page, 'key-gap')).not.toHaveText('$0.00');
  });

  await test.step('US-305 borrowing buffer', async () => {
    await retype(page, year1.locator('input[id$=".bufferPercent"]'), '5');
    await expect(gapFigure(year1, 'Gap + your buffer')).toHaveText('$10,447.50');
  });

  await test.step('US-402 create a loan from the gap; mismatch notice when the gap changes', async () => {
    await page.getByRole('button', { name: 'Create loan from gap for Year 1' }).click();
    const loan = loanCard(page, /^Year 1 loan/);
    await expect(loan.locator('input[id$=".principal"]')).toHaveValue('10,447.50');
    await expect(loan.locator('input[id$=".disbursementDate"]')).toHaveValue('2026-08-26');
    await expect(loan.locator('input[id$=".name"]')).toBeFocused();
    await expect(page.getByRole('region', { name: 'School year summary table' }).locator('tbody tr').first()).toContainText('$10,447.50');

    await retype(page, costRows(year1).nth(1).locator('input[id$=".amount"]'), '10500');
    await expect(year1.locator('.notice--warning')).toContainText('no longer matches');
    await expect(loan.locator('.notice--warning')).toContainText('The loan was not changed');
    await expect(loan.locator('input[id$=".principal"]')).toHaveValue('10,447.50');
  });

  await test.step('US-401/403/404 add, edit and remove loans; rate validation; in-school interest', async () => {
    await page.getByRole('button', { name: 'Add loan' }).click();
    const loan2 = page.locator('article.loan-card').nth(1);
    await expect(loan2.locator('input[id$=".name"]')).toBeFocused();
    await retype(page, loan2.locator('input[id$=".name"]'), 'Bank loan');
    await loan2.locator('select[id$=".type"]').selectOption('private');
    await retype(page, loan2.locator('input[id$=".principal"]'), '8000');
    const rate = loan2.locator('input[id$=".annualRate"]');
    await retype(page, rate, '31');
    await expectInvalid(rate);
    await expect(loan2.locator('.field-error')).toContainText('0% to 30%');
    await retype(page, rate, '9.5');
    await expectValid(rate);
    await expect(page.locator('#loans .computed').first()).toContainText('$18,447.50');

    // Subsidized: no in-school interest.
    await loan2.locator('select[id$=".type"]').selectOption('subsidized');
    await expect(loan2).toContainText('no interest accrues during school and grace');
    await expect(loan2.locator('.inline-figures > div').filter({ hasText: 'Interest before repayment' }).locator('dd')).toHaveText('$0.00');
    await loan2.locator('select[id$=".type"]').selectOption('private');
    await expect(loan2.locator('.inline-figures > div').filter({ hasText: 'Interest before repayment' }).locator('dd')).not.toHaveText('$0.00');

    // "I pay interest while in school": nothing capitalizes, monthly cost shown (keyboard toggle).
    const loan1 = loanCard(page, /^Year 1 loan/);
    const pays = loan1.getByLabel('I pay interest while in school');
    await pays.focus();
    await page.keyboard.press('Space');
    await expect(pays).toBeChecked();
    await expect(loan1).toContainText(/You pay about \$\d[\d,]*\.\d\d per month in school and grace/);
    await expect(loan1.locator('.inline-figures > div').filter({ hasText: 'In-school interest you pay' }).locator('dd')).toHaveText(/\$\d[\d,]*\.\d\d\/mo/);
    await expect(loan1.locator('.inline-figures > div').filter({ hasText: 'Interest added at repayment' }).locator('dd')).toHaveText('$0.00');
    await expect(loan1.locator('.inline-figures > div').filter({ hasText: 'Balance at repayment' }).locator('dd')).toHaveText('$10,447.50');
    await expect(page.locator('#loans')).toContainText(/In-school interest you pay: about \$\d[\d,]*\.\d\d per month/);

    // Add and remove a third loan.
    await page.getByRole('button', { name: 'Add loan' }).click();
    await expect(page.locator('article.loan-card')).toHaveCount(3);
    await page.locator('article.loan-card').nth(2).getByRole('button', { name: /^Remove loan/ }).click();
    await expect(page.locator('article.loan-card')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  });

  await test.step('US-501/505 salary, monthly budget, shortfall and negative amortization', async () => {
    const salary = byId(page, 'postGradIncome.annualSalary');
    await retype(page, salary, '55,000');
    await expectValid(salary);
    const budget = byId(page, 'postGradIncome.monthlyDebtBudget');
    await retype(page, budget, '50');
    const shortfall = page.locator('#repayment .notice--warning');
    await expect(shortfall).toContainText(/Your monthly amount is \$\d[\d,]*\.\d\d short of the minimum payments/);
    await expect(page.locator('.key-warn dd')).toHaveText(/\$\d[\d,]*\.\d\d\/mo/);
    // $50/month does not cover the monthly interest: warning and no debt-free date.
    await expect(page.getByText("Your payments don't cover the interest.")).toBeVisible();
    await expect(keyFigure(page, 'key-debt-free')).toHaveText('No debt-free date');
    await expect(page.locator('.summary .metric').first()).toContainText('No debt-free date');

    await retype(page, budget, '400');
    await expect(shortfall).toHaveCount(0);
    await expect(keyFigure(page, 'key-debt-free')).toHaveText(/^[A-Z][a-z]{2} \d{4}$/);
    const before = await keyFigure(page, 'key-debt-free').innerText();
    await retype(page, budget, '600');
    await expect(keyFigure(page, 'key-debt-free')).not.toHaveText(before);
  });

  await test.step('US-601/602/603/604 strategies, custom order (keyboard and drag), neutral comparison', async () => {
    const strategy = byId(page, 'repayment.strategyId');
    const comparison = page.getByRole('region', { name: 'Strategy comparison table' });
    await expect(comparison.locator('tbody tr')).toHaveCount(3);
    await expect(comparison.locator('tbody tr.is-current')).toContainText('Avalanche');
    await expect(comparison.locator('thead')).toContainText('Months to first payoff');
    await expect(comparison.locator('tbody')).toContainText(/Lowest modeled interest|[+−]\$\d[\d,]*\.\d\d interest, [+−]\d+ months?/);
    await expect(page.locator('#results')).not.toContainText(/\bbest\b/i);

    await strategy.selectOption('snowball');
    await expect(comparison.locator('tbody tr.is-current')).toContainText('Snowball');
    await strategy.selectOption('custom');
    await expect(comparison.locator('tbody tr.is-current')).toContainText('Custom order');

    const items = page.locator('ol.order-list > li');
    await expect(items.nth(0)).toContainText('1. Year 1 loan');
    // Keyboard: Move down with Enter; focus follows the moved loan.
    await page.getByRole('button', { name: 'Move down Year 1 loan' }).focus();
    await page.keyboard.press('Enter');
    await expect(items.nth(0)).toContainText('1. Bank loan');
    await expect(items.nth(1)).toContainText('2. Year 1 loan');
    await expect(page.getByRole('button', { name: 'Move up Year 1 loan' })).toBeFocused();
    // Drag: put Year 1 loan back on top.
    await items.nth(1).dragTo(items.nth(0));
    await expect(items.nth(0)).toContainText('1. Year 1 loan');
    await expect(items.nth(1)).toContainText('2. Bank loan');
  });

  await test.step('US-702/703/704/705 life events with impact text and timeline', async () => {
    const events = page.locator('article.event-card');
    // Windfall bonus.
    await page.getByRole('button', { name: 'Add life event' }).click();
    const bonus = events.nth(0);
    await expect(bonus.locator('input[id$=".name"]')).toBeFocused();
    await retype(page, bonus.locator('input[id$=".name"]'), 'Bonus');
    await retype(page, bonus.locator('input[id$=".amount"]'), '3000');
    await typeDate(page, bonus.locator('input[id$=".date"]'), '06012031');
    await expect(bonus.locator('.impact')).toHaveText(/^This event moves your debt-free date earlier by \d+ months? and saves \$\d[\d,]*\.\d\d interest\.$/);

    // Raise.
    await page.getByRole('button', { name: 'Add life event' }).click();
    const raise = events.nth(1);
    await retype(page, raise.locator('input[id$=".name"]'), 'Raise');
    await raise.locator('select[id$=".type"]').selectOption('income');
    await typeDate(page, raise.locator('input[id$=".date"]'), '01012032');
    await retype(page, raise.locator('input[id$=".amount"]'), '65000');
    await retype(page, raise.locator('input[id$=".allocationPercent"]'), '50');
    await expect(raise.locator('.impact')).toHaveText(/^This event (moves your debt-free date earlier by \d+ months?|doesn't change your debt-free date) and saves \$\d[\d,]*\.\d\d interest\.$/);

    // School expense for Year 2.
    const year2 = yearCard(page, 2);
    await page.getByRole('button', { name: 'Add life event' }).click();
    const expense = events.nth(2);
    await retype(page, expense.locator('input[id$=".name"]'), 'Laptop');
    await expense.locator('select[id$=".type"]').selectOption('expense');
    await expense.locator('select[id$=".schoolYearId"]').selectOption({ label: 'Year 2' });
    await retype(page, expense.locator('input[id$=".amount"]'), '1500');
    await expect(gapFigure(year2, 'Cost of attendance')).toHaveText('$24,881.00');

    // New aid for Year 3: gap drops by $1,500 (US-704).
    const year3 = yearCard(page, 3);
    await expect(gapFigure(year3, /^Borrowing gap/)).toHaveText('$20,500.00');
    await page.getByRole('button', { name: 'Add life event' }).click();
    const aid = events.nth(3);
    await retype(page, aid.locator('input[id$=".name"]'), 'New grant');
    await aid.locator('select[id$=".type"]').selectOption('aid');
    await aid.locator('select[id$=".schoolYearId"]').selectOption({ label: 'Year 3' });
    await retype(page, aid.locator('input[id$=".amount"]'), '1500');
    await expect(gapFigure(year3, /^Borrowing gap/)).toHaveText('$19,000.00');

    // Remove the Year 3 aid event and restore it with Undo.
    await aid.getByRole('button', { name: /^Remove event/ }).click();
    await expect(gapFigure(year3, /^Borrowing gap/)).toHaveText('$20,500.00');
    await page.locator('.undo-bar').getByRole('button', { name: 'Undo' }).click();
    await expect(gapFigure(year3, /^Borrowing gap/)).toHaveText('$19,000.00');

    // Timeline: school years, graduation, repayment, events, payoffs, debt-free — in date order.
    const timeline = page.locator('ol.timeline');
    await expect(timeline).toContainText('Bonus');
    await expect(timeline).toContainText('Raise');
    await expect(timeline.locator('li.timeline-graduation')).toHaveCount(1);
    await expect(timeline.locator('li.timeline-repayment')).toHaveCount(1);
    await expect(timeline.locator('li.timeline-payoff').first()).toBeVisible();
    const dates = await timeline.locator('time').evaluateAll(nodes => nodes.map(node => node.getAttribute('datetime') ?? ''));
    expect(dates.length).toBeGreaterThan(6);
    expect(dates).toEqual([...dates].sort());
  });

  await test.step('US-801/802 scenarios: overrides, inheritance, comparison range', async () => {
    const cards = page.locator('article.scenario-card');
    await page.getByRole('button', { name: 'Add scenario' }).click();
    const conservative = cards.nth(0);
    await expect(conservative).toContainText('Same as base plan');
    await retype(page, conservative.locator('input[id$=".name"]').first(), 'Conservative');
    const budget = conservative.locator('input[id$=".overrides.postGradIncome.monthlyDebtBudget"]');
    await expect(budget).toHaveValue('600.00');
    await retype(page, budget, '450');
    await expect(conservative.locator('li.override-row.is-overridden')).toHaveCount(1);
    await expect(conservative).toContainText('Changed in this scenario · base plan: $600.00');
    await expect(conservative.locator('h3')).toContainText('1 field changed');

    // Inherited fields follow base-plan edits.
    const salary = conservative.locator('input[id$=".overrides.postGradIncome.annualSalary"]');
    await expect(salary).toHaveValue('55,000.00');
    await retype(page, byId(page, 'postGradIncome.annualSalary'), '60000');
    await expect(salary).toHaveValue('60,000.00');
    await expect(conservative.locator('li.override-row').filter({ has: page.locator('input[id$=".overrides.postGradIncome.annualSalary"]') })).toContainText('Inherited');

    // Any other field via the picker.
    await conservative.locator('select[id$=".picker"]').selectOption({ label: 'Loan: Bank loan interest rate' });
    await conservative.getByRole('button', { name: /^Add field/ }).click();
    const scenarioRate = conservative.locator('input[id$=".annualRate"]');
    await expect(scenarioRate).toBeFocused();
    await retype(page, scenarioRate, '12');
    await expect(conservative.locator('h3')).toContainText('2 fields changed');

    await page.getByRole('button', { name: 'Add scenario' }).click();
    const expected = cards.nth(1);
    await retype(page, expected.locator('input[id$=".name"]').first(), 'Expected');
    await retype(page, expected.locator('input[id$=".overrides.postGradIncome.monthlyDebtBudget"]'), '900');

    await expect(page.locator('.range-sentence')).toHaveText(/^Debt-free between [A-Z][a-z]{2} \d{4} and [A-Z][a-z]{2} \d{4}\.$/);
    const scenarioTable = page.getByRole('region', { name: 'Scenario comparison table' });
    await expect(scenarioTable.locator('tbody tr')).toHaveCount(3);
    await expect(scenarioTable).toContainText('Conservative');
    await expect(scenarioTable).toContainText('Expected');
  });

  await test.step('US-901 chart with one line per strategy/scenario and a table alternative', async () => {
    const chart = page.getByRole('img', { name: /Total loan balance over time/ });
    await expect(chart).toBeVisible();
    await expect(chart.locator('polyline')).toHaveCount(3);
    await page.getByRole('radio', { name: 'Scenarios' }).check();
    await expect(chart.locator('polyline')).toHaveCount(3);
    await expect(page.getByRole('list', { name: 'Chart legend' })).toContainText('Conservative');
    await page.getByText('Show chart data as a table').click();
    const data = page.getByRole('region', { name: 'Balance over time data table' });
    await expect(data).toBeVisible();
    await expect(data.locator('thead')).toContainText('Base plan');
    await expect(data.locator('thead')).toContainText('Expected');
    await expect(data.locator('tbody tr').first()).toContainText(/\$\d[\d,]*\.\d\d/);
  });

  await test.step('US-504/902 amortization schedule and year summary', async () => {
    const summary = page.getByRole('region', { name: 'School year summary table' });
    await expect(summary.locator('thead')).toContainText(/Cost.*Resources.*Gap.*Borrowed/);
    await expect(summary.locator('tbody tr').first()).toContainText('$23,700.00');
    const schedule = page.getByRole('region', { name: 'Amortization schedule table' });
    await expect(schedule.locator('caption')).toContainText(/All loans combined: months 1–24 of \d+/);
    await expect(schedule.locator('thead')).toContainText(/Payment.*Interest.*Principal.*Remaining balance/);
    await page.getByRole('button', { name: 'Next 24 months' }).click();
    await expect(schedule.locator('caption')).toContainText(/months 25–\d+ of \d+/);
    await page.locator('#schedule-loan').selectOption({ label: 'Bank loan' });
    await expect(schedule.locator('caption')).toContainText(/^Bank loan: months 1–24/);
  });

  await test.step('US-1001 reload keeps everything', async () => {
    await page.waitForTimeout(600); // autosave debounce
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Estimates, not financial advice' })).toHaveCount(0);
    await expect(byId(page, 'settings.startDate')).toHaveValue('2026-08-26');
    await expect(byId(page, 'settings.graceMonths')).toHaveValue('6');
    await expect(costRows(year1).nth(1).locator('input[id$=".amount"]')).toHaveValue('10,500.00');
    await expect(yearCard(page, 2).locator('.subtotal-total dd')).toHaveText('$23,381.00');
    await expect(yearCard(page, 3).locator('.subtotal-total dd')).toHaveText('$20,500.00');
    await expect(resourceRows(year1).nth(1).locator('.record-result')).toHaveText('Counts as $6,750.00');
    await expect(year1.locator('input[id$=".bufferPercent"]')).toHaveValue('5');
    await expect(loanCard(page, /^Year 1 loan/).getByLabel('I pay interest while in school')).toBeChecked();
    await expect(loanCard(page, /^Bank loan/).locator('input[id$=".annualRate"]')).toHaveValue('9.5');
    await expect(byId(page, 'postGradIncome.annualSalary')).toHaveValue('60,000.00');
    await expect(byId(page, 'postGradIncome.monthlyDebtBudget')).toHaveValue('600.00');
    await expect(byId(page, 'repayment.strategyId')).toHaveValue('custom');
    await expect(page.locator('ol.order-list > li').nth(0)).toContainText('Year 1 loan');
    await expect(page.locator('article.event-card')).toHaveCount(4);
    await expect(page.locator('article.scenario-card')).toHaveCount(2);
    await expect(page.locator('.range-sentence')).toHaveText(/^Debt-free between/);
  });

  let exported = '';
  await test.step('US-1002 export, invalid import keeps the plan, valid import restores it', async () => {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export plan (JSON)' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^debtnav-plan-\d{4}-\d{2}-\d{2}\.json$/);
    exported = readFileSync(await download.path(), 'utf8');
    expect(JSON.parse(exported)).toMatchObject({ app: 'debtnav', schemaVersion: 3 });

    await page.locator('#import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') });
    await expect(page.locator('#data')).toContainText('Import failed; your current plan is unchanged.');
    await expect(byId(page, 'postGradIncome.monthlyDebtBudget')).toHaveValue('600.00');

    await retype(page, byId(page, 'postGradIncome.monthlyDebtBudget'), '777');
    await page.locator('#import-file').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
    await expect(page.locator('#data')).toContainText('Plan imported.');
    await expect(byId(page, 'postGradIncome.monthlyDebtBudget')).toHaveValue('600.00');
    await expect(page.locator('article.loan-card')).toHaveCount(2);
  });

  await test.step('US-1003 delete all data, with confirmation', async () => {
    await page.getByRole('button', { name: 'Delete all my data' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Delete all DebtNav data?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('article.loan-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'Delete all my data' }).click();
    await dialog.getByRole('button', { name: 'Delete all data' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#data')).toContainText('All DebtNav data was deleted from this device.');
    await expect(page.locator('article.loan-card')).toHaveCount(0);
    await page.waitForTimeout(600);
    await page.reload();
    await expect(page.locator('article.loan-card')).toHaveCount(0);
    await expect(costRows(yearCard(page, 1))).toHaveCount(0);
  });

  expect(pageErrors).toEqual([]);
});

// ------------------------------------------------------------------ storage unavailable

test('US-1001 storage unavailable: app still works and says data will not be saved', async ({ page }) => {
  await page.addInitScript(() => {
    const fail = () => { throw new DOMException('Storage disabled', 'SecurityError'); };
    Object.defineProperty(window, 'localStorage', { configurable: true, get: fail });
  });
  await page.reload();
  await expect(page.locator('.save-status--warn').first()).toContainText(/won't be saved|will not be saved|not be saved/i);
  await dismissDisclaimer(page);
  await page.getByRole('button', { name: 'Add cost to Year 1' }).click();
  await retype(page, costRows(yearCard(page, 1)).nth(0).locator('input[id$=".amount"]'), '5000');
  await expect(yearCard(page, 1).locator('.subtotal-total dd')).toHaveText('$5,000.00');
});

// ------------------------------------------------------------------ accessibility

async function populate(page: Page) {
  await dismissDisclaimer(page);
  await page.getByRole('button', { name: 'Add cost to Year 1' }).click();
  await retype(page, costRows(yearCard(page, 1)).nth(0).locator('input[id$=".amount"]'), '15000');
  await page.getByRole('button', { name: 'Add resource to Year 1' }).click();
  await page.getByRole('button', { name: 'Create loan from gap for Year 1' }).click();
  await page.getByRole('button', { name: 'Add loan' }).click();
  await page.locator('article.loan-card').nth(1).locator('select[id$=".type"]').selectOption('private');
  await retype(page, page.locator('article.loan-card').nth(1).locator('input[id$=".principal"]'), '6000');
  await page.getByRole('button', { name: 'Add life event' }).click();
  await page.getByRole('button', { name: 'Add scenario' }).click();
  await retype(page, byId(page, 'postGradIncome.monthlyDebtBudget'), '50'); // shortfall + negative amortization warnings
  // Leave one field invalid so error styling is audited too.
  await retype(page, page.locator('article.loan-card').nth(1).locator('input[id$=".annualRate"]'), '45');
  await page.getByText('Show chart data as a table').click();
  for (const summary of await page.locator('details.explain > summary').all()) await summary.click();
}

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('no axe violations (including color contrast) with every section populated', async ({ page }) => {
  await populate(page);
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
  // Dialog state too.
  await page.getByRole('button', { name: 'Delete all my data' }).click();
  const dialogResults = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(dialogResults.violations.map(v => v.id)).toEqual([]);
});

test('keyboard only: reach, edit and operate controls with a visible focus indicator', async ({ page }) => {
  // Skip link is the first tab stop and is visible when focused.
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to your plan' });
  await expect(skip).toBeFocused();
  expect(await skip.evaluate(el => el.getBoundingClientRect().top >= 0)).toBe(true);

  // Tab to the disclaimer button and activate it with Enter.
  const understand = page.getByRole('button', { name: 'I understand' });
  for (let i = 0; i < 40 && !(await understand.evaluate(el => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(understand).toBeFocused();
  await page.keyboard.press('Enter');

  // Tab into the grace field from the date fields, then edit purely by keyboard.
  const grace = byId(page, 'settings.graceMonths');
  for (let i = 0; i < 60 && !(await grace.evaluate(el => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(grace).toBeFocused();
  const outline = await grace.evaluate(el => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth);
  expect(outline).toMatch(/solid 3px/);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await expectInvalid(grace);
  await page.keyboard.type('3');
  await expectValid(grace);
  await expect(page.locator('#setup')).toContainText('Repayment starts Aug 20, 2030');

  // Buttons work with Enter and Space; new records receive focus.
  await page.getByRole('button', { name: 'Add loan' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('article.loan-card input[id$=".name"]')).toBeFocused();
  await page.keyboard.type(' A');
  await page.getByRole('button', { name: 'Add loan' }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('article.loan-card')).toHaveCount(2);

  // Custom order by keyboard.
  await page.getByRole('button', { name: 'Move down Loan 1 A' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('ol.order-list > li').nth(0)).toContainText('Loan 2');

  // Select changed by keyboard.
  const strategy = byId(page, 'repayment.strategyId');
  await strategy.focus();
  await page.keyboard.press('ArrowDown');
  await expect(strategy).toHaveValue('snowball');

  // Explanations open with the keyboard.
  const explain = page.locator('#setup details.explain');
  await explain.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(explain).toHaveAttribute('open', '');

  // Dialog: focus trapped, Escape closes and focus returns.
  const deleteButton = page.getByRole('button', { name: 'Delete all my data' });
  await deleteButton.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Delete all data' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(deleteButton).toBeFocused();
});

// ------------------------------------------------------------------ narrow screens and print

test('usable at 360 px without horizontal page scrolling @narrow', async ({ page }) => {
  await populate(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // Every element fits inside the viewport unless it is inside its own scroll container.
  const offenders = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll<HTMLElement>('body *')]
      .filter(el => !el.closest('.table-scroll, .section-nav ul, .visually-hidden, .visually-hidden-file, svg'))
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > width + 1 || r.left < -1); })
      .map(el => `${el.tagName.toLowerCase()}#${el.id}.${el.className}`).slice(0, 10);
  });
  expect(offenders).toEqual([]);
  const cost = costRows(yearCard(page, 1)).nth(0).locator('input[id$=".amount"]');
  await retype(page, cost, '1500');
  await expect(yearCard(page, 1).locator('.subtotal-total dd')).toHaveText('$1,500.00');
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations.map(v => v.id)).toEqual([]);
});

test('print view hides input chrome and prints results', async ({ page }) => {
  await populate(page);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.inputs')).toBeHidden();
  await expect(page.locator('.section-nav')).toBeHidden();
  await expect(page.locator('#data')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Next 24 months' })).toBeHidden();
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('.summary .metrics')).toBeVisible();
  await expect(page.getByRole('region', { name: 'School year summary table' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Balance over time data table' })).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('.inputs')).toBeVisible();
});

// ------------------------------------------------------------------ latency (US-701, NFR-4)

test('typing stays responsive with the reference plan (4 years, 8 loans, 30-year horizon, events, scenarios)', async ({ page }) => {
  test.setTimeout(120_000);
  await dismissDisclaimer(page);
  // Setup only (not the journey under test): build the reference plan quickly.
  for (let i = 0; i < 8; i++) {
    await page.getByRole('button', { name: 'Add loan' }).click();
    const card = page.locator('article.loan-card').nth(i);
    await card.locator('input[id$=".principal"]').fill(String(4000 + i * 500));
    await card.locator('input[id$=".principal"]').blur();
    if (i % 3 === 0) await card.locator('select[id$=".type"]').selectOption('private');
  }
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Add life event' }).click();
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Add scenario' }).click();
  await expect(byId(page, 'repayment.maxMonths')).toHaveValue('360');
  await expect(page.locator('article.loan-card')).toHaveCount(8);
  const budget = byId(page, 'postGradIncome.monthlyDebtBudget');
  await budget.click();
  await page.keyboard.press('Control+A');
  await page.waitForTimeout(500);

  const measurements = await page.evaluate(async () => {
    const el = document.getElementById('postGradIncome.monthlyDebtBudget') as HTMLInputElement;
    const debtFree = document.querySelector('[data-testid="key-interest"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const frame: number[] = [];
    const results: number[] = [];
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    for (const value of ['5', '55', '555', '5555', '555', '55', '550', '5500', '550', '600']) {
      const before = debtFree.textContent;
      const start = performance.now();
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await nextFrame();
      frame.push(performance.now() - start);
      // Then wait until the core results (key figures) reflect the new value.
      let changed = false;
      for (let i = 0; i < 60 && !(changed = debtFree.textContent !== before); i++) await nextFrame();
      if (changed) results.push(performance.now() - start);
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    return { frame, results };
  });
  console.log('per-keystroke ms (input → next frame):', measurements.frame.map(n => n.toFixed(1)).join(', '));
  console.log('per-keystroke ms (input → key results updated):', measurements.results.map(n => n.toFixed(1)).join(', '));
  expect(Math.max(...measurements.frame)).toBeLessThan(100);
  expect(measurements.results.length).toBeGreaterThan(5);
  expect(Math.max(...measurements.results)).toBeLessThan(100);
  await expect(budget).toHaveValue('600');
  // Comparisons arrive from the worker without blocking typing.
  await expect(page.getByRole('region', { name: 'Strategy comparison table' }).locator('tbody tr')).toHaveCount(3);
});
