import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Expandable loan cards, exercised with real mouse and keyboard input in Chromium.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const cards = (page: Page) => page.locator('article.loan-card');
const card = (page: Page, n: number) => cards(page).nth(n - 1);
const toggle = (target: Locator) => target.locator('h3 button');
const details = (target: Locator) => target.locator('.loan-card__details');
const field = (target: Locator, suffix: string) => target.locator(`[id$=".${suffix}"]`);
const keyFigure = (page: Page, id: 'key-debt-free' | 'key-interest') => page.getByTestId(id);

/** Click into a field, select everything, delete it with the keyboard, then type like a person. */
async function retype(page: Page, input: Locator, text: string) {
  await input.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await expect(input).toHaveValue('');
  if (text) await page.keyboard.type(text);
}

async function expectCollapsed(target: Locator) {
  await expect(toggle(target)).toHaveAttribute('aria-expanded', 'false');
  await expect(details(target)).toBeHidden();
}

async function expectExpanded(target: Locator) {
  await expect(toggle(target)).toHaveAttribute('aria-expanded', 'true');
  await expect(details(target)).toBeVisible();
}

/** Lets the debounced autosave write to localStorage before a reload. */
async function waitForSave(page: Page) {
  await page.waitForTimeout(700);
}

/** Adds two loans by typing, the way a person would. New loans open and focus their name field. */
async function addTwoLoans(page: Page) {
  await page.getByRole('button', { name: 'Add loan' }).click();
  const first = card(page, 1);
  await expectExpanded(first);
  await expect(field(first, 'name')).toBeFocused();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Stafford');
  await retype(page, field(first, 'principal'), '5500');
  await retype(page, field(first, 'annualRate'), '6.53');
  await page.keyboard.press('Tab');

  await page.getByRole('button', { name: 'Add loan' }).click();
  const second = card(page, 2);
  await expectExpanded(second);
  await expect(field(second, 'name')).toBeFocused();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Bank loan');
  await field(second, 'type').selectOption('private');
  await retype(page, field(second, 'principal'), '12000');
  await retype(page, field(second, 'annualRate'), '9.25');
  await page.keyboard.press('Tab');
  // The first card stayed open: several cards can be open at once.
  await expectExpanded(first);
  await waitForSave(page);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'I understand' }).click();
  await expect(page.getByRole('heading', { name: 'Estimates, not financial advice' })).toHaveCount(0);
});

test('summaries, collapsed on load, individual, bulk, and keyboard toggling', async ({ page }) => {
  await addTwoLoans(page);
  await page.reload();
  await expect(cards(page)).toHaveCount(2);
  await expectCollapsed(card(page, 1));
  await expectCollapsed(card(page, 2));

  const firstHeader = toggle(card(page, 1));
  await expect(firstHeader).toContainText('Stafford');
  await expect(firstHeader).toContainText('Federal Direct Unsubsidized');
  await expect(firstHeader).toContainText('Principal $5,500.00');
  await expect(firstHeader).toContainText('Annual rate 6.53%');
  await expect(firstHeader).toContainText(/Balance at repayment \$[\d,]+\.\d\d/);
  const secondHeader = toggle(card(page, 2));
  await expect(secondHeader).toContainText('Bank loan');
  await expect(secondHeader).toContainText('Private');
  await expect(secondHeader).toContainText('Principal $12,000.00');
  await expect(secondHeader).toContainText('Annual rate 9.25%');

  // Mouse: open one, open another, close the first again.
  await firstHeader.click();
  await expectExpanded(card(page, 1));
  await secondHeader.click();
  await expectExpanded(card(page, 1));
  await expectExpanded(card(page, 2));
  await firstHeader.click();
  await expectCollapsed(card(page, 1));
  await expectExpanded(card(page, 2));

  // Clicking a field or a checkbox inside an open card does not toggle it.
  await field(card(page, 2), 'principal').click();
  await field(card(page, 2), 'capitalizeInterest').click();
  await expectExpanded(card(page, 2));

  // Bulk controls.
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expectExpanded(card(page, 1));
  await expectExpanded(card(page, 2));
  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expectCollapsed(card(page, 1));
  await expectCollapsed(card(page, 2));

  // Keyboard: Enter and Space on the header button.
  await firstHeader.focus();
  await page.keyboard.press('Enter');
  await expectExpanded(card(page, 1));
  await expect(firstHeader).toBeFocused();
  await page.keyboard.press('Space');
  await expectCollapsed(card(page, 1));
  // Tab from an open header moves into its fields.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(field(card(page, 1), 'name')).toBeFocused();
});

