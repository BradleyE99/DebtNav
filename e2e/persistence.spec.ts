/**
 * US-1001/US-1202: account saving. Save → reload, backend restart (same database), another device, concurrent
 * edits (409 → conflict UI), offline and server errors with retry, account deletion.
 */
import type { Page, Locator } from '@playwright/test';
import { test, expect, openPlanner, seedPlan, getPlan, putPlan, restartApi, secondDevice, APP_ORIGIN, CSRF } from './support/fixtures';

const status = (page: Page) => page.locator('.save-status');
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
/** The post-graduation monthly budget (Repayment Plan owns it, US-501). */
const budgetField = (page: Page) => page.getByLabel('Monthly debt budget (your chosen payment)');
async function editBudget(page: Page, value: string) {
  await go(page, 'repayment');
  await retype(page, budgetField(page), value);
}
const serverBudget = async (page: Page) => (await getPlan(page.request)).document?.plan.postGradIncome as { monthlyDebtBudget: string } | undefined;

test('edits are saved to the account and survive a reload', async ({ signedIn: page }) => {
  await editBudget(page, '515');
  await expect(status(page)).toContainText(/saved/i);
  await expect.poll(async () => (await serverBudget(page))?.monthlyDebtBudget).toBe('515.00');
  await page.reload();
  await go(page, 'repayment');
  await expect(budgetField(page)).toHaveValue('515.00');
});

// @restart: runs in its own project after all others (restarting the shared API would break parallel tests).
test('saved data survives a backend restart @restart', async ({ signedIn: page }) => {
  await editBudget(page, '616');
  await expect.poll(async () => (await serverBudget(page))?.monthlyDebtBudget).toBe('616.00');
  const { revision } = await getPlan(page.request);
  await restartApi(page.request);
  // The session also survives (sessions live in the database).
  const after = await getPlan(page.request);
  expect(after.revision).toBe(revision);
  await page.reload();
  await go(page, 'repayment');
  await expect(budgetField(page)).toHaveValue('616.00');
});

test('another device signed in as the same user gets the latest plan', async ({ signedIn: page, context, user }) => {
  await editBudget(page, '717');
  await expect.poll(async () => (await serverBudget(page))?.monthlyDebtBudget).toBe('717.00');
  const other = await secondDevice(context, user);
  await go(other, 'repayment');
  await expect(budgetField(other)).toHaveValue('717.00');
  await other.context().close();
});

test('concurrent edits on two devices: the stale one shows a conflict instead of overwriting', async ({ signedIn: page, context, user }) => {
  await editBudget(page, '100');
  await expect.poll(async () => (await serverBudget(page))?.monthlyDebtBudget).toBe('100.00');
  const other = await secondDevice(context, user);
  await editBudget(other, '200');
  await expect.poll(async () => (await serverBudget(page))?.monthlyDebtBudget).toBe('200.00');
  // The first device still holds the old revision.
  await retype(page, budgetField(page), '300');
  await expect(status(page)).toContainText(/conflict|changed (on|in|from) another|newer version/i);
  expect((await serverBudget(page))?.monthlyDebtBudget).toBe('200.00');
  // Resolve by loading the server version.
  await page.getByRole('button', { name: /load|reload|use the saved|server/i }).first().click();
  await expect(budgetField(page)).toHaveValue('200.00');
  await expect(status(page)).toContainText(/saved/i);
  await other.context().close();
});

test('a failed save (network down) shows offline, keeps the edit, and retries when the network returns', async ({ signedIn: page }) => {
  await go(page, 'repayment');
  await page.route('**/api/plan', route => route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue());
  await retype(page, budgetField(page), '818');
  await expect(status(page)).toContainText(/offline|not saved|can't reach|couldn't save|retry/i);
  await expect(status(page)).not.toContainText(/^saved/i);
  await expect(budgetField(page)).toHaveValue('818.00');
  expect((await serverBudget(page))?.monthlyDebtBudget).not.toBe('818.00');
  await page.unroute('**/api/plan');
  const retry = page.getByRole('button', { name: /retry|try again/i });
  if (await retry.isVisible()) await retry.click();
  await expect(status(page)).toContainText(/saved/i, { timeout: 30_000 });
  await expect.poll(async () => (await serverBudget(page))?.monthlyDebtBudget).toBe('818.00');
});

test('a server error is reported as an error, not as saved', async ({ signedIn: page }) => {
  await go(page, 'repayment');
  await page.route('**/api/plan', route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server"}' }) : route.continue());
  await retype(page, budgetField(page), '919');
  await expect(status(page)).toContainText(/error|not saved|couldn't save|try again/i);
  await page.unroute('**/api/plan');
  const retry = page.getByRole('button', { name: /retry|try again/i });
  if (await retry.isVisible()) await retry.click();
  await expect.poll(async () => (await serverBudget(page))?.monthlyDebtBudget, { timeout: 30_000 }).toBe('919.00');
});

test('leaving with unsaved changes asks before closing', async ({ signedIn: page }) => {
  await go(page, 'repayment');
  await page.route('**/api/plan', route => route.request().method() === 'PUT' ? new Promise(() => {}) : route.continue());
  await retype(page, budgetField(page), '123');
  let prompted = false;
  page.on('dialog', dialog => { prompted = dialog.type() === 'beforeunload'; void dialog.dismiss(); });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => prompted).toBe(true);
});

test('expired session while editing: the user is asked to sign in again and nothing is lost silently', async ({ signedIn: page }) => {
  await go(page, 'repayment');
  await page.context().clearCookies();
  await retype(page, budgetField(page), '246');
  await expect(page.locator('body')).toContainText(/sign in again|session ended|signed out/i);
});

test('Delete all my data removes the account plan; signing in again starts fresh', async ({ signedIn: page, user }) => {
  await seedPlan(page, plan => { plan.postGradIncome.monthlyDebtBudget = '345.67'; });
  await go(page, 'data');
  await page.getByRole('button', { name: 'Delete all my data' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText(/server|account/i);
  await expect(dialog).toContainText(/backup/i);
  await dialog.getByRole('button', { name: /^Delete/ }).click();
  await expect(page.locator('[data-notice="deleted"]')).toBeVisible();
  expect((await page.request.get('/api/plan')).status()).toBe(401);
  expect(await page.evaluate(() => Object.values(localStorage).join(''))).not.toContain('345.67');
  await openPlanner(page, user);
  expect(JSON.stringify(await getPlan(page.request))).not.toContain('345.67');
});

test('API seeding helpers and the save revision agree (sanity check for the other specs)', async ({ signedIn: page }) => {
  const first = await seedPlan(page, plan => { plan.postGradIncome.monthlyDebtBudget = '111.00'; }, { reload: false });
  const second = await putPlan(page.request, (await getPlan(page.request)).document);
  expect(second).toBe(first + 1);
  const stale = await page.request.put('/api/plan', { headers: CSRF, data: { baseRevision: first, envelope: { app: 'debtnav', schemaVersion: 4, savedAt: '', document: (await getPlan(page.request)).document } } });
  expect(stale.status()).toBe(409);
  expect(new URL(page.url()).origin).toBe(APP_ORIGIN);
});
