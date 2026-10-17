import type { Page, Locator } from '@playwright/test';
import { test, expect, openPlanner } from './support/fixtures';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

async function go(page: Page, id: string) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.locator('nav a[href="#' + id + '"]').click();
  await expect(page.locator('.dashboard')).toHaveAttribute('data-dashboard', id);
}
// US-501: after-graduation salary and the monthly debt budget live in Repayment Plan.
const budgetField = (page: Page) => page.getByLabel('Monthly debt budget (your chosen payment)');
const salaryField = (page: Page) => page.getByLabel('Gross annual salary (before taxes)');
async function retype(page: Page, field: Locator, value: string) {
  await field.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(value);
  await field.blur();
}
/** A fresh account (empty plan) signed in through the real OIDC flow replaces clearing localStorage. */
async function fresh(page: Page, user: string) {
  await openPlanner(page, user, '#overview');
}
async function openDetails(page: Page) {
  // Explicitly open native editors as a user would, rather than editing hidden fields.
  for (const detail of await page.locator('main details').all()) {
    if (!(await detail.getAttribute('open') !== null)) await detail.locator(':scope > summary').click();
  }
}
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test.beforeEach(async ({ page, user }) => fresh(page, user));

test('earnings, costs, repayment, events and scenarios stay connected across views and reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // US-903: the Overview hub links to How much I make (Income & Earnings).
  await page.getByRole('link', { name: 'Open How much I make' }).click();
  await expect(page.getByRole('heading', { name: 'Income & Earnings', exact: true })).toBeVisible();
  await expect(page.locator('#school, #loans, #repayment')).toHaveCount(0);

  await go(page, 'school');
  await openDetails(page);
  await page.getByRole('button', { name: 'Add cost to Year 1' }).click();
  const tuition = page.locator('input[id*=".costItems."][id$=".amount"]');
  await retype(page, tuition, '10000');
  await retype(page, tuition, 'abc');
  await expect(tuition).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.gap-main dd')).toHaveText('$10,000.00');
  await retype(page, tuition, '10000');
  await page.getByRole('button', { name: 'Add resource to Year 1' }).click();
  await retype(page, page.locator('input[id*=".resources."][id$=".amount"]'), '2000');
  await expect(page.locator('.gap-main dd')).toHaveText('$8,000.00');

  await page.getByRole('button', { name: 'Edit income', exact: true }).click();
  await page.getByRole('button', { name: 'Add earnings', exact: true }).click();
  await retype(page, page.getByLabel('Hourly wage', { exact: true }), '20');
  await retype(page, page.getByLabel('Hours worked per week'), '10');
  await retype(page, page.getByLabel('Weeks worked per year'), '40');
  await retype(page, page.getByLabel('Percentage available to pay school costs'), '50');
  await expect(page.getByLabel('Selected school year earnings')).toContainText('Annual earnings$8,000.00');
  await expect(page.getByLabel('Selected school year earnings')).toContainText('Available for school$4,000.00');
  await expect(page.getByLabel('Selected school year earnings')).toContainText('Borrowing gap$4,000.00');
  await page.getByLabel('Enter earnings as').selectOption('fixed');
  await retype(page, page.getByLabel('Fixed annual earnings', { exact: true }), '6000');
  await expect(page.getByLabel('Selected school year earnings')).toContainText('Available for school$3,000.00');
  await page.getByLabel('Enter earnings as').selectOption('hourly');
  await expect(page.getByLabel('Hourly wage', { exact: true })).toHaveValue('20.00');
  const yearOptions = await page.getByLabel('School year', { exact: true }).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  await page.getByLabel('School year', { exact: true }).selectOption(yearOptions[1]);
  await expect(page.getByLabel('Selected school year earnings')).toContainText('Annual earnings$0.00');
  await page.getByRole('button', { name: 'Add earnings', exact: true }).click();
  await retype(page, page.getByLabel('Hourly wage', { exact: true }), '12');
  await page.getByLabel('School year', { exact: true }).selectOption(yearOptions[0]);
  await expect(page.getByLabel('Selected school year earnings')).toContainText('Annual earnings$8,000.00');

  // US-501: after-graduation salary and the debt budget are edited in Repayment Plan only.
  await page.getByRole('button', { name: 'Edit after-graduation earnings in Repayment Plan' }).click();
  await expect(page.locator('.dashboard')).toHaveAttribute('data-dashboard', 'repayment');
  const budget = budgetField(page);
  await retype(page, budget, '300');
  await retype(page, salaryField(page), '60000');
  await expect(budget).toHaveValue('300.00');
  await page.getByText('Default share of future raises for debt', { exact: true }).click();
  await retype(page, page.getByLabel('Default share of raises put toward debt'), '35');
  await go(page, 'income');
  await expect(page.getByLabel('After-graduation figures from Repayment Plan')).toContainText('Monthly debt budget$300.00');
  await page.getByRole('button', { name: 'Manage income changes & raises' }).click();
  await page.getByRole('button', { name: 'Add income change' }).click();
  await expect(page.locator('input[id$=".allocationPercent"]')).toHaveValue('35');
  await expect(page.locator('input[id$=".amount"]')).toHaveValue('60,000.00');

  await go(page, 'school');
  await expect(page.locator('.gap-main dd')).toHaveText('$4,000.00');
  await page.getByRole('button', { name: 'Create loan from gap for Year 1' }).click();
  await expect(page.locator('.dashboard')).toHaveAttribute('data-dashboard', 'loans');
  await expect(page.locator('input[id$=".name"]')).toBeFocused();
  await expect(page.locator('input[id$=".principal"]')).toHaveValue('4,000.00');
  await go(page, 'repayment');
  await page.getByLabel('Payoff strategy', { exact: true }).selectOption('snowball');
  await go(page, 'scenarios');
  await page.getByRole('button', { name: 'Add scenario' }).click();
  await retype(page, page.locator('input[id$=".overrides.postGradIncome.monthlyDebtBudget"]'), '500');
  await go(page, 'overview');
  const interest = await page.getByTestId('key-interest').textContent();
  await go(page, 'repayment');
  await retype(page, budgetField(page), '600');
  await go(page, 'overview');
  await expect(page.getByTestId('key-interest')).not.toHaveText(interest!);
  await expect(page.locator('.save-status')).toContainText(/saved/i);
  await page.reload();
  await go(page, 'income');
  await expect(page.getByLabel('Selected school year earnings')).toContainText('Available for school$4,000.00');
  await go(page, 'repayment');
  await expect(salaryField(page)).toHaveValue('60,000.00');
  await expect(budgetField(page)).toHaveValue('600.00');
  await expect(page.getByLabel('Payoff strategy', { exact: true })).toHaveValue('snowball');
  await go(page, 'events');
  await expect(page.locator('details.compact-record-card')).toHaveCount(1);
  await go(page, 'scenarios');
  await expect(page.locator('details.compact-record-card')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('focused results expose charts and paginated schedule on demand', async ({ page }) => {
  await go(page, 'loans');
  await page.getByRole('button', { name: 'Add loan', exact: true }).click();
  await retype(page, page.locator('input[id$=".principal"]'), '12000');
  await go(page, 'results');
  await expect(page.locator('.summary')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Amortization schedule table' })).toHaveCount(0);
  await page.getByLabel('Explore results').selectOption('schedule');
  await expect(page.getByRole('table', { name: /months 1–12 of/ })).toBeVisible();
  await page.getByRole('button', { name: 'Next 12 months' }).click();
  await expect(page.getByRole('table', { name: /months 13–24 of/ })).toBeVisible();
  await page.getByLabel('Explore results').selectOption('chart');
  await expect(page.getByRole('img', { name: /balance/i })).toBeVisible();
  await page.getByText('Show chart data as a table', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Balance over time data table' })).toBeVisible();
  await page.getByLabel('Explore results').selectOption('strategies');
  await expect(page.getByRole('region', { name: 'Strategy comparison table' }).locator('tbody tr')).toHaveCount(3);
  await page.getByLabel('Explore results').selectOption('school');
  await expect(page.getByRole('region', { name: 'School year summary table' }).locator('tbody tr')).toHaveCount(4);
});

test('export, invalid import, valid import and deletion retain their behavior', async ({ page, user }) => {
  await go(page, 'repayment');
  await retype(page, budgetField(page), '450');
  await go(page, 'data');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export plan (JSON)' }).click();
  const downloaded = await downloadPromise;
  const exported = readFileSync((await downloaded.path())!, 'utf8');
  expect(JSON.parse(exported)).toMatchObject({ app: 'debtnav', schemaVersion: 4 });
  // Portable files never carry account identity.
  expect(exported).not.toContain(user);
  await page.getByLabel('Import plan (JSON)').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await expect(page.locator('#data')).toContainText('Import failed; your current plan is unchanged.');
  await go(page, 'repayment');
  await expect(budgetField(page)).toHaveValue('450.00');
  await retype(page, budgetField(page), '700');
  await go(page, 'data');
  await page.getByLabel('Import plan (JSON)').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await expect(page.locator('#data')).toContainText('Plan imported.');
  await go(page, 'repayment');
  await expect(budgetField(page)).toHaveValue('450.00');
  await go(page, 'data');
  const trigger = page.getByRole('button', { name: 'Delete all my data' });
  await trigger.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Delete all data', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'true');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('button', { name: 'Delete all data', exact: true }).click();
  // US-1003: deleting signed-in data removes the account record and signs out.
  await expect(page.locator('[data-notice="deleted"]')).toContainText('Your DebtNav data was deleted.');
  expect((await page.request.get('/api/plan')).status()).toBe(401);
  // Signing in again starts a new, empty plan.
  await openPlanner(page, user, '#repayment');
  await expect(budgetField(page)).not.toHaveValue('450.00');
});

// M6 (Overview hub, persistent Undo bar, Repayment Plan earnings/target/timing, Results payment dates) made
// several dashboards taller than one 900 px screen; vertical scrolling is allowed, horizontal overflow is not.
test('primary desktop dashboards have no horizontal overflow and accessible controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const pages = ['overview', 'setup', 'school', 'income', 'loans', 'repayment', 'events', 'scenarios', 'federal', 'results', 'data'];
  for (const id of pages) {
    await go(page, id);
    await noOverflow(page);
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(audit.violations.map(v => v.id), id).toEqual([]);
  }
  await go(page, 'income');
  await page.getByRole('button', { name: 'Add earnings', exact: true }).click();
  await noOverflow(page);
  await page.screenshot({ path: 'test-results/income-desktop.png', fullPage: true });
});

test('mobile and 200% equivalent reflow keep dashboard controls reachable @narrow', async ({ page }) => {
  for (const viewport of [{ width: 360, height: 780 }, { width: 720, height: 450 }]) {
    await page.setViewportSize(viewport);
    for (const id of ['overview', 'setup', 'school', 'income', 'loans', 'repayment', 'events', 'scenarios', 'federal', 'results', 'data']) {
      await go(page, id);
      await openDetails(page);
      await noOverflow(page);
      await expect(page.locator('#disclaimer-open')).toBeVisible();
    }
    await go(page, 'income');
    await page.getByRole('button', { name: 'Add earnings', exact: true }).click();
    await retype(page, page.locator('input[id$=".hourlyWage"]:visible').first(), '18');
    await noOverflow(page);
    await expect(page.getByRole('button', { name: 'Edit after-graduation earnings in Repayment Plan' })).toBeVisible();
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(audit.violations.map(v => v.id)).toEqual([]);
    await page.screenshot({ path: 'test-results/income-' + viewport.width + '.png', fullPage: true });
  }
});

// Browser storage is only an unsynced-edits cache now: without it the plan still loads and saves to the account.
test('browser storage unavailable still loads, edits and saves to the account', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new DOMException('Storage disabled', 'SecurityError'); } }));
  await page.reload();
  await expect(page.locator('.dashboard')).toBeVisible();
  await go(page, 'repayment');
  await retype(page, salaryField(page), '55000');
  await expect(salaryField(page)).toHaveValue('55,000.00');
  await expect(page.locator('.save-status')).toContainText(/saved/i);
  await expect.poll(async () => JSON.stringify((await (await page.request.get('/api/plan')).json()).document?.plan.postGradIncome)).toContain('"annualSalary":"55000.00"');
});
