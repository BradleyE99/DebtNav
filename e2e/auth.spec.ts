/**
 * US-1201 Google sign-in through the real OpenID Connect redirect flow against the mock issuer
 * (e2e/support/mock-oidc.mjs): public Overview, sign-in, cancel, failure, session restoration, sign-out,
 * returnTo, cross-user isolation. Real Google cannot be exercised without credentials (see tester notes).
 */
import AxeBuilder from '@axe-core/playwright';
import { createDefaultPlan } from '../src/engine/planner';
import { test, expect, loginAs, openPlanner, seedPlan, getPlan, uniqueUser, emailOf, ISSUER_ORIGIN, APP_ORIGIN } from './support/fixtures';

const signInButton = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Sign in with Google' });
const axe = (page: import('@playwright/test').Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

test('the public Overview is available without signing in and no plan API is reachable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Plan your student loans' })).toBeVisible();
  await expect(signInButton(page)).toBeVisible();
  expect((await page.request.get('/api/plan')).status()).toBe(401);
  expect((await page.request.get('/api/me')).status()).toBe(401);
  expect((await axe(page)).violations.map(v => v.id)).toEqual([]);
});

test('Sign in with Google goes through the issuer and back into the planner', async ({ page, user }) => {
  await page.goto('/');
  await signInButton(page).click();
  await page.waitForURL(url => url.origin === ISSUER_ORIGIN);
  await page.getByLabel('Test user name').fill(user);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(url => url.origin === APP_ORIGIN && !url.pathname.startsWith('/api/'));
  await expect(page.locator('.account-header__email')).toContainText(emailOf(user));
  const understand = page.getByRole('button', { name: 'I understand' });
  if (await understand.isVisible()) await understand.click();
  await expect(page.locator('.dashboard')).toBeVisible();
  // The session cookie is HttpOnly: scripts cannot read it.
  expect(await page.evaluate(() => document.cookie)).not.toContain('debtnav_session');
});

test('cancelling at Google returns to the public page with a calm message and no session', async ({ page }) => {
  await page.goto('/');
  await signInButton(page).click();
  await page.waitForURL(url => url.origin === ISSUER_ORIGIN);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForURL(url => url.origin === APP_ORIGIN);
  await expect(page.locator('[data-notice="cancelled"]')).toContainText('Sign-in was cancelled.');
  await expect(signInButton(page)).toBeVisible();
  expect((await page.request.get('/api/me')).status()).toBe(401);
});

test('an authentication failure (token exchange rejected) shows an error and no session', async ({ page }) => {
  await page.goto('/api/auth/login?login_hint=__fail__');
  await page.waitForURL(url => url.origin === APP_ORIGIN && !url.pathname.startsWith('/api/'));
  // The app reads ?authError=failed and then removes it from the address bar, so check the notice instead.
  await expect(page.locator('[data-notice="failed"]')).toContainText('Sign-in didn');
  expect(new URL(page.url()).searchParams.get('authError')).toBeNull();
  expect((await page.request.get('/api/me')).status()).toBe(401);
});

test('a tampered callback (wrong state) is rejected', async ({ page }) => {
  await page.goto('/api/auth/callback?code=forged&state=forged');
  await page.waitForURL(url => url.origin === APP_ORIGIN && !url.pathname.startsWith('/api/'));
  await expect(page.locator('[data-notice="failed"]')).toBeVisible();
  expect((await page.request.get('/api/me')).status()).toBe(401);
});

test('an open-redirect returnTo is ignored; a same-site returnTo is honoured', async ({ page, user }) => {
  await page.goto(`/api/auth/login?login_hint=${user}&returnTo=${encodeURIComponent('https://evil.example/')}`);
  await page.waitForURL(url => url.origin === APP_ORIGIN && !url.pathname.startsWith('/api/'));
  expect(new URL(page.url()).origin).toBe(APP_ORIGIN);
  await loginAs(page, user, '/#loans');
  await expect(page).toHaveURL(/#loans$/);
});

test('the session is restored on reload and in a new tab', async ({ page, context, user }) => {
  await openPlanner(page, user);
  await page.reload();
  await expect(page.locator('.account-header__email')).toContainText(emailOf(user));
  const tab = await context.newPage();
  await tab.goto('/');
  await expect(tab.locator('.account-header__email')).toContainText(emailOf(user));
});

test('sign-out ends the session but keeps the saved plan for the next sign-in', async ({ page, user }) => {
  await openPlanner(page, user);
  await seedPlan(page, plan => { plan.postGradIncome.monthlyDebtBudget = '432.10'; });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(signInButton(page)).toBeVisible();
  await expect(page.locator('[data-notice="signedOut"]')).toBeVisible();
  expect((await page.request.get('/api/plan')).status()).toBe(401);
  await loginAs(page, user);
  expect((await getPlan(page.request)).document?.plan).toMatchObject({ postGradIncome: { monthlyDebtBudget: '432.10' } });
});

test('a second user never sees the first user\'s plan, even in the same browser after sign-out', async ({ page, browser, user }) => {
  await openPlanner(page, user);
  await seedPlan(page, plan => { plan.postGradIncome.monthlyDebtBudget = '777.77'; });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(signInButton(page)).toBeVisible();
  const other = uniqueUser(undefined, 'bob');
  await openPlanner(page, other);
  const plan = await getPlan(page.request);
  expect(JSON.stringify(plan)).not.toContain('777.77');
  await expect(page.locator('body')).not.toContainText('777.77');
  // No cached copy of the first user's plan remains readable in this browser.
  const cached = await page.evaluate(() => Object.keys(localStorage).map(key => localStorage.getItem(key) ?? '').join(''));
  expect(cached).not.toContain('777.77');
  // And from a completely separate browser profile.
  const separate = await browser.newContext({ baseURL: APP_ORIGIN });
  const bobPage = await separate.newPage();
  await openPlanner(bobPage, other);
  await expect(bobPage.locator('body')).not.toContainText('777.77');
  await separate.close();
});

test('a plan saved in this browser before accounts is offered, never attached automatically', async ({ page, user }) => {
  await page.goto('/');
  // A schema-3 envelope as written by the local-only release (a complete, valid plan with school years).
  const plan = createDefaultPlan();
  plan.loans = [{ id: 'dev1', name: 'Device loan', type: 'unsubsidized', principal: '6543.21', annualRate: '0.0653', disbursementDate: plan.settings.startDate, termMonths: 120 }];
  plan.postGradIncome.monthlyDebtBudget = '321.00';
  const legacy = JSON.stringify({ app: 'debtnav', schemaVersion: 3, savedAt: '2026-09-01T00:00:00.000Z', document: { disclaimerDismissed: true, plan } });
  await page.evaluate(value => localStorage.setItem('debtnav.plan', value), legacy);
  await loginAs(page, user);
  await expect(page.getByRole('heading', { name: 'A plan was found in this browser' })).toBeVisible();
  const before = await getPlan(page.request);
  expect(JSON.stringify(before)).not.toContain('6543.21');
  await page.getByRole('button', { name: 'Use my device plan' }).click();
  await expect.poll(async () => JSON.stringify((await getPlan(page.request)).document)).toContain('6543.21');
});
