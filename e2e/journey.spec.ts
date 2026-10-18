import type { Page, Locator } from '@playwright/test';
import { test, expect, goTo, openPlanner, openSections } from './support/fixtures';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

const go = goTo;
// US-501: after-graduation salary and the monthly payment live in Results → Earnings & payment.
const budgetField = (page: Page) => page.getByLabel('Monthly payment', { exact: true });
const salaryField = (page: Page) => page.getByLabel('Salary (before tax)', { exact: true });
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
    if (!(await detail.getAttribute('open') !== null) && await detail.isVisible()) await detail.locator(':scope > summary').click();
  }
}
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const DESTINATIONS = ['overview', 'school', 'loans', 'results'];

test.beforeEach(async ({ page, user }) => fresh(page, user));

test('costs, work, loans, repayment inputs and bonuses stay connected across destinations and reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // The Introduction continues to the first destination that needs input.
  await page.getByRole('link', { name: /^Continue to / }).click();
  await expect(page.locator('.dashboard')).not.toHaveAttribute('data-dashboard', 'overview');

  await go(page, 'school');
  await openDetails(page);
  await page.getByRole('button', { name: 'Add cost to Year 1' }).click();
  const tuition = page.locator('input[id*=".costItems."][id$=".amount"]');
  await retype(page, tuition, '10000');
  await retype(page, tuition, 'abc');
  await expect(tuition).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.gap-main dd')).toHaveText('$10,000.00');
  await retype(page, tuition, '10000');
  await page.getByRole('button', { name: 'Add grant or savings to Year 1' }).click();
  await retype(page, page.locator('input[id*=".resources."][id$=".amount"]').first(), '2000');
  await expect(page.locator('.gap-main dd')).toHaveText('$8,000.00');

  // Work while in school is part of the year (was Income & Earnings).
  await page.getByRole('button', { name: 'Add work', exact: true }).click();
  await retype(page, page.getByLabel('Hourly wage', { exact: true }), '20');
  await retype(page, page.getByLabel('Hours per week'), '10');
  await retype(page, page.getByLabel('Weeks per year'), '40');
  await retype(page, page.getByLabel('% for school'), '50');
  await expect(page.locator('.income-job-summary')).toHaveText('$8,000.00 / year · $4,000.00 for school');
  await expect(page.locator('.gap-main dd')).toHaveText('$4,000.00');
  await page.getByLabel('Enter as').selectOption('fixed');
  await retype(page, page.getByLabel('Fixed amount per year', { exact: true }), '6000');
  await expect(page.locator('.income-job-summary')).toHaveText('$6,000.00 / year · $3,000.00 for school');
  await page.getByLabel('Enter as').selectOption('hourly');
  await expect(page.getByLabel('Hourly wage', { exact: true })).toHaveValue('20.00');
  const yearOptions = await page.getByLabel('School year', { exact: true }).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  await page.getByLabel('School year', { exact: true }).selectOption(yearOptions[1]);
  await expect(page.locator('.income-job-summary')).toHaveCount(0);
  await page.getByLabel('School year', { exact: true }).selectOption(yearOptions[0]);
  await expect(page.locator('.income-job-summary')).toHaveText('$8,000.00 / year · $4,000.00 for school');

  // US-501: after-graduation salary and the monthly payment are edited in Results only.
  await go(page, 'repayment');
  const budget = budgetField(page);
  await retype(page, budget, '300');
  await retype(page, salaryField(page), '60000');
  await expect(budget).toHaveValue('300.00');
  await retype(page, page.getByLabel('Default % to debt for new income changes'), '35');
  await page.getByRole('button', { name: 'Add income change' }).click();
  await expect(page.locator('input[id^="lifeEvents."][id$=".allocationPercent"]')).toHaveValue('35');
  await expect(page.locator('input[id^="lifeEvents."][id$=".amount"]')).toHaveValue('60,000.00');
  await page.getByRole('button', { name: 'Add bonus or extra payment' }).click();
  await retype(page, page.locator('input[id^="lifeEvents."][id$=".amount"]').first(), '2000');
  await expect(page.getByText('To debt: $2,000.00 · Kept: $0.00')).toBeVisible();

  await go(page, 'school');
  await expect(page.locator('.gap-main dd')).toHaveText('$4,000.00');
  await page.getByRole('button', { name: /^Create loan for \$4,000\.00/ }).click();
  await expect(page.locator('.dashboard')).toHaveAttribute('data-dashboard', 'loans');
  await expect(page.locator('input[id$=".name"]')).toBeFocused();
  await expect(page.locator('input[id$=".principal"]')).toHaveValue('4,000.00');
  await go(page, 'repayment');
  await page.getByLabel('Payoff strategy', { exact: true }).selectOption('snowball');
  const interest = await page.getByTestId('headline-interest').textContent();
  await retype(page, budgetField(page), '600');
  await expect(page.getByTestId('headline-interest')).not.toHaveText(interest!);
  await expect(page.locator('.save-status')).toContainText(/saved/i);
  await page.reload();
  await go(page, 'income');
  await expect(page.locator('.income-job-summary')).toHaveText('$8,000.00 / year · $4,000.00 for school');
  await go(page, 'repayment');
  await expect(salaryField(page)).toHaveValue('60,000.00');
  await expect(budgetField(page)).toHaveValue('600.00');
  await expect(page.getByLabel('Payoff strategy', { exact: true })).toHaveValue('snowball');
  await expect(page.locator('details.compact-record-card')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('results show the yearly breakdown with the monthly schedule, strategies and the chart on demand', async ({ page }) => {
  await go(page, 'loans');
  await page.getByRole('button', { name: 'Add loan', exact: true }).click();
  await retype(page, page.locator('input[id$=".principal"]'), '12000');
  await go(page, 'results');
  await expect(page.getByTestId('headline-debt-free')).toHaveText(/^[A-Z][a-z]{2} \d{4}/);
  await expect(page.getByRole('region', { name: 'Yearly breakdown table' })).toBeHidden();
  await page.locator('#results-breakdown > summary').click();
  const breakdown = page.getByRole('region', { name: 'Yearly breakdown table' });
  await expect(breakdown).toBeVisible();
  const totals = await breakdown.locator('tfoot').textContent();
  await page.getByLabel('Show', { exact: true }).selectOption('all');
  await expect(breakdown.locator('tfoot')).toHaveText(totals!);
  await page.getByLabel('Repayment years').check();
  await expect(breakdown.locator('tbody th').first()).toHaveText(/^Year 1/);
  await page.getByText('Monthly schedule', { exact: true }).click();
  await expect(page.getByRole('table', { name: /months 1–12 of/ })).toBeVisible();
  await page.getByRole('button', { name: 'Next 12 months' }).click();
  await expect(page.getByRole('table', { name: /months 13–24 of/ })).toBeVisible();
  await page.locator('#results-more > summary').click();
  await expect(page.getByRole('img', { name: /balance/i })).toBeVisible();
  await page.getByText('Show chart data as a table', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Balance over time data table' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Strategy comparison table' }).locator('tbody tr')).toHaveCount(3);
  await go(page, 'school');
  await page.getByText('All years', { exact: true }).click();
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
  await openPlanner(page, user, '#results');
  await openSections(page);
  await expect(budgetField(page)).not.toHaveValue('450.00');
});