test('invalid text survives collapsing and the collapsed summary flags it', async ({ page }) => {
  await addTwoLoans(page);
  const first = card(page, 1);
  const principal = field(first, 'principal');
  await retype(page, principal, 'abc');
  await page.keyboard.press('Tab');
  await expect(principal).toHaveAttribute('aria-invalid', 'true');
  await toggle(first).click();
  await expectCollapsed(first);
  const indicator = first.locator('.loan-card__attention');
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveText(/Needs attention: 1 field/);
  await expect(toggle(first)).toHaveAccessibleDescription(/Needs attention: 1 field/);
  // The summary still shows the last saved principal; the invalid text was never saved.
  await expect(toggle(first)).toContainText('Principal $5,500.00');
  await expect(card(page, 2).locator('.loan-card__attention')).toHaveCount(0);

  await toggle(first).click();
  await expectExpanded(first);
  await expect(principal).toHaveValue('abc');
  await expect(principal).toHaveAttribute('aria-invalid', 'true');
  await expect(first.locator('.field-error')).toBeVisible();

  // A cleared amount is incomplete and flagged too.
  await retype(page, principal, '');
  await page.keyboard.press('Tab');
  await toggle(first).click();
  await expect(indicator).toHaveText(/Needs attention: 1 field/);

  // Fixing it removes the indicator.
  await toggle(first).click();
  await retype(page, principal, '6000');
  await page.keyboard.press('Tab');
  await expect(indicator).toHaveCount(0);
  await expect(toggle(first)).toContainText('Principal $6,000.00');
});

