/**
 * Independent tester — Guest access (optional Google sign-in). Every test starts in a fresh browser context with
 * no session: the whole planning workflow must work without login, save on this browser when storage works,
 * report storage problems truthfully, support JSON import/export, and never send guest inputs to the server.
 */
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, openPlanner, APP_ORIGIN } from './support/fixtures';
import {
  GUEST_SAVED_TEXT, UNAVAILABLE_TEXT, QUOTA_TEXT, status, budgetField, salaryField, startPlanning, guestSignIn, retype,
  openGuest, tab, openYourData, setBudget, guestDraft, recordApi, persistenceRequests, noHorizontalOverflow,
  STORAGE_DISABLED, QUOTA_SWITCH, dismissDisclaimer,
} from './support/guest';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SENTINEL_BUDGET = '487.31';
const SENTINEL_SALARY = '61234';

test('a fresh visitor completes the whole planning workflow without signing in, and nothing is sent to the server', async ({ page }) => {
  const traffic = recordApi(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  // Guest-friendly introduction: Start planning is the primary action, Google sign-in is secondary.
  await expect(page.locator('body')).not.toContainText('Sign in to create your plan');
  // The first-run disclaimer must describe guest storage truthfully (nothing is sent to the server).
  await expect(page.getByRole('button', { name: 'I understand' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.disclaimer')).not.toContainText(/sent only to DebtNav's server|saves it to your account/);
  await dismissDisclaimer(page);
  await tab(page, 'overview');
  await expect(startPlanning(page)).toBeVisible();
  await expect(guestSignIn(page)).toBeVisible();
  await expect(startPlanning(page)).toHaveClass(/primary/);
  await expect(guestSignIn(page)).not.toHaveClass(/button-primary/);
  await startPlanning(page).click();
  await expect(page.locator('.dashboard')).not.toHaveAttribute('data-dashboard', 'overview');

  // College Costs: add a cost and a grant.
  await tab(page, 'school');
  await page.getByRole('button', { name: 'Add cost to Year 1' }).click();
  await retype(page, page.locator('input[id*=".costItems."][id$=".amount"]').first(), '10000');
  await page.getByRole('button', { name: 'Add grant or savings to Year 1' }).click();
  await retype(page, page.locator('input[id*=".resources."][id$=".amount"]').first(), '2000');
  await expect(page.locator('.gap-main dd')).toHaveText('$8,000.00');
  // Loan Amounts: create the loan from the gap.
  await page.getByRole('button', { name: /^Create loan for \$8,000\.00/ }).click();
  await expect(page.locator('.dashboard')).toHaveAttribute('data-dashboard', 'loans');
  await expect(page.locator('input[id$=".principal"]').first()).toHaveValue('8,000.00');
  await expect(page.locator('article.loan-card').first()).toContainText('Academic year 2026–2027');
  // Results: payment and salary, headline results.
  await tab(page, 'results');
  await retype(page, budgetField(page), SENTINEL_BUDGET);
  await retype(page, salaryField(page), SENTINEL_SALARY);
  await expect(page.getByTestId('headline-debt-free')).toHaveText(/^[A-Z][a-z]{2} \d{4}/);
  await expect(page.getByTestId('headline-interest')).toHaveText(/\$/);
  await expect(status(page)).toContainText(GUEST_SAVED_TEXT);
  await expect(page.locator('body')).not.toContainText(/Saved to your account/);

  // No plan/workbook/account request at all; no request body or URL carries a guest input.
  expect(persistenceRequests(traffic), JSON.stringify(persistenceRequests(traffic))).toEqual([]);
  for (const request of traffic) {
    expect(request.url + request.body).not.toContain(SENTINEL_BUDGET);
    expect(request.url + request.body).not.toContain('61234');
    expect(request.url + request.body).not.toContain('10000');
  }
  expect((await page.request.get('/api/plan')).status()).toBe(401);
  expect(errors).toEqual([]);
});

test('guest edits survive a reload when browser storage works', async ({ page }) => {
  await openGuest(page);
  await setBudget(page, SENTINEL_BUDGET);
  await expect(status(page)).toContainText(GUEST_SAVED_TEXT);
  await expect.poll(() => guestDraft(page)).toContain(SENTINEL_BUDGET);
  await page.reload();
  await dismissDisclaimer(page);
  await tab(page, 'results');
  await expect(budgetField(page)).toHaveValue(SENTINEL_BUDGET);
  await expect(status(page)).toContainText(GUEST_SAVED_TEXT);
  // A second tab in the same browser opens the same guest plan.
  const other = await page.context().newPage();
  await openGuest(other, '#results');
  await tab(other, 'results');
  await expect(budgetField(other)).toHaveValue(SENTINEL_BUDGET);
});

test('unavailable storage: the planner still works and says changes are not saved', async ({ page }) => {
  await page.addInitScript(STORAGE_DISABLED);
  await openGuest(page);
  await expect(page.locator('body')).toContainText(UNAVAILABLE_TEXT);
  await setBudget(page, SENTINEL_BUDGET);
  await expect(budgetField(page)).toHaveValue(SENTINEL_BUDGET);
  await expect(page.getByTestId('headline-debt-free')).toBeVisible();
  // Never claims a save that did not happen.
  await expect(page.locator('body')).not.toContainText(GUEST_SAVED_TEXT);
  await expect(status(page)).not.toContainText(/^\s*Saved/);
  // The not-configured / sign-in notices (if shown) must not claim browser saving either.
  await expect(page.locator('body')).not.toContainText(/saved on this browser only/i);
});

test('a storage quota failure keeps the edit and reports that it was not saved', async ({ page }) => {
  await page.addInitScript(QUOTA_SWITCH);
  await openGuest(page);
  await setBudget(page, '111');
  await expect(status(page)).toContainText(GUEST_SAVED_TEXT);
  await page.evaluate(() => { (window as unknown as { __quotaFull: boolean }).__quotaFull = true; });
  await retype(page, budgetField(page), SENTINEL_BUDGET);
  await expect(status(page)).toContainText(QUOTA_TEXT);
  await expect(page.locator('body')).not.toContainText(GUEST_SAVED_TEXT);
  await expect(budgetField(page)).toHaveValue(SENTINEL_BUDGET);
  expect(await guestDraft(page)).not.toContain(SENTINEL_BUDGET);
  // Storage recovers: the next edit is saved and the status becomes truthful again.
  await page.evaluate(() => { (window as unknown as { __quotaFull: boolean }).__quotaFull = false; });
  await retype(page, budgetField(page), '512');
  await expect(status(page)).toContainText(GUEST_SAVED_TEXT);
  await expect.poll(() => guestDraft(page)).toContain('512.00');
});

test('guests can export and import JSON plans; Excel needs an account and never uploads', async ({ page }) => {
  const traffic = recordApi(page);
  await openGuest(page);
  await setBudget(page, SENTINEL_BUDGET);
  const data = await openYourData(page);
  const downloadPromise = page.waitForEvent('download');
  await data.getByRole('button', { name: 'Export plan (JSON)' }).click();
  const exported = readFileSync((await (await downloadPromise).path())!, 'utf8');
  expect(JSON.parse(exported)).toMatchObject({ app: 'debtnav', schemaVersion: 4 });
  expect(exported).toContain(SENTINEL_BUDGET);
  await expect(data).toContainText(/needs an account|sign in/i);
  await setBudget(page, '700');
  const again = await openYourData(page);
  await again.getByLabel('Import plan (JSON)').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await expect(again).toContainText('Import failed; your current plan is unchanged.');
  await again.getByLabel('Import plan (JSON)').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await expect(again).toContainText('Plan imported.');
  await tab(page, 'results');
  await expect(budgetField(page)).toHaveValue(SENTINEL_BUDGET);
  await expect(status(page)).toContainText(GUEST_SAVED_TEXT);
  await expect.poll(() => guestDraft(page)).toContain(SENTINEL_BUDGET);
  expect(persistenceRequests(traffic)).toEqual([]);
});

test('calculations and loan academic years match between guest mode and an account for the same plan', async ({ page, browser, user }) => {
  await openGuest(page);
  await tab(page, 'loans');
  await page.getByRole('button', { name: 'Add loan', exact: true }).click();
  await retype(page, page.locator('input[id$=".principal"]').first(), '12000');
  await page.getByRole('button', { name: 'Add loan', exact: true }).click();
  await retype(page, page.locator('input[id$=".principal"]').nth(1), '5500');
  await expect(page.locator('article.loan-card').first()).toContainText('Academic year 2026–2027');
  await setBudget(page, '300');
  await expect(status(page)).toContainText(GUEST_SAVED_TEXT);
  const data = await openYourData(page);
  const downloadPromise = page.waitForEvent('download');
  await data.getByRole('button', { name: 'Export plan (JSON)' }).click();
  const exported = readFileSync((await (await downloadPromise).path())!, 'utf8');
  // Read the guest headline from a fresh load of the saved plan (no stale render).
  await page.reload();
  await dismissDisclaimer(page);
  await tab(page, 'results');
  await expect(budgetField(page)).toHaveValue('300.00');
  const guest = { interest: await page.getByTestId('headline-interest').innerText(), debtFree: await page.getByTestId('headline-debt-free').innerText() };

  // A separate browser profile signed in to a new account imports the guest's file.
  const accountContext = await browser.newContext({ baseURL: APP_ORIGIN });
  const account = await accountContext.newPage();
  await openPlanner(account, user);
  const accountData = await openYourData(account);
  await accountData.getByLabel('Import plan (JSON)').setInputFiles({ name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await expect(accountData).toContainText('Plan imported.');
  await tab(account, 'results');
  await expect(account.getByTestId('headline-interest')).toHaveText(guest.interest);
  await expect(account.getByTestId('headline-debt-free')).toHaveText(guest.debtFree);
  await tab(account, 'loans');
  await expect(account.locator('article.loan-card').first()).toContainText('Academic year 2026–2027');
  await accountContext.close();
});

test('keyboard only: a guest starts planning and edits a value without a mouse', async ({ page }) => {
  await page.goto('/');
  const understand = page.getByRole('button', { name: 'I understand' });
  await expect(understand.or(page.locator('.dashboard')).first()).toBeVisible({ timeout: 20_000 });
  if (await understand.isVisible()) { await understand.focus(); await page.keyboard.press('Enter'); }
  await expect(page.locator('.dashboard')).toHaveAttribute('data-dashboard', 'overview');
  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await startPlanning(page).evaluate(el => el === document.activeElement);
  }
  expect(reached, 'Start planning is reachable with Tab').toBe(true);
  // The sign-in action is also keyboard reachable (after Start planning in tab order or before it).
  await page.keyboard.press('Enter');
  await expect(page.locator('.dashboard')).not.toHaveAttribute('data-dashboard', 'overview');
  // Move to Results by keyboard through the destination tabs.
  const results = page.getByRole('navigation', { name: 'Planner sections' }).locator('a[href="#results"]');
  await results.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.dashboard')).toHaveAttribute('data-dashboard', 'results');
  await page.evaluate(() => { for (const d of document.querySelectorAll<HTMLDetailsElement>('main details')) d.open = true; });
  await budgetField(page).focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(SENTINEL_BUDGET);
  await page.keyboard.press('Tab');
  await expect(budgetField(page)).toHaveValue(SENTINEL_BUDGET);
  await expect(status(page)).toContainText(GUEST_SAVED_TEXT);
  const focusVisible = await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle !== 'none' || getComputedStyle(document.activeElement as Element).boxShadow !== 'none');
  expect(focusVisible, 'focused control has a visible focus indicator').toBe(true);
});

test('guest introduction has no accessibility violations', async ({ page }) => {
  await openGuest(page);
  await tab(page, 'overview');
  const audit = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(audit.violations.map(v => v.id)).toEqual([]);
});

test('guest planner at 360px: both introduction actions are reachable, no horizontal scroll, status visible @narrow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const traffic = recordApi(page);
  await openGuest(page);
  await tab(page, 'overview');
  await expect(startPlanning(page)).toBeVisible();
  await expect(guestSignIn(page)).toBeVisible();
  await noHorizontalOverflow(page);
  await startPlanning(page).click();
  for (const id of ['school', 'loans', 'results'] as const) {
    await tab(page, id);
    await noHorizontalOverflow(page);
  }
  await retype(page, budgetField(page), SENTINEL_BUDGET);
  await expect(status(page)).toContainText(GUEST_SAVED_TEXT);
  await noHorizontalOverflow(page);
  const audit = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(audit.violations.map(v => v.id)).toEqual([]);
  expect(persistenceRequests(traffic)).toEqual([]);
});
