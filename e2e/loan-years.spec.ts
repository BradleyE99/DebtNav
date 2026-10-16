import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Loan academic years and "Group by academic year", exercised with real mouse and keyboard input in Chromium.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const groupBy = (page: Page) => page.getByRole('checkbox', { name: 'Group by academic year' });
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

async function readResults(page: Page) {
  await navigate(page, 'overview');
  const interest = await page.getByTestId('key-interest').innerText();
  const debtFree = await page.getByTestId('key-debt-free').innerText();
  await navigate(page, 'loans');
  return { interest, debtFree };
}

/** Adds a loan (dated at the plan start, so assigned to 2026–2027) with a name and an amount. */
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

test('assigns academic years, groups by them, keeps interest unchanged, and remembers both', async ({ page }) => {
  await addLoan(page, 'Stafford', '5500');
  const bank = await addLoan(page, 'Bank loan', '12000');
  await expect(bank.locator('h3 button')).toContainText('Academic year 2026–2027');
  const date = await field(bank, 'disbursementDate').inputValue();
  await page.waitForTimeout(700);
  const before = await readResults(page);

  // Keyboard: Space toggles grouping on.
  await groupBy(page).focus();
  await page.keyboard.press('Space');
  await expect(groupBy(page)).toBeChecked();
  await expect(page.locator('.loan-year')).toHaveCount(1);
  await expect(yearToggle(page, '2026-2027')).toHaveText(/2026–2027\s*2 loans · \$17,500\.00 principal/);

  // Reassign the bank loan to a school year in the plan: it moves, stays open and keeps focus.
  if (!(await field(bank, 'academicYear').isVisible())) await bank.locator('h4 button').click();
  await field(bank, 'academicYear').focus();
  await field(bank, 'academicYear').selectOption('2027-2028');
  await expect(page.locator('.loan-year')).toHaveCount(2);
  await expect(yearCards(page, '2027-2028')).toContainText('Bank loan');
  await expect(field(bank, 'academicYear')).toBeFocused();
  await expect(yearToggle(page, '2026-2027')).toHaveText(/1 loan · \$5,500\.00 principal/);

  // Add a range that is not one of the plan's school years, by keyboard.
  await field(bank, 'academicYear').selectOption('__add__');
  await expect(page.locator('[id$=".academicYear-start"]')).toBeFocused();
  await page.keyboard.type('2025');
  await expect(page.locator('[id$=".academicYear-start-hint"]')).toHaveText('Adds 2025–2026.');
  await page.keyboard.press('Enter');
  await expect(field(bank, 'academicYear')).toHaveValue('2025-2026');
  await expect(page.locator('.loan-year h3')).toHaveText([/^2025–2026/, /^2026–2027/]);
  await expect(field(bank, 'disbursementDate')).toHaveValue(date);

  // Only the assignment changed: interest and the debt-free date are the same.
  await page.waitForTimeout(700);
  expect(await readResults(page)).toEqual(before);

  // Keyboard: Enter collapses a year.
  await yearToggle(page, '2025-2026').focus();
  await page.keyboard.press('Enter');
  await expect(yearToggle(page, '2025-2026')).toHaveAttribute('aria-expanded', 'false');
  await expect(yearCards(page, '2025-2026')).toBeHidden();
  await page.keyboard.press('Enter');

  const axe = await new AxeBuilder({ page }).include('#loans').withTags(WCAG_TAGS).analyze();
  expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);

  // Assignment and grouping preference survive a reload.
  await page.reload();
  await expect(groupBy(page)).toBeChecked();
  await expect(yearCards(page, '2025-2026')).toContainText('Bank loan');
  await expect(yearCards(page, '2025-2026').locator('h4 button')).toContainText('Academic year 2025–2026');

  // Deleting the only loan of a year removes that year.
  await yearCards(page, '2025-2026').locator('h4 button').click();
  await yearCards(page, '2025-2026').getByRole('button', { name: /Remove loan/ }).click();
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
  await expect(yearToggle(page, '2026-2027')).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => focusedId(page)).toMatch(/^loans\.[^.]+\.name$/);

  await yearToggle(page, '2026-2027').click();
  await expect(yearCards(page, '2026-2027')).toBeHidden();
  await navigate(page, 'results');
  await page.locator('main [data-readiness-id="loans.allZero"]').getByRole('button').click();
  await expect.poll(() => focusedId(page)).toMatch(/^loans\.[^.]+\.principal$/);
  await expect(page.locator(`[id="${await focusedId(page)}"]`)).toBeVisible();
  await expect(yearToggle(page, '2026-2027')).toHaveAttribute('aria-expanded', 'true');
});

test('year sections and the academic year form fit at 360 px without horizontal scrolling @narrow', async ({ page }) => {
  const first = await addLoan(page, 'Supercalifragilisticexpialidocious private loan', '1000000000');
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
  await expect(yearToggle(page, '2026-2027')).toHaveText(/2 loans · \$1,000,002,500\.00 principal/);
  await page.getByRole('button', { name: 'Expand all' }).click();
  await field(first, 'academicYear').selectOption('__add__');
  await expect(page.getByRole('button', { name: 'Add academic year' })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  expect(await offenders()).toEqual([]);
});
