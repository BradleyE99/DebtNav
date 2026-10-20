/**
 * Independent tester helpers for optional sign-in: guest planner, sign-in through the mock chooser, network
 * recording (no guest financial input may be sent for persistence), and browser-storage scans.
 */
import type { Page, Locator, Request, BrowserContext } from '@playwright/test';
import { expect, ISSUER_ORIGIN, APP_ORIGIN, getPlan } from './fixtures';

export const GUEST_SAVED_TEXT = 'Saved on this browser. Sign in to access your plan on other devices.';
export const UNAVAILABLE_TEXT = 'Browser storage is unavailable (for example in private browsing). DebtNav still works, but your changes will not be saved on this device. Export a backup to keep them.';
export const QUOTA_TEXT = 'Your changes could not be saved on this device. Storage may be unavailable or full; export a backup to keep them.';
export const GUEST_PLAN_KEY = 'debtnav.plan';

export const status = (page: Page) => page.locator('[data-save-state]').first();
export const budgetField = (page: Page) => page.getByLabel('Monthly payment', { exact: true });
export const salaryField = (page: Page) => page.getByLabel('Salary (before tax)', { exact: true });
export const startPlanning = (page: Page) => page.getByRole('button', { name: 'Start planning' }).or(page.getByRole('link', { name: 'Start planning' })).first();
export const guestSignIn = (page: Page) => page.getByRole('button', { name: /Sign in with Google to save across devices/ }).first();

export async function retype(page: Page, field: Locator, value: string): Promise<void> {
  await field.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(value);
  await field.blur();
}

/** Dismisses the first-run disclaimer if it is shown (guests see it too). */
export async function dismissDisclaimer(page: Page): Promise<void> {
  const understand = page.getByRole('button', { name: 'I understand' });
  const dashboard = page.locator('.dashboard');
  await expect(understand.or(dashboard).first()).toBeVisible({ timeout: 20_000 });
  if (await understand.isVisible()) await understand.click();
  await expect(dashboard).toBeVisible();
}

/** Opens the app as a guest (no session) and waits for the planner. */
export async function openGuest(page: Page, hash = '#overview'): Promise<void> {
  await page.goto(`/${hash}`);
  await dismissDisclaimer(page);
}

/** Opens a destination tab (no account menu needed). */
export async function tab(page: Page, id: 'overview' | 'school' | 'loans' | 'results'): Promise<void> {
  if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
  await page.getByRole('navigation', { name: 'Planner sections' }).locator(`a[href="#${id}"]`).click();
  await expect(page.locator('.dashboard')).toHaveAttribute('data-dashboard', id);
  await page.evaluate(() => { for (const d of document.querySelectorAll<HTMLDetailsElement>('main details')) d.open = true; });
}

/** Opens Account → Your data (works for guests and accounts). */
export async function openYourData(page: Page): Promise<Locator> {
  if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Account|^Menu|^Guest/ }).first().click();
  await page.getByRole('button', { name: 'Your data', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Your data' });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function setBudget(page: Page, value: string): Promise<void> {
  await tab(page, 'results');
  await retype(page, budgetField(page), value);
}

/** Reads browser storage (all keys) as one string; '' when storage is unavailable. */
export async function storageDump(page: Page): Promise<string> {
  return page.evaluate(() => {
    try { return Object.keys(localStorage).map(key => `${key}=${localStorage.getItem(key) ?? ''}`).join('\n'); } catch { return ''; }
  });
}
export async function storageKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => { try { return Object.keys(localStorage); } catch { return []; } });
}
export async function guestDraft(page: Page): Promise<string | null> {
  return page.evaluate(key => { try { return localStorage.getItem(key); } catch { return null; } }, GUEST_PLAN_KEY);
}

export interface RecordedRequest { method: string; url: string; path: string; body: string }
/** Records every request to the app's /api (and anything not same-origin), with bodies. */
export function recordApi(target: Page | BrowserContext): RecordedRequest[] {
  const seen: RecordedRequest[] = [];
  target.on('request', (request: Request) => {
    const url = new URL(request.url());
    if (url.origin === APP_ORIGIN && !url.pathname.startsWith('/api/')) return;
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    seen.push({ method: request.method(), url: request.url(), path: url.pathname, body: request.postData() ?? '' });
  });
  return seen;
}
/** Requests that could persist plan data (anything other than the session/config probes and sign-in redirects). */
export const persistenceRequests = (seen: RecordedRequest[]) =>
  seen.filter(r => /\/api\/(plan|workbook|account)/.test(r.path) || (r.method !== 'GET' && r.path.startsWith('/api/') && !r.path.startsWith('/api/auth/')));

/** Clicks the guest sign-in action and waits for the mock chooser (handles a "not saved" warning by failing). */
export async function beginSignIn(page: Page): Promise<void> {
  // The guest sign-in action lives on the Introduction.
  if (!(await guestSignIn(page).isVisible())) await tab(page, 'overview');
  await guestSignIn(page).click();
  await page.waitForURL(url => url.origin === ISSUER_ORIGIN, { timeout: 20_000 });
}
/** On the mock chooser: continue as `user` (or '__fail__'), or cancel. */
export async function chooseAccount(page: Page, user: string | 'cancel'): Promise<void> {
  if (user === 'cancel') await page.getByRole('button', { name: 'Cancel' }).click();
  else {
    await page.getByLabel('Test user name').fill(user);
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await page.waitForURL(url => url.origin === APP_ORIGIN && !url.pathname.startsWith('/api/'), { timeout: 20_000 });
}

export const serverBudget = async (page: Page) => ((await getPlan(page.request)).document?.plan as { postGradIncome?: { monthlyDebtBudget?: string } } | undefined)?.postGradIncome?.monthlyDebtBudget;

/** Signs out through the account menu (confirms "Sign out anyway" only when `force`). */
export async function signOutViaMenu(page: Page): Promise<void> {
  if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Account/ }).first().click();
  await page.getByRole('button', { name: 'Sign out' }).click();
}

export const noHorizontalOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

/** Init script: localStorage access throws (private mode / disabled storage). */
export const STORAGE_DISABLED = () => Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new DOMException('Storage disabled', 'SecurityError'); } });
/** Init script: writes to the plan key throw QuotaExceededError once `window.__quotaFull` is true. */
export const QUOTA_SWITCH = () => {
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
    if ((window as unknown as { __quotaFull?: boolean }).__quotaFull && key === 'debtnav.plan') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    return original.call(this, key, value);
  };
};
