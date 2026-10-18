import type { Page } from '@playwright/test';
import { test, expect, openPlanner } from './support/fixtures';
import AxeBuilder from '@axe-core/playwright';

// Navigation: four destination tabs (one row on every width), old bookmarks redirected, header account menu.
// Driven with real mouse and keyboard input. Run with: E2E_PORT=57xx npx playwright test e2e/sidebar.spec.ts

const DESTINATIONS = [
  { id: 'overview', label: 'Introduction', heading: 'Plan your student loans' },
  { id: 'school', label: 'College Costs', heading: 'College Costs' },
  { id: 'loans', label: 'Loan Amounts', heading: 'Loan Amounts' },
  { id: 'results', label: 'Results', heading: 'Results' },
];
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const nav = (page: Page) => page.getByRole('navigation', { name: 'Planner sections' });
const navLink = (page: Page, name: string) => nav(page).getByRole('link', { name, exact: true });
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const axeViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`);
};

/** Reload (the disclaimer stays dismissed) so keyboard navigation starts from the top of the document. */
async function freshPage(page: Page) {
  await page.goto('/');
  await expect(page.locator('.dashboard')).toBeVisible();
  await expect(page.getByRole('button', { name: 'I understand' })).toHaveCount(0);
}

// Every test signs in as a fresh account through the real OIDC flow.
test.beforeEach(async ({ page, user }) => {
  await openPlanner(page, user);
});

test('there are exactly four tabs; each opens only its destination, focuses its heading and becomes current', async ({ page }) => {
  await expect(nav(page).getByRole('link')).toHaveCount(4);
  for (const [index, { label }] of DESTINATIONS.entries()) await expect(nav(page).getByRole('link').nth(index)).toHaveAccessibleName(label);
  for (const { id, label, heading } of DESTINATIONS) {
    await navLink(page, label).click();
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    await expect(page.locator('.dashboard')).toHaveAttribute('data-dashboard', id);
    await expect(page.locator(`#${id}-heading`)).toBeFocused();
    await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
    await expect(navLink(page, label)).toHaveAttribute('aria-current', 'page');
    await expect(nav(page).locator('[aria-current="page"]')).toHaveCount(1);
    for (const other of DESTINATIONS.filter(item => item.id !== id)) await expect(page.locator(`#${other.id}`)).toHaveCount(0);
  }
});

test('direct URLs and Back/Forward keep the current tab in sync', async ({ page }) => {
  await page.goto('/#loans');
  await expect(navLink(page, 'Loan Amounts')).toHaveAttribute('aria-current', 'page');
  await navLink(page, 'Results').click();
  await navLink(page, 'College Costs').click();
  await page.goBack();
  await expect(page).toHaveURL(/#results$/);
  await expect(navLink(page, 'Results')).toHaveAttribute('aria-current', 'page');
  await page.goForward();
  await expect(page).toHaveURL(/#school$/);
  await expect(navLink(page, 'College Costs')).toHaveAttribute('aria-current', 'page');
});

test('old bookmarks land on the new home with the matching section open', async ({ page }) => {
  const cases: [string, string, string | null][] = [
    ['setup', 'school', 'settings.startDate'],
    ['income', 'school', 'income-add-earnings'],
    ['repayment', 'results', 'postGradIncome.monthlyDebtBudget'],
    ['events', 'results', 'lifeEvents-add-income'],
    ['scenarios', 'results', null],
    ['federal', 'results', null],
  ];
  for (const [legacy, destination, fieldId] of cases) {
    await page.goto(`/?visit=${legacy}#${legacy}`);
    await expect(page.locator('.dashboard')).toHaveAttribute('data-dashboard', destination);
    await expect(page).toHaveURL(new RegExp(`#${destination}$`));
    if (fieldId) {
      await expect(page.locator(`[id="${fieldId}"]`)).toBeFocused();
      await expect(page.locator(`[id="${fieldId}"]`)).toBeVisible();
    }
  }
  // #data opens Account → Your data on the current page.
  await page.goto('/?visit=data#data');
  await expect(page.getByRole('dialog', { name: 'Your data' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('keyboard only: skip link first, then the tabs in order; Enter activates; the skip link reaches main', async ({ page }) => {
  await freshPage(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to your plan' })).toBeFocused();
  // Header controls come next (Undo is disabled on a fresh plan, so it is skipped), then the tabs.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /^Account/ })).toBeFocused();
  for (const { label } of DESTINATIONS.slice(0, 3)) {
    await page.keyboard.press('Tab');
    await expect(navLink(page, label)).toBeFocused();
  }
  await page.keyboard.press('Enter');
  await expect(page.locator('#loans-heading')).toBeFocused();
  await expect(navLink(page, 'Loan Amounts')).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('#loans'))).toBe(true);
  await page.getByRole('link', { name: 'Skip to your plan' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('the account menu opens and closes with mouse and keyboard and keeps focus', async ({ page }) => {
  const button = page.getByRole('button', { name: /^Account/ });
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  for (const name of ['Your data', 'Undo history', 'About these estimates', 'Sign out']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).toBeFocused();
  await button.click();
  await page.locator('#main').click({ position: { x: 5, y: 5 } });
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await page.getByRole('button', { name: 'About these estimates', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Estimates, not financial advice' })).toBeFocused();
});

test('axe: no violations with the menu closed and open; no horizontal overflow at 1280 px', async ({ page }) => {
  expect(page.viewportSize()?.width).toBe(1280);
  expect(await axeViolations(page)).toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: /^Account/ }).click();
  expect(await axeViolations(page)).toEqual([]);
});

test('print hides the tabs and the header controls', async ({ page }) => {
  await navLink(page, 'Results').click();
  await page.emulateMedia({ media: 'print' });
  await expect(nav(page)).toBeHidden();
  await expect(page.locator('.account-menu')).toBeHidden();
  await expect(page.locator('#results')).toBeVisible();
});

test.describe('360 px @narrow', () => {
  test('the four tabs fit on one row with short labels and full accessible names', async ({ page }) => {
    expect(page.viewportSize()?.width).toBe(360);
    const links = nav(page).getByRole('link');
    await expect(links).toHaveCount(4);
    for (const { label } of DESTINATIONS) await expect(navLink(page, label)).toBeInViewport({ ratio: 1 });
    await expect(nav(page).locator('.tab-label--short')).toHaveText(['Intro', 'Costs', 'Loans', 'Results']);
    await navLink(page, 'Results').click();
    await expect(page.locator('#results-heading')).toBeFocused();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: /^Account/ }).click();
    await expect(page.getByRole('button', { name: 'Your data', exact: true })).toBeInViewport();
    expect(await axeViolations(page)).toEqual([]);
  });
});
