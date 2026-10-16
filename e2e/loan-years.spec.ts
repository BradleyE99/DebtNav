import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Optional "Group by year" view of the Loans page, exercised with real mouse and keyboard input in Chromium.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const groupBy = (page: Page) => page.getByRole('checkbox', { name: 'Group by year' });
const year = (page: Page, key: string) => page.locator(`#loans-year-${key}`);
const yearToggle = (page: Page, key: string) => year(page, key).locator('> h3 button');
const yearCards = (page: Page, key: string) => year(page, key).locator('article.loan-card');
const field = (target: Locator, suffix: string) => target.locator(`[id$=".${suffix}"]`);
const focusedId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? '');

async function navigate(page: Page, id: string) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.locator(`nav a[href="#${id}"]`).click();
  await expect(page.locator('.dashboard')).toHaveAttribute('data-dashboard', id);
}

async function retype(page: Page, input: Locator, text: string) {
  await input.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
}

/** Adds a loan (dated at the plan start, 2026) with a name and an amount. */
async function addLoan(page: Page, name: string, principal: string) {
  await page.getByRole('button', { name: 'Add loan' }).click();
  const id = await focusedId(page);
  expect(id).toMatch(/^loans\.[^.]+\.name$/);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(name);
  const card = page.locator('article.loan-card').filter({ has: page.locator(`[id="${id}"]`) });
  await retype(page, field(card, 'principal'), principal);
  await page.keyboard.press('Tab');
  return card;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'I understand' }).click();
  await navigate(page, 'loans');
});

test('groups by year with totals, follows date changes, is remembered, and switches back', async ({ page }) => {
  await addLoan(page, 'Stafford', '5500');
  const bank = await addLoan(page, 'Bank loan', '12000');

  // Keyboard: Space toggles grouping on.
  await groupBy(page).focus();
  await page.keyboard.press('Space');
  await expect(groupBy(page)).toBeChecked();
  await expect(page.locator('.loan-year')).toHaveCount(1);
  await expect(yearToggle(page, '2026')).toHaveText(/2026\s*2 loans · \$17,500\.00 principal/);
  await expect(yearCards(page, '2026')).toHaveCount(2);

  // Typing a new disbursement date moves the loan; it stays open and focused.
  const date = field(bank, 'disbursementDate');
  await date.focus();
  await page.keyboard.type('03012027');
  await expect(date).toHaveValue('2027-03-01');
  await expect(date).toBeFocused();
  await expect(page.locator('.loan-year')).toHaveCount(2);
  await expect(yearToggle(page, '2026')).toHaveText(/1 loan · \$5,500\.00 principal/);
  await expect(yearToggle(page, '2027')).toHaveText(/1 loan · \$12,000\.00 principal/);
  await expect(yearCards(page, '2027')).toContainText('Bank loan');
  await expect(field(bank, 'principal')).toBeVisible();

  // Keyboard: Enter collapses a year; edits survive.
  await yearToggle(page, '2027').focus();
  await page.keyboard.press('Enter');
  await expect(yearToggle(page, '2027')).toHaveAttribute('aria-expanded', 'false');
  await expect(yearCards(page, '2027')).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(field(bank, 'principal')).toHaveValue('12,000.00');

  const axe = await new AxeBuilder({ page }).include('#loans').withTags(WCAG_TAGS).analyze();
  expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);

  // Remembered on this device.
  await page.waitForTimeout(700);
  await page.reload();
  await expect(groupBy(page)).toBeChecked();
  await expect(page.locator('.loan-year')).toHaveCount(2);

  // Deleting the only loan of a year removes that year.
  await yearCards(page, '2027').locator('h4 button').click();
  await yearCards(page, '2027').getByRole('button', { name: /Remove loan/ }).click();
  await expect(page.locator('.loan-year')).toHaveCount(1);

  // Back to the flat list.
  await groupBy(page).click();
  await expect(page.locator('.loan-year')).toHaveCount(0);
  await expect(page.locator('.loan-list > article.loan-card h3 button')).toHaveCount(1);
});

test('checklist actions open the year section and card they need', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('debtnav.ui.loansGroupByYear', 'year'));
  await navigate(page, 'results');
  await page.locator('main [data-readiness-id="loans.none"]').getByRole('button').click();
  await expect.poll(() => focusedId(page)).toBe('loans-add');
  await page.keyboard.press('Enter');
  await expect(yearToggle(page, '2026')).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => focusedId(page)).toMatch(/^loans\.[^.]+\.name$/);

  await yearToggle(page, '2026').click();
  await expect(yearCards(page, '2026')).toBeHidden();
  await navigate(page, 'results');
  await page.locator('main [data-readiness-id="loans.allZero"]').getByRole('button').click();
  await expect.poll(() => focusedId(page)).toMatch(/^loans\.[^.]+\.principal$/);
  await expect(page.locator(`[id="${await focusedId(page)}"]`)).toBeVisible();
  await expect(yearToggle(page, '2026')).toHaveAttribute('aria-expanded', 'true');
});

test('year sections fit at 360 px without horizontal scrolling @narrow', async ({ page }) => {
  await addLoan(page, 'Supercalifragilisticexpialidocious private loan', '1000000000');
  await addLoan(page, 'Second', '2500');
  await groupBy(page).click();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const offenders = () => page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll<HTMLElement>('#loans *')]
      .filter(el => !el.closest('.visually-hidden, [hidden]'))
      .filter(el => el.getBoundingClientRect().right > width + 0.5)
      .map(el => `${el.tagName.toLowerCase()}.${el.className}`);
  });
  await page.getByRole('button', { name: 'Collapse all' }).click();
  expect(await overflow()).toBeLessThanOrEqual(0);
  expect(await offenders()).toEqual([]);
  await expect(yearToggle(page, '2026')).toHaveText(/2 loans · \$1,000,002,500\.00 principal/);
  await page.getByRole('button', { name: 'Expand all' }).click();
  expect(await overflow()).toBeLessThanOrEqual(0);
  expect(await offenders()).toEqual([]);
});
