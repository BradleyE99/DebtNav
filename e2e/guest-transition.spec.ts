/**
 * Independent tester — Guest-to-account transition and account saving (optional Google sign-in). Sign-in goes
 * through the real redirect flow against the mock issuer's chooser. Guest work must survive cancel/failure,
 * nothing is uploaded until the user chooses, an existing account plan is never silently overwritten, and
 * signed-in saving / recovery / offline / failure states are truthful.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect, getPlan, openPlanner, seedPlan, loginAs, emailOf, APP_ORIGIN, CSRF, envelope } from './support/fixtures';
import { createDefaultPlan } from '../src/engine/planner';
import {
  GUEST_SAVED_TEXT, status, budgetField, retype, openGuest, tab, setBudget, guestDraft, recordApi, beginSignIn,
  chooseAccount, serverBudget, dismissDisclaimer, noHorizontalOverflow, STORAGE_DISABLED, storageDump,
} from './support/guest';

const GUEST = '487.31';
const ACCOUNT = '555.55';

const saveToAccount = (page: Page) => page.getByRole('button', { name: 'Save this plan to my account' });
const notNow = (page: Page) => page.getByRole('button', { name: /^Not now/ });
const openAccountPlan = (page: Page) => page.getByRole('button', { name: 'Open my account plan' });
const replaceAccountPlan = (page: Page) => page.getByRole('button', { name: /^Replace my account plan with this browser/ });

/** Server plan as seen by a fresh API context signed in as `user` (independent of the page under test). */
async function accountPlanOf(page: Page, user: string) {
  const context = await page.context().browser()!.newContext({ baseURL: APP_ORIGIN });
  const other = await context.newPage();
  await loginAs(other, user);
  const plan = await getPlan(other.request);
  await context.close();
  return plan;
}

/** Creates an account plan for `user` (budget ACCOUNT plus a distinctive loan) without touching `page`'s browser. */
async function seedExistingAccount(page: Page, user: string): Promise<number> {
  const context = await page.context().browser()!.newContext({ baseURL: APP_ORIGIN });
  const other = await context.newPage();
  await loginAs(other, user);
  const plan = createDefaultPlan();
  plan.postGradIncome.monthlyDebtBudget = ACCOUNT;
  plan.loans = [{ id: 'acct1', name: 'Account-only loan', type: 'unsubsidized', principal: '7654.32', annualRate: '0.0653', disbursementDate: plan.settings.startDate, termMonths: 120 }] as typeof plan.loans;
  // The app in that context may auto-create the first account plan meanwhile: write on top of whatever revision exists.
  let revision = 0;
  for (let attempt = 0; attempt < 5 && !revision; attempt++) {
    const current = await getPlan(other.request);
    const response = await other.request.put('/api/plan', { headers: CSRF, data: { baseRevision: current.revision, envelope: envelope({ plan, disclaimerDismissed: true }) } });
    if (response.status() === 409) { await other.waitForTimeout(300); continue; }
    expect(response.status(), await response.text()).toBe(200);
    revision = (await response.json()).revision as number;
  }
  expect(revision, 'seeded the existing account plan').toBeGreaterThan(0);
  await other.goto('about:blank');
  await context.close();
  return revision;
}

async function guestWithBudget(page: Page, value = GUEST) {
  await openGuest(page);
  await setBudget(page, value);
  await expect(status(page)).toContainText(GUEST_SAVED_TEXT);
  await expect.poll(() => guestDraft(page)).toContain(value);
}

