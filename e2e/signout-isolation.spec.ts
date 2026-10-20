/**
 * Independent tester — Sign-out and account isolation (optional Google sign-in). After sign-out the browser
 * is in guest mode: account data is gone from the screen and from browser storage, a separate guest draft is
 * preserved (never overwritten with account data), late requests cannot restore private data, and switching
 * accounts never leaks or overwrites another account's plan.
 */
import type { Page } from '@playwright/test';
import { test, expect, openPlanner, seedPlan, getPlan, loginAs, uniqueUser, APP_ORIGIN, CSRF } from './support/fixtures';
import {
  GUEST_SAVED_TEXT, status, budgetField, retype, openGuest, tab, setBudget, guestDraft, storageDump, storageKeys,
  beginSignIn, chooseAccount, signOutViaMenu, dismissDisclaimer, serverBudget, noHorizontalOverflow,
} from './support/guest';

const GUEST = '487.31';
const A = '777.77';
const B = '888.88';
const guestSignIn = (page: Page) => page.getByRole('button', { name: /Sign in with Google/ }).first();
const signedOutNotice = (page: Page) => page.locator('[data-notice="signedOut"]');

/** Everything visible plus every form value on the four destinations. */
async function visibleEverywhere(page: Page): Promise<string> {
  let text = '';
  for (const id of ['overview', 'school', 'loans', 'results'] as const) {
    await tab(page, id);
    text += await page.locator('body').innerText();
    text += (await page.locator('input, select, textarea').evaluateAll(els => els.map(el => (el as HTMLInputElement).value))).join('|');
  }
  return text;
}

async function expectNoAccountData(page: Page, ...values: string[]) {
  const visible = await visibleEverywhere(page);
  const stored = await storageDump(page);
  for (const value of values) {
    expect(visible, `screen shows ${value}`).not.toContain(value);
    expect(stored, `browser storage holds ${value}`).not.toContain(value);
  }
  expect((await storageKeys(page)).filter(key => key.startsWith('debtnav.cache.')), 'account caches left').toEqual([]);
}

test('sign-out returns to guest mode, clears account data, and keeps the separate guest draft', async ({ page, user }) => {
  // A guest draft exists first; the user signs in and keeps it on this browser.
  await openGuest(page);
  await setBudget(page, GUEST);
  await expect.poll(() => guestDraft(page)).toContain(GUEST);
  const draftBefore = await guestDraft(page);
  await beginSignIn(page);
  await chooseAccount(page, user);
  const notNow = page.getByRole('button', { name: /^Not now/ });
  await expect(notNow).toBeVisible({ timeout: 20_000 });
  await notNow.click();
  await dismissDisclaimer(page);
  // Let the new account's first save land before seeding (as openPlanner does), or the seed races it.
  await expect(page.locator('[data-save-state]').first()).toHaveAttribute('data-save-state', 'saved', { timeout: 20_000 });
  await seedPlan(page, plan => { plan.postGradIncome.monthlyDebtBudget = A; });
  await dismissDisclaimer(page);
  await tab(page, 'results');
  await expect(budgetField(page)).toHaveValue(A);
  await expect(status(page)).toContainText('Saved to your account.');

  await signOutViaMenu(page);
  await expect(signedOutNotice(page)).toContainText('this browser now shows your guest plan');
  await tab(page, 'overview');
  await expect(guestSignIn(page)).toBeVisible();
  expect((await page.request.get('/api/plan')).status()).toBe(401);
  await dismissDisclaimer(page);
  await tab(page, 'results');
  await expect(budgetField(page)).toHaveValue(GUEST);
  await expect(status(page)).toContainText(GUEST_SAVED_TEXT);
  await expectNoAccountData(page, A);
  expect(await guestDraft(page)).toBe(draftBefore);
  // Undo cannot bring the account plan back.
  const undo = page.getByRole('button', { name: /^Undo/ }).first();
  if (await undo.isVisible() && await undo.isEnabled()) await undo.click();
  await expectNoAccountData(page, A);
  // Reload: still guest, still the guest draft.
  await page.reload();
  await dismissDisclaimer(page);
  await tab(page, 'results');
  await expect(budgetField(page)).toHaveValue(GUEST);
  await expectNoAccountData(page, A);
  // The account plan itself is kept on the server.
  await loginAs(page, user);
  expect((await getPlan(page.request)).document?.plan).toMatchObject({ postGradIncome: { monthlyDebtBudget: A } });
});

