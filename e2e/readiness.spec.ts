import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Readiness checklist journey in a real browser (tester): a new user opens Results, sees what is
// missing, follows each action, enters the value, returns and sees status + results update.
// Run with: npx playwright test e2e/readiness.spec.ts

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const MONTH_YEAR = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{4}(?!\d)/;

async function go(page: Page, id: string) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav a[href="#' + id + '"]').click();
  await expect(page.locator('.dashboard')).toHaveAttribute('data-dashboard', id);
}
async function retype(page: Page, field: Locator, value: string) {
  await field.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(value);
  await field.blur();
}
const row = (page: Page, id: string) => page.locator(`main [data-readiness-id="${id}"]`);
const status = (page: Page) => page.locator('main .readiness-status');
const focusedId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? '');
const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
/** Every checklist row and figure lies inside the viewport horizontally and does not clip its text. */
async function noClipping(page: Page) {
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const width = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll<HTMLElement>('main [data-readiness-id], main [data-readiness-id] button, main .readiness-status, main [data-state]')) {
      const box = el.getBoundingClientRect();
      if (box.width === 0) continue;
      if (box.left < -0.5 || box.right > width + 0.5) out.push(`${el.dataset.readinessId ?? el.className} outside viewport (${box.left}-${box.right} of ${width})`);
      const style = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 1 && style.overflowX !== 'auto' && style.overflowX !== 'scroll') out.push(`${el.dataset.readinessId ?? el.className} clips text`);
    }
    return out;
  });
  expect(problems).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/#results');
  await page.reload();
  await page.getByRole('button', { name: 'I understand' }).click();
});

test('empty plan: Results explains what is missing and shows no misleading figures', async ({ page }) => {
  await go(page, 'results');
  await expect(page.getByRole('heading', { name: /your plan needs/i })).toBeVisible();
  await expect(status(page)).toHaveText(/0 of \d+ key results ready · 2 items needed/);
  await expect(status(page)).toHaveAttribute('role', 'status');
  await expect(row(page, 'loans.none')).toBeVisible();
  await expect(row(page, 'costs.none')).toBeVisible();
  await expect(row(page, 'loans.none')).toContainText(/debt-free/i);
  for (const id of ['key-debt-free', 'key-interest', 'key-gap']) {
    const figure = page.getByTestId(id);
    if (await figure.count()) {
      await expect(figure.first()).not.toHaveText(MONTH_YEAR);
      await expect(figure.first()).not.toHaveText(/\$0\.00/);
    }
  }
  await go(page, 'overview');
  await expect(page.getByTestId('key-debt-free')).not.toHaveText(MONTH_YEAR);
  await expect(page.getByTestId('key-interest')).not.toHaveText(/\$0\.00/);
  await expect(row(page, 'loans.none')).toBeVisible();
});