test.describe('sign-in preserves guest work', () => {
  test('cancelling at Google returns to the untouched guest plan with a truthful notice', async ({ page }) => {
    const traffic = recordApi(page);
    await guestWithBudget(page);
    const before = await guestDraft(page);
    await beginSignIn(page);
    await chooseAccount(page, 'cancel');
    await expect(page.locator('[data-notice="cancelled"]')).toContainText('Your plan on this browser was not changed.');
    await dismissDisclaimer(page);
    await tab(page, 'results');
    await expect(budgetField(page)).toHaveValue(GUEST);
    expect(await guestDraft(page)).toBe(before);
    expect((await page.request.get('/api/me')).status()).toBe(401);
    expect(traffic.filter(r => r.path.startsWith('/api/plan') || r.body.includes(GUEST))).toEqual([]);
  });

  test('an authentication failure returns to the untouched guest plan', async ({ page }) => {
    await guestWithBudget(page);
    const before = await guestDraft(page);
    await beginSignIn(page);
    await chooseAccount(page, '__fail__');
    await expect(page.locator('[data-notice="failed"]')).toContainText('Your plan on this browser was not changed.');
    await dismissDisclaimer(page);
    await tab(page, 'results');
    await expect(budgetField(page)).toHaveValue(GUEST);
    expect(await guestDraft(page)).toBe(before);
    expect((await page.request.get('/api/me')).status()).toBe(401);
  });

  test('when the guest plan cannot be stored, sign-in warns first and Cancel keeps the in-memory plan', async ({ page }) => {
    await page.addInitScript(STORAGE_DISABLED);
    await openGuest(page);
    await setBudget(page, GUEST);
    await tab(page, 'overview');
    await page.getByRole('button', { name: /Sign in with Google to save across devices/ }).first().click();
    const warning = page.getByRole('alertdialog').filter({ hasText: /isn.t saved on this browser/ });
    await expect(warning).toBeVisible();
    await expect(warning.getByRole('button', { name: 'Export plan' })).toBeVisible();
    await expect(warning.getByRole('button', { name: 'Sign in anyway' })).toBeVisible();
    await warning.getByRole('button', { name: 'Cancel' }).click();
    await expect(warning).toBeHidden();
    expect(new URL(page.url()).origin).toBe(APP_ORIGIN);
    await tab(page, 'results');
    await expect(budgetField(page)).toHaveValue(GUEST);
  });
});