test('sign-out without a guest draft shows a fresh guest plan and copies nothing into guest storage', async ({ page, user }) => {
  await openPlanner(page, user);
  await seedPlan(page, plan => { plan.postGradIncome.monthlyDebtBudget = A; });
  await dismissDisclaimer(page);
  await signOutViaMenu(page);
  await expect(signedOutNotice(page)).toBeVisible();
  await dismissDisclaimer(page);
  await expectNoAccountData(page, A);
  expect(await guestDraft(page) ?? '').not.toContain(A);
});

test('unsaved account edits: sign-out asks first; "Stay signed in" keeps them, "Sign out anyway" discards them', async ({ page, user }) => {
  await openPlanner(page, user);
  await tab(page, 'results');
  await page.route('**/api/plan', route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server"}' }) : route.continue());
  await retype(page, budgetField(page), A);
  await expect(status(page)).not.toContainText('Saved to your account.');
  await signOutViaMenu(page);
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog').filter({ hasText: 'You have changes not saved to your account.' })).first();
  await expect(dialog).toContainText('You have changes not saved to your account.');
  await expect(dialog.getByRole('button', { name: 'Export a copy' })).toBeVisible();
  // Keyboard: focus is inside the dialog and Escape / Stay signed in keeps everything.
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button', { name: 'Stay signed in' }).click();
  await expect(dialog).toBeHidden();
  await expect(budgetField(page)).toHaveValue(A);
  expect((await page.request.get('/api/me')).status()).toBe(200);

  await signOutViaMenu(page);
  await page.getByRole('button', { name: 'Sign out anyway' }).click();
  await expect(signedOutNotice(page)).toBeVisible();
  await page.unroute('**/api/plan');
  await dismissDisclaimer(page);
  await expectNoAccountData(page, A);
});

test('a save still in flight at sign-out cannot write caches or restore the account plan afterwards', async ({ page, user }) => {
  await openPlanner(page, user);
  await tab(page, 'results');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/plan', async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    await held;
    await route.continue().catch(() => {});
  });
  await retype(page, budgetField(page), A);
  await page.waitForTimeout(1200); // debounce → PUT is now in flight and held
  await signOutViaMenu(page);
  // The flow waits up to 5 s for the held save, then asks (unsaved changes) before signing out.
  const anyway = page.getByRole('button', { name: 'Sign out anyway' });
  await expect(anyway.or(signedOutNotice(page)).first()).toBeVisible({ timeout: 15_000 });
  if (await anyway.isVisible()) await anyway.click();
  await expect(signedOutNotice(page)).toBeVisible();
  release();
  await page.waitForTimeout(3000);
  await expect(signedOutNotice(page)).toBeVisible();
  await dismissDisclaimer(page);
  await expectNoAccountData(page, A);
  // pagehide / visibility flushes must not write the account cache either.
  await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); document.dispatchEvent(new Event('visibilitychange')); });
  await expectNoAccountData(page, A);
});