// Each destination may scroll vertically (sections expanded); horizontal overflow is not allowed.
test('the four destinations have no horizontal overflow and accessible controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const id of DESTINATIONS) {
    await go(page, id);
    await noOverflow(page);
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(audit.violations.map(v => v.id), id).toEqual([]);
    await openSections(page);
    await noOverflow(page);
    const open = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(open.violations.map(v => v.id), `${id} (sections open)`).toEqual([]);
  }
  await go(page, 'data');
  const dialogAudit = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(dialogAudit.violations.map(v => v.id), 'Your data dialog').toEqual([]);
});

test('mobile and 200% equivalent reflow keep destination controls reachable @narrow', async ({ page }) => {
  for (const viewport of [{ width: 360, height: 780 }, { width: 720, height: 450 }]) {
    await page.setViewportSize(viewport);
    // The four tabs fit on one row.
    await page.evaluate(() => window.scrollTo(0, 0));
    const tabs = await page.getByRole('navigation', { name: 'Planner sections' }).getByRole('link').all();
    expect(tabs).toHaveLength(4);
    for (const tab of tabs) await expect(tab).toBeInViewport();
    for (const id of DESTINATIONS) {
      await go(page, id);
      await openDetails(page);
      await noOverflow(page);
      await expect(page.locator('#disclaimer-open')).toBeVisible();
    }
    await go(page, 'income');
    await page.getByRole('button', { name: 'Add work', exact: true }).click();
    await retype(page, page.locator('input[id$=".hourlyWage"]:visible').first(), '18');
    await noOverflow(page);
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(audit.violations.map(v => v.id)).toEqual([]);
    await page.screenshot({ path: 'test-results/costs-' + viewport.width + '.png', fullPage: true });
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