test.describe('after sign-in the user decides; nothing is uploaded just because authentication succeeded', () => {
  test('new account: no upload before the choice; "Not now" keeps the guest plan on this browser only', async ({ page, user }) => {
    const traffic = recordApi(page);
    await guestWithBudget(page);
    await beginSignIn(page);
    await chooseAccount(page, user);
    await expect(saveToAccount(page)).toBeVisible({ timeout: 20_000 });
    await expect(notNow(page)).toBeVisible();
    // Authenticated, but nothing has been written to the account yet.
    const pending = await getPlan(page.request);
    expect(JSON.stringify(pending)).not.toContain(GUEST);
    expect(traffic.filter(r => r.method === 'PUT' && r.path === '/api/plan')).toEqual([]);
    await notNow(page).click();
    await dismissDisclaimer(page);
    await expect(page.locator('.account-menu__email')).toContainText(emailOf(user));
    // Let any debounced save land, then confirm the guest value never reached the account.
    await page.waitForTimeout(1500);
    expect(JSON.stringify(await getPlan(page.request))).not.toContain(GUEST);
    expect(traffic.filter(r => r.body.includes(GUEST))).toEqual([]);
    expect(await guestDraft(page)).toContain(GUEST);
    // The choice is remembered for this account: no repeated prompt on reload.
    await page.reload();
    await dismissDisclaimer(page);
    await expect(saveToAccount(page)).toHaveCount(0);
    await expect(openAccountPlan(page)).toHaveCount(0);
  });

  test('new account: "Save this plan to my account" uploads it once, then removes the browser copy', async ({ page, user }) => {
    await guestWithBudget(page);
    await beginSignIn(page);
    await chooseAccount(page, user);
    await saveToAccount(page).click();
    await expect.poll(() => serverBudget(page), { timeout: 20_000 }).toBe(GUEST);
    await dismissDisclaimer(page);
    await tab(page, 'results');
    await expect(budgetField(page)).toHaveValue(GUEST);
    await expect(status(page)).toContainText(/Saved to your account/);
    await expect.poll(async () => (await guestDraft(page)) ?? '').not.toContain(GUEST);
    // Another device signed in as this user recovers the plan.
    const other = await accountPlanOf(page, user);
    expect(other.document?.plan).toMatchObject({ postGradIncome: { monthlyDebtBudget: GUEST } });
  });

  test('existing account plan: "Open my account plan" shows it and changes neither plan', async ({ page, user }) => {
    const revision = await seedExistingAccount(page, user);
    const traffic = recordApi(page);
    await guestWithBudget(page);
    await beginSignIn(page);
    await chooseAccount(page, user);
    await expect(openAccountPlan(page)).toBeVisible({ timeout: 20_000 });
    await expect(replaceAccountPlan(page)).toBeVisible();
    await expect(saveToAccount(page)).toHaveCount(0);
    // Keyboard: the safe choice is reachable and activates with Enter.
    await openAccountPlan(page).focus();
    await page.keyboard.press('Enter');
    await dismissDisclaimer(page);
    await tab(page, 'results');
    await expect(budgetField(page)).toHaveValue(ACCOUNT);
    await tab(page, 'loans');
    await expect(page.locator('body')).toContainText('Account-only loan');
    const after = await getPlan(page.request);
    expect(after.document?.plan).toMatchObject({ postGradIncome: { monthlyDebtBudget: ACCOUNT } });
    expect(after.revision).toBeGreaterThanOrEqual(revision);
    expect(traffic.filter(r => r.body.includes(GUEST))).toEqual([]);
    expect(await guestDraft(page)).toContain(GUEST);
  });

  test('existing account plan: replacing requires explicit confirmation and never merges', async ({ page, user }) => {
    const revision = await seedExistingAccount(page, user);
    await guestWithBudget(page);
    await beginSignIn(page);
    await chooseAccount(page, user);
    await replaceAccountPlan(page).click();
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog').filter({ hasText: 'Replace your account plan?' })).first();
    await expect(confirm).toContainText('Replace your account plan?');
    await expect(confirm).toContainText(/nothing is merged/i);
    // Backing out leaves the account plan untouched.
    await confirm.getByRole('button', { name: /Cancel|Back|Keep/ }).first().click();
    const untouched = await getPlan(page.request);
    expect(untouched.revision).toBe(revision);
    expect(untouched.document?.plan).toMatchObject({ postGradIncome: { monthlyDebtBudget: ACCOUNT } });
    // Confirm for real.
    await replaceAccountPlan(page).click();
    await page.getByRole('button', { name: 'Replace account plan' }).click();
    await expect.poll(() => serverBudget(page), { timeout: 20_000 }).toBe(GUEST);
    const replaced = await getPlan(page.request);
    expect(replaced.revision).toBe(revision + 1);
    expect(JSON.stringify(replaced.document)).not.toContain('Account-only loan');
    expect(JSON.stringify(replaced.document)).not.toContain('7654.32');
    await dismissDisclaimer(page);
    await tab(page, 'loans');
    await expect(page.locator('body')).not.toContainText('Account-only loan');
  });

  test('replace with a stale revision (account changed on another device meanwhile) does not overwrite', async ({ page, user }) => {
    await seedExistingAccount(page, user);
    await guestWithBudget(page);
    await beginSignIn(page);
    await chooseAccount(page, user);
    await expect(replaceAccountPlan(page)).toBeVisible({ timeout: 20_000 });
    // Another device saves a newer account plan while the choice is open.
    const current = await getPlan(page.request);
    const newer = structuredClone(current.document)!;
    (newer.plan as { postGradIncome: { monthlyDebtBudget: string } }).postGradIncome.monthlyDebtBudget = '666.66';
    const put = await page.request.put('/api/plan', { headers: CSRF, data: { baseRevision: current.revision, envelope: envelope(newer) } });
    expect(put.status()).toBe(200);
    await replaceAccountPlan(page).click();
    await page.getByRole('button', { name: 'Replace account plan' }).click();
    await page.waitForTimeout(2500);
    // The newer plan from the other device is never silently overwritten.
    expect(await serverBudget(page)).toBe('666.66');
    await expect(page.locator('body')).toContainText(/conflict|changed|newer|another device|nothing was replaced/i);
    expect(await guestDraft(page)).toContain(GUEST);
  });

  test('the choice dialog is accessible and fits a 360px screen @narrow', async ({ page, user }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await seedExistingAccount(page, user);
    await guestWithBudget(page);
    await beginSignIn(page);
    await chooseAccount(page, user);
    await expect(openAccountPlan(page)).toBeVisible({ timeout: 20_000 });
    await expect(openAccountPlan(page)).toBeInViewport();
    await noHorizontalOverflow(page);
    const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(audit.violations.map(v => v.id)).toEqual([]);
    await replaceAccountPlan(page).scrollIntoViewIfNeeded();
    await replaceAccountPlan(page).click();
    await expect(page.getByRole('button', { name: 'Replace account plan' })).toBeInViewport();
    await noHorizontalOverflow(page);
    await page.keyboard.press('Escape');
    expect(await serverBudget(page)).toBe(ACCOUNT);
  });
});