test('completion journey: follow each action, enter the value, return, and see results update; persists after reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await go(page, 'results');

  // 1. Add school costs → Costs dashboard, add-cost button focused.
  await row(page, 'costs.none').getByRole('button').click();
  await expect(page).toHaveURL(/#school$/);
  await expect.poll(() => focusedId(page)).toMatch(/^schoolYears\.[^.]+\.costItems-add$/);
  await page.keyboard.press('Enter');
  const costAmount = page.locator('input[id*=".costItems."][id$=".amount"]').first();
  await retype(page, costAmount, '10000');
  await go(page, 'results');
  await expect(row(page, 'costs.none')).toHaveCount(0);
  await expect(status(page)).toHaveText(/1 item(s)? needed/);

  // 2. Add a loan → Loans dashboard, add button focused; Enter adds a $0 loan → item asks for its amount.
  await row(page, 'loans.none').getByRole('button').click();
  await expect(page).toHaveURL(/#loans$/);
  await expect.poll(() => focusedId(page)).toBe('loans-add');
  await page.keyboard.press('Enter');
  await go(page, 'results');
  await expect(row(page, 'loans.allZero')).toBeVisible();
  await row(page, 'loans.allZero').getByRole('button').click();
  await expect(page).toHaveURL(/#loans$/);
  await expect.poll(() => focusedId(page)).toMatch(/^loans\.[^.]+\.principal$/);
  const principal = page.locator(`[id="${await focusedId(page)}"]`);

  // 3. Invalid input never reaches results; correcting it recovers.
  await retype(page, principal, 'abc');
  await expect(principal).toHaveAttribute('aria-invalid', 'true');
  await retype(page, principal, '30000');
  await expect(principal).not.toHaveAttribute('aria-invalid', 'true');

  // 4. Back on Results: nothing blocking, repayment shown as an estimate on the default budget.
  await go(page, 'results');
  await expect(page.getByRole('heading', { name: /your plan needs/i })).toHaveCount(0);
  await expect(status(page)).toHaveText(/nothing needed|0 items needed/);
  await expect(page.locator('main')).toContainText(MONTH_YEAR);
  await expect(page.locator('main [data-state="estimate"]').first()).toBeVisible();
  await expect(page.locator('main .chip--estimate').first()).toBeVisible();
  await go(page, 'overview');
  await expect(page.getByTestId('key-debt-free')).toHaveText(MONTH_YEAR);
  await expect(page.getByTestId('key-debt-free')).toHaveAttribute('data-state', 'estimate');
  await go(page, 'results');

  // 5. Reload keeps everything.
  const before = await status(page).textContent();
  await page.reload();
  await go(page, 'results');
  await expect(status(page)).toHaveText(before ?? '');
  await expect(row(page, 'loans.allZero')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('budget states: confirm default, below interest (not paid off), zero (missing), then fixed', async ({ page }) => {
  // Seed one loan through the UI.
  await go(page, 'loans');
  await page.locator('#loans-add').click();
  await retype(page, page.locator('input[id^="loans."][id$=".principal"]').first(), '30000');
  await go(page, 'results');

  // Assumption: the untouched $400 budget.
  const assumptions = page.locator('main details', { hasText: /check these assumptions/i }).first();
  await assumptions.locator(':scope > summary').click();
  await row(page, 'budget.default').getByRole('button').click();
  await expect(page).toHaveURL(/#income$/);
  await expect.poll(() => focusedId(page)).toBe('postGradIncome.monthlyDebtBudget');
  const budget = page.locator('[id="postGradIncome.monthlyDebtBudget"]');

  await retype(page, budget, '10');
  await go(page, 'results');
  // Non-payoff is visible without expanding anything: the figure says so and offers a budget action.
  const notPaid = page.locator('main .result-figure[data-state="nonPayoff"]').first();
  await expect(notPaid).toBeVisible();
  await expect(notPaid).toContainText(/not paid off|no debt-free date/i);
  await expect(notPaid).not.toContainText(MONTH_YEAR);
  await expect(row(page, 'repayment.nonPayoff')).toHaveCount(1);
  await expect(notPaid.getByRole('button')).toHaveText(/budget/i);
  await notPaid.getByRole('button').click();
  await expect.poll(() => focusedId(page)).toBe('postGradIncome.monthlyDebtBudget');

  await retype(page, budget, '0');
  await go(page, 'results');
  await expect(row(page, 'budget.zero')).toBeVisible();
  await expect(page.locator('main .result-figure[data-state="nonPayoff"]')).toHaveCount(0);

  await row(page, 'budget.zero').getByRole('button').click();
  await expect.poll(() => focusedId(page)).toBe('postGradIncome.monthlyDebtBudget');
  await retype(page, budget, '300');
  await go(page, 'results');
  await expect(row(page, 'budget.zero')).toHaveCount(0);
  await expect(page.locator('main')).toContainText(/short of the minimum/i); // $300: above interest (~$207), below the ~$435 minimum
  await go(page, 'overview');
  await expect(page.getByTestId('key-debt-free')).toHaveAttribute('data-state', 'complete');
  await expect(page.getByTestId('key-debt-free')).toHaveText(MONTH_YEAR);
});

test('keyboard: checklist actions are reachable with Tab and activate with Enter', async ({ page }) => {
  await go(page, 'results');
  await expect(page.locator('#results-heading')).toBeFocused();
  let reached = '';
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.tagName === 'BUTTON' ? el.closest<HTMLElement>('[data-readiness-id]')?.dataset.readinessId ?? '' : '';
    });
  }
  expect(reached).not.toBe('');
  await page.keyboard.press('Enter');
  await expect(page).not.toHaveURL(/#results$/);
  const id = await focusedId(page);
  expect(id === 'loans-add' || /costItems-add$/.test(id)).toBe(true);
});

test('axe: Results with the checklist has no WCAG A/AA violations', async ({ page }) => {
  await go(page, 'results');
  await expect(row(page, 'loans.none')).toBeVisible();
  const audit = await new AxeBuilder({ page }).include('main').withTags(WCAG_TAGS).analyze();
  expect(audit.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('360 px and 200% zoom (720×450): checklist and figures fit without clipping; actions work @narrow', async ({ page }) => {
  for (const viewport of [{ width: 360, height: 780 }, { width: 720, height: 450 }]) {
    await page.setViewportSize(viewport);
    for (const id of ['results', 'overview']) {
      await go(page, id);
      await expect(row(page, 'loans.none')).toBeVisible();
      await noOverflow(page);
      await noClipping(page);
    }
    await go(page, 'results');
    const action = row(page, 'loans.none').getByRole('button');
    await action.scrollIntoViewIfNeeded();
    await action.click();
    await expect(page).toHaveURL(/#loans$/);
    await expect.poll(() => focusedId(page)).toBe('loans-add');
    await expect(page.locator('#loans-add')).toBeInViewport();
    const audit = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(audit.violations.map(v => v.id)).toEqual([]);
  }
});

test('true 200% browser zoom (CSS zoom on 1280 px) keeps Results readable without horizontal scroll @narrow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await go(page, 'results');
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await expect(row(page, 'loans.none')).toBeVisible();
  await noOverflow(page);
});
