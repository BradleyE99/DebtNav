import type { Page, Locator } from '@playwright/test';
import { test, expect, openPlanner } from './support/fixtures';
import AxeBuilder from '@axe-core/playwright';

// Expandable loan cards, exercised with real mouse and keyboard input in Chromium.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const cards = (page: Page) => page.locator('article.loan-card');
const card = (page: Page, n: number) => cards(page).nth(n - 1);
const toggle = (target: Locator) => target.locator('h3 button');
const details = (target: Locator) => target.locator('.loan-card__details');
const field = (target: Locator, suffix: string) => target.locator(`[id$=".${suffix}"]`);
/** Term, required-payment terms and interest options are under each card's "Advanced" disclosure. */
const advanced = (target: Locator) => target.locator('details.loan-card__advanced');
async function navigate(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Planner sections' }).getByRole('link', { name, exact: true }).click();
}
async function readResults(page: Page) {
  await navigate(page, 'Results');
  const interest = await page.getByTestId('headline-interest').innerText();
  const debtFree = await page.getByTestId('headline-debt-free').innerText();
  await navigate(page, 'Loan Amounts');
  return { interest, debtFree };
}

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

// Every test signs in as a fresh account (empty plan) through the real OIDC flow.
test.beforeEach(async ({ page, user }) => {
  await openPlanner(page, user);
  await expect(page.getByRole('heading', { name: 'Estimates, not financial advice' })).toHaveCount(0);
  await navigate(page, 'Loan Amounts');
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
  await advanced(card(page, 2)).locator(':scope > summary').click();
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

test('valid edits persist through collapse, tab navigation, and reload', async ({ page }) => {
  await addTwoLoans(page);
  const first = card(page, 1);
  await retype(page, field(first, 'principal'), '7250.5');
  await advanced(first).locator(':scope > summary').click();
  await retype(page, field(first, 'termMonths'), '180');
  await page.keyboard.press('Tab');
  await expect(toggle(first)).toContainText('Principal $7,250.50');
  await toggle(first).click();
  await expectCollapsed(first);

  // Use the tabs to leave and return; valid values belong to the shared plan.
  await navigate(page, 'Results');
  await expect(page).toHaveURL(/#results$/);
  await navigate(page, 'Loan Amounts');
  await expect(page).toHaveURL(/#loans$/);
  await expectCollapsed(first);
  await expectCollapsed(card(page, 2));
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

test('editing principal and rate updates the overview results', async ({ page }) => {
  await addTwoLoans(page);
  const before = await readResults(page);
  expect(before.interest).toMatch(/^\$[\d,]+\.\d\d$/);
  const first = card(page, 1);
  await toggle(first).click();
  await retype(page, field(first, 'principal'), '25000');
  await page.keyboard.press('Tab');
  const afterPrincipal = await readResults(page);
  expect(afterPrincipal.interest).not.toBe(before.interest);
  await toggle(first).click();
  await retype(page, field(first, 'annualRate'), '12');
  await page.keyboard.press('Tab');
  await expect(toggle(first)).toContainText('Annual rate 12%');
  await expect(toggle(first)).toContainText('Principal $25,000.00');
  const afterRate = await readResults(page);
  expect(afterRate.interest).not.toBe(afterPrincipal.interest);
  expect(afterRate.debtFree).toMatch(/^[A-Z][a-z]{2} \d{4}$|No debt-free date/);
});

test('gap-created loans open for editing and deletion preserves the remaining card', async ({ page }) => {
  await addTwoLoans(page);
  await navigate(page, 'College Costs');
  // "Create loan" offers what Year 1 still needs (gap + buffer − its loans); with no costs it is disabled.
  // $25,000 of costs − $17,500 of loans already for the year → $7,500.
  await page.getByRole('button', { name: 'Add Year 1 costs' }).click();
  await expect(page.locator('input[id$=".amount"]')).toBeFocused();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('25000');
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: /^Create loan for \$7,500\.00 for Year 1$/ }).click();
  await expect(cards(page)).toHaveCount(3);
  const gapLoan = card(page, 3);
  await expectExpanded(gapLoan);
  await expect(field(gapLoan, 'name')).toBeFocused();
  await expect(toggle(gapLoan)).toContainText('from Year 1 gap');
  await expectCollapsed(card(page, 1));
  await expectCollapsed(card(page, 2));
  await retype(page, field(gapLoan, 'name'), 'Gap loan');
  await page.keyboard.press('Tab');
  await gapLoan.getByRole('button', { name: 'Remove loan Gap loan' }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator('#loans-heading')).toBeFocused();
  await expectCollapsed(card(page, 1));
  await expectCollapsed(card(page, 2));
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