test.describe('signed-in saving', () => {
  test('saves to the account, recovers on another device, and labels cloud saving distinctly', async ({ signedIn: page, user }) => {
    await setBudget(page, '515');
    await expect(status(page)).toContainText('Saved to your account.');
    await expect(page.locator('body')).not.toContainText(GUEST_SAVED_TEXT);
    await expect.poll(() => serverBudget(page)).toBe('515.00');
    // Account edits are not written to the guest plan key.
    expect(await guestDraft(page) ?? '').not.toContain('515.00');
    // Returning user on a new device.
    const other = await accountPlanOf(page, user);
    expect(other.document?.plan).toMatchObject({ postGradIncome: { monthlyDebtBudget: '515.00' } });
    const context = await page.context().browser()!.newContext({ baseURL: APP_ORIGIN });
    const device = await context.newPage();
    await openPlanner(device, user);
    await tab(device, 'results');
    await expect(budgetField(device)).toHaveValue('515.00');
    await context.close();
  });

  test('offline: edits stay, status says not saved, then saves when back online', async ({ signedIn: page }) => {
    await tab(page, 'results');
    await page.context().setOffline(true);
    await retype(page, budgetField(page), '818');
    await expect(status(page)).toContainText(/offline|not saved|can.t reach|couldn.t save/i);
    await expect(status(page)).not.toContainText('Saved to your account.');
    await expect(budgetField(page)).toHaveValue('818.00');
    // The planner still calculates while offline.
    await expect(page.getByTestId('headline-debt-free')).toBeVisible();
    await page.context().setOffline(false);
    const retry = page.getByRole('button', { name: /retry|try again/i });
    if (await retry.isVisible()) await retry.click();
    await expect(status(page)).toContainText('Saved to your account.', { timeout: 30_000 });
    await expect.poll(() => serverBudget(page)).toBe('818.00');
  });

  test('server failure: edits stay, status is truthful, retry saves', async ({ signedIn: page }) => {
    await tab(page, 'results');
    await page.route('**/api/plan', route => route.request().method() === 'PUT'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server"}' }) : route.continue());
    await retype(page, budgetField(page), '919');
    await expect(status(page)).toContainText(/error|not saved|couldn.t save|try again/i);
    await expect(status(page)).not.toContainText('Saved to your account.');
    await expect(budgetField(page)).toHaveValue('919.00');
    expect(await serverBudget(page)).not.toBe('919.00');
    await page.unroute('**/api/plan');
    const retry = page.getByRole('button', { name: /retry|try again/i });
    if (await retry.isVisible()) await retry.click();
    await expect.poll(() => serverBudget(page), { timeout: 30_000 }).toBe('919.00');
  });

  test('an account plan load failure does not block planning: "Use this browser\'s plan for now" switches to guest mode', async ({ page, user }) => {
    await openPlanner(page, user);
    await seedPlan(page, plan => { plan.postGradIncome.monthlyDebtBudget = ACCOUNT; }, { reload: false });
    await page.route('**/api/plan', route => route.request().method() === 'GET'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server"}' }) : route.continue());
    await page.reload();
    const useBrowser = page.getByRole('button', { name: /Use this browser.s plan for now/ });
    await expect(useBrowser).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /Retry|Try again/ }).first()).toBeVisible();
    await useBrowser.click();
    await dismissDisclaimer(page);
    await tab(page, 'results');
    await expect(budgetField(page)).not.toHaveValue(ACCOUNT);
    await retype(page, budgetField(page), '135');
    await expect(budgetField(page)).toHaveValue('135.00');
    expect(await storageDump(page)).not.toContain(ACCOUNT);
  });
});
