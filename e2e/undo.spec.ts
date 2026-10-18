/**
 * US-904 persistent undo: no timer, survives later edits, LIFO, saved to the server, keyboard reachable,
 * disabled when empty, import replacement undoable.
 */
import type { Page, Locator } from '@playwright/test';
import { test, expect, goTo, getPlan } from './support/fixtures';

const go = goTo;
async function retype(page: Page, field: Locator, value: string) {
  await field.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(value);
  await field.blur();
}
const undoButton = (page: Page) => page.getByRole('group', { name: 'Undo' }).getByRole('button', { name: 'Undo', exact: true });
const budgetField = (page: Page) => page.getByLabel('Monthly payment', { exact: true });
const serverBudget = async (page: Page) => ((await getPlan(page.request)).document?.plan.postGradIncome as { monthlyDebtBudget: string }).monthlyDebtBudget;

test('Undo is visible but disabled when nothing can be undone', async ({ signedIn: page }) => {
  await expect(undoButton(page)).toBeVisible();
  await expect(undoButton(page)).toBeDisabled();
  await expect(page.getByRole('group', { name: 'Undo' })).toContainText('Nothing to undo');
});

test('Undo stays available after more than five seconds and after later edits; it is LIFO and saved', async ({ signedIn: page }) => {
  await go(page, 'repayment');
  const original = await budgetField(page).inputValue();
  await retype(page, budgetField(page), '501');
  await page.waitForTimeout(6_500);
  await expect(undoButton(page)).toBeEnabled();
  await go(page, 'loans');
  await page.getByRole('button', { name: 'Add loan', exact: true }).click();
  await expect(page.locator('article.loan-card')).toHaveCount(1);
  await page.waitForTimeout(6_500);
  await expect(undoButton(page)).toBeEnabled();
  // Newest first: the loan disappears, the budget edit is kept.
  await undoButton(page).click();
  await expect(page.locator('article.loan-card')).toHaveCount(0);
  await go(page, 'repayment');
  await expect(budgetField(page)).toHaveValue('501.00');
  await expect(undoButton(page)).toBeEnabled();
  await undoButton(page).click();
  await expect(budgetField(page)).toHaveValue(original);
  // The reversal is saved to the account.
  await expect.poll(() => serverBudget(page)).toBe(original.replace(/,/g, ''));
  await page.reload();
  await go(page, 'repayment');
  await expect(budgetField(page)).toHaveValue(original);
});

test('deleting a loan then making another edit: undo twice restores the loan with all its fields', async ({ signedIn: page }) => {
  await go(page, 'loans');
  await page.getByRole('button', { name: 'Add loan', exact: true }).click();
  const card = page.locator('article.loan-card').first();
  await retype(page, card.locator('[id$=".principal"]'), '4321');
  const before = JSON.stringify((await getPlan(page.request)).document?.plan.loans);
  await card.getByRole('button', { name: /delete|remove/i }).first().click();
  const confirm = page.getByRole('alertdialog');
  if (await confirm.isVisible()) await confirm.getByRole('button', { name: /delete|remove/i }).click();
  await expect(page.locator('article.loan-card')).toHaveCount(0);
  await go(page, 'repayment');
  await retype(page, budgetField(page), '612');
  await undoButton(page).click();
  await undoButton(page).click();
  await go(page, 'loans');
  await expect(page.locator('article.loan-card')).toHaveCount(1);
  await expect.poll(async () => JSON.stringify((await getPlan(page.request)).document?.plan.loans)).toBe(before);
});

test('Undo and its history are keyboard operable', async ({ signedIn: page }) => {
  await go(page, 'repayment');
  await retype(page, budgetField(page), '333');
  await undoButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(budgetField(page)).not.toHaveValue('333.00');
  // The history list is in Account → Undo history; all of it works with the keyboard.
  const account = page.getByRole('button', { name: /^Account/ });
  await account.focus();
  await page.keyboard.press('Enter');
  await expect(account).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Undo history' })).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Undo history' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Deleting your data is not part of this history');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(account).toBeFocused();
});