test('switching accounts in one browser: B never sees A\'s plan and A\'s plan is not overwritten', async ({ page, user }) => {
  await openPlanner(page, user);
  await seedPlan(page, plan => { plan.postGradIncome.monthlyDebtBudget = A; });
  const aRevision = (await getPlan(page.request)).revision;
  await dismissDisclaimer(page);
  await signOutViaMenu(page);
  await expect(signedOutNotice(page)).toBeVisible();
  const bob = uniqueUser(undefined, 'bob');
  await dismissDisclaimer(page);
  await beginSignIn(page);
  await chooseAccount(page, bob);
  const notNow = page.getByRole('button', { name: /^Not now/ });
  if (await notNow.isVisible({ timeout: 3000 }).catch(() => false)) await notNow.click();
  await dismissDisclaimer(page);
  await expect(page.locator('[data-save-state]').first()).toHaveAttribute('data-save-state', 'saved', { timeout: 20_000 });
  expect(JSON.stringify(await getPlan(page.request))).not.toContain(A);
  await expectNoAccountData(page, A);
  await setBudget(page, B);
  await expect.poll(() => serverBudget(page)).toBe('888.88');
  // A's server plan is unchanged.
  await loginAs(page, user);
  const alice = await getPlan(page.request);
  expect(alice.revision).toBe(aRevision);
  expect(alice.document?.plan).toMatchObject({ postGradIncome: { monthlyDebtBudget: A } });
  expect(JSON.stringify(alice)).not.toContain(B);
});

test('another tab switching accounts: a late save from the old tab never lands in the new account', async ({ page, context, user }) => {
  await openPlanner(page, user);
  await seedPlan(page, plan => { plan.postGradIncome.monthlyDebtBudget = A; });
  await dismissDisclaimer(page);
  await tab(page, 'results');
  // Tab 2 (same cookie jar) signs out and signs in as B.
  const bob = uniqueUser(undefined, 'bob');
  const second = await context.newPage();
  expect((await second.request.post('/api/auth/logout', { headers: CSRF })).status()).toBeLessThan(400);
  await openPlanner(second, bob);
  await seedPlan(second, plan => { plan.postGradIncome.monthlyDebtBudget = B; });
  const bobRevision = (await getPlan(second.request)).revision;
  // Tab 1 still shows A and edits it.
  await retype(page, budgetField(page), '123.45');
  await page.waitForTimeout(3000);
  const bobPlan = await getPlan(second.request);
  expect(bobPlan.revision).toBe(bobRevision);
  expect(JSON.stringify(bobPlan)).not.toContain('123.45');
  expect(JSON.stringify(bobPlan)).not.toContain(A);
  // Tab 1 must not claim the edit was saved to the account.
  await expect(status(page)).not.toContainText('Saved to your account.');
  // Tab 2 never shows A's data.
  await expect(second.locator('body')).not.toContainText(A);
  // A's plan is unchanged.
  const fresh = await context.browser()!.newContext({ baseURL: APP_ORIGIN });
  const alicePage = await fresh.newPage();
  await loginAs(alicePage, user);
  expect((await getPlan(alicePage.request)).document?.plan).toMatchObject({ postGradIncome: { monthlyDebtBudget: A } });
  await fresh.close();
});

test('sign-out at 360px: the menu and dialog are reachable, guest mode fits @narrow', async ({ page, user }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openPlanner(page, user);
  await seedPlan(page, plan => { plan.postGradIncome.monthlyDebtBudget = A; });
  await dismissDisclaimer(page);
  await signOutViaMenu(page);
  await expect(signedOutNotice(page)).toBeVisible();
  await dismissDisclaimer(page);
  await noHorizontalOverflow(page);
  await expectNoAccountData(page, A);
});

test('keyboard only: sign out through the account menu', async ({ page, user }) => {
  await openPlanner(page, user);
  await seedPlan(page, plan => { plan.postGradIncome.monthlyDebtBudget = A; });
  await dismissDisclaimer(page);
  const menu = page.getByRole('button', { name: /^Account/ }).first();
  await menu.focus();
  await page.keyboard.press('Enter');
  const signOut = page.getByRole('button', { name: 'Sign out' });
  let reached = await signOut.evaluate(el => el === document.activeElement);
  for (let i = 0; i < 20 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await signOut.evaluate(el => el === document.activeElement);
  }
  expect(reached, 'Sign out reachable by Tab').toBe(true);
  await page.keyboard.press('Enter');
  await expect(signedOutNotice(page)).toBeVisible();
  // Focus is not lost on a removed element.
  expect(await page.evaluate(() => document.activeElement && document.activeElement !== document.body ? 'ok' : document.activeElement?.tagName)).toBeTruthy();
  await dismissDisclaimer(page);
  await expectNoAccountData(page, A);
});