test('valid edits persist through collapse, sidebar navigation, and reload', async ({ page }) => {
  await addTwoLoans(page);
  const first = card(page, 1);
  await retype(page, field(first, 'principal'), '7250.5');
  await retype(page, field(first, 'termMonths'), '180');
  await page.keyboard.press('Tab');
  await expect(toggle(first)).toContainText('Principal $7,250.50');
  await toggle(first).click();
  await expectCollapsed(first);

  // Use the sidebar to leave and return; navigation must not remount the fields.
  await page.getByRole('link', { name: 'Repayment', exact: true }).click();
  await expect(page).toHaveURL(/#repayment$/);
  await page.getByRole('link', { name: 'Loans', exact: true }).click();
  await expect(page).toHaveURL(/#loans$/);
  await expectCollapsed(first);
  await expectExpanded(card(page, 2));
  await toggle(first).click();
  await expect(field(first, 'principal')).toHaveValue('7,250.50');
  await expect(field(first, 'termMonths')).toHaveValue('180');

  await waitForSave(page);
  await page.reload();
  await expectCollapsed(card(page, 1));
  await expect(toggle(card(page, 1))).toContainText('Principal $7,250.50');
  await toggle(card(page, 1)).click();
  await expect(field(card(page, 1), 'principal')).toHaveValue('7,250.50');
  await expect(field(card(page, 1), 'termMonths')).toHaveValue('180');
});

test('editing principal and rate updates the key results', async ({ page }) => {
  await addTwoLoans(page);
  const first = card(page, 1);
  await expect(keyFigure(page, 'key-interest')).toHaveText(/^\$[\d,]+\.\d\d$/);
  const interestBefore = await keyFigure(page, 'key-interest').innerText();
  await retype(page, field(first, 'principal'), '25000');
  await page.keyboard.press('Tab');
  await expect(keyFigure(page, 'key-interest')).not.toHaveText(interestBefore);
  const interestAfterPrincipal = await keyFigure(page, 'key-interest').innerText();
  const debtFreeBefore = await keyFigure(page, 'key-debt-free').innerText();

  await retype(page, field(first, 'annualRate'), '12');
  await page.keyboard.press('Tab');
  await expect(keyFigure(page, 'key-interest')).not.toHaveText(interestAfterPrincipal);
  await expect(toggle(first)).toContainText('Annual rate 12%');
  await expect(toggle(first)).toContainText('Principal $25,000.00');
  // Debt-free date is a month and year (it may or may not move with the rate under a minimum-payment plan).
  await expect(keyFigure(page, 'key-debt-free')).toHaveText(/^[A-Z][a-z]{2} \d{4}$|No debt-free date/);
  expect(debtFreeBefore).toMatch(/^[A-Z][a-z]{2} \d{4}$|No debt-free date/);
});

test('gap-created loans open for editing and deletion preserves the remaining card', async ({ page }) => {
  await addTwoLoans(page);
  await page.getByRole('button', { name: 'Create loan from gap for Year 1' }).click();
  await expect(cards(page)).toHaveCount(3);
  const gapLoan = card(page, 3);
  await expectExpanded(gapLoan);
  await expect(field(gapLoan, 'name')).toBeFocused();
  await expect(toggle(gapLoan)).toContainText('from Year 1 gap');
  await expectExpanded(card(page, 1));
  await expectExpanded(card(page, 2));
  await retype(page, field(gapLoan, 'name'), 'Gap loan');
  await page.keyboard.press('Tab');
  await gapLoan.getByRole('button', { name: 'Remove loan Gap loan' }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator('#loans-heading')).toBeFocused();
  await expectExpanded(card(page, 1));
  await expectExpanded(card(page, 2));
  await expect(toggle(card(page, 1))).toContainText('Principal $5,500.00');
  await expect(toggle(card(page, 2))).toContainText('Annual rate 9.25%');
  await waitForSave(page);
  await page.reload();
  await expect(cards(page)).toHaveCount(2);
  await expectCollapsed(card(page, 1));
  await expect(toggle(card(page, 1))).toContainText('Stafford');
});

test('no axe violations with loan cards collapsed and expanded', async ({ page }) => {
  await addTwoLoans(page);
  // Put one card into an attention state so the indicator is checked too.
  await retype(page, field(card(page, 1), 'principal'), '5x');
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expectCollapsed(card(page, 1));
  const collapsed = await new AxeBuilder({ page }).include('#loans').withTags(WCAG_TAGS).analyze();
  expect(collapsed.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);

  await page.getByRole('button', { name: 'Expand all' }).click();
  await expectExpanded(card(page, 2));
  const expanded = await new AxeBuilder({ page }).include('#loans').withTags(WCAG_TAGS).analyze();
  expect(expanded.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
});

test('loan cards fit at 360 px without horizontal scrolling @narrow', async ({ page }) => {
  await addTwoLoans(page);
  // Summary figures must wrap between label and value even at the accepted amount limit.
  await retype(page, field(card(page, 1), 'principal'), '1000000000');
  // A long unbroken name must wrap too.
  await retype(page, field(card(page, 2), 'name'), 'Supercalifragilisticexpialidocious private loan');
  await page.keyboard.press('Tab');
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const cardOffenders = () => page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll<HTMLElement>('#loans *')]
      .filter(el => !el.closest('.visually-hidden, [hidden]'))
      .filter(el => el.getBoundingClientRect().right > width + 0.5)
      .map(el => `${el.tagName.toLowerCase()}.${el.className}`);
  });
  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expectCollapsed(card(page, 2));
  expect(await overflow()).toBeLessThanOrEqual(0);
  expect(await cardOffenders()).toEqual([]);
  const figuresFit = await page.locator('.loan-card__figure').evaluateAll(elements => elements.every(el => el.scrollWidth <= el.clientWidth));
  expect(figuresFit).toBe(true);
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expectExpanded(card(page, 2));
  expect(await overflow()).toBeLessThanOrEqual(0);
  expect(await cardOffenders()).toEqual([]);
});
