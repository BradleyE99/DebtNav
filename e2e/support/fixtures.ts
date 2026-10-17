/**
 * Shared end-to-end helpers: sign-in through the real OIDC redirect flow (mock issuer), unique users per test,
 * plan seeding through the API, and API restart. Ports follow playwright.config.ts.
 */
import { createDefaultPlan } from '../../src/engine/planner';
import { test as base, expect, type Page, type APIRequestContext, type TestInfo, type BrowserContext } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 5181);
export const APP_ORIGIN = `http://localhost:${port}`;
export const ISSUER_ORIGIN = `http://localhost:${port + 100}`;
export const API_ORIGIN = `http://localhost:${port + 200}`;
export const CONTROL_ORIGIN = `http://localhost:${port + 300}`;
/** Required on every non-GET API request (CSRF guard). */
export const CSRF = { 'X-Requested-With': 'debtnav' } as const;

let counter = 0;
/** A user name no other test (or earlier run) uses: login_hint for the mock issuer → sub "e2e|<name>". */
export function uniqueUser(testInfo?: TestInfo, prefix = 'u'): string {
  const slug = (testInfo?.title ?? 'test').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24).replace(/-+$/, '');
  return `${prefix}-${slug}-${Date.now().toString(36)}-${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
export const emailOf = (user: string) => `${user}@example.test`;

/**
 * Signs in through the real flow: /api/auth/login → mock issuer /authorize (login_hint) → /api/auth/callback →
 * returnTo. Verifies the session with GET /api/me. Does not touch the UI (see `openPlanner`).
 */
export async function loginAs(page: Page, user: string, returnTo = '/'): Promise<void> {
  await page.goto(`/api/auth/login?login_hint=${encodeURIComponent(user)}&returnTo=${encodeURIComponent(returnTo)}`);
  await page.waitForURL(url => url.origin === APP_ORIGIN && !url.pathname.startsWith('/api/'));
  const me = await page.request.get('/api/me');
  expect(me.status(), `signed in as ${user}`).toBe(200);
  expect((await me.json()).user.email).toBe(emailOf(user));
}

/** Signs in and waits for the planner, dismissing the first-run disclaimer if it is shown. */
export async function openPlanner(page: Page, user: string, hash = '#overview'): Promise<void> {
  await loginAs(page, user, `/${hash}`);
  const understand = page.getByRole('button', { name: 'I understand' });
  const dashboard = page.locator('.dashboard');
  await expect(understand.or(dashboard).first()).toBeVisible({ timeout: 20_000 });
  if (await understand.isVisible()) await understand.click();
  await expect(dashboard).toBeVisible();
  // A new account's first plan (and the disclaimer dismissal) is saved after a short debounce. Seeding through
  // the API before that save lands would leave this browser's unsynced copy in conflict with the seed.
  await expect(page.locator('[data-save-state]').first()).toHaveAttribute('data-save-state', 'saved', { timeout: 20_000 });
}

export interface PlanResponse { document: { plan: Record<string, unknown>; disclaimerDismissed: boolean } | null; revision: number | null; updatedAt: string | null }

export async function getPlan(request: APIRequestContext): Promise<PlanResponse> {
  const response = await request.get('/api/plan');
  expect(response.status()).toBe(200);
  return response.json();
}

export const envelope = (document: unknown, schemaVersion = 4) =>
  ({ app: 'debtnav', schemaVersion, savedAt: new Date().toISOString(), document });

/** PUT /api/plan with the current revision; returns the new revision. */
export async function putPlan(request: APIRequestContext, document: unknown, options: { baseRevision?: number | null; schemaVersion?: number } = {}): Promise<number> {
  const baseRevision = options.baseRevision !== undefined ? options.baseRevision : (await getPlan(request)).revision;
  const response = await request.put('/api/plan', { headers: CSRF, data: { baseRevision, envelope: envelope(document, options.schemaVersion) } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).revision;
}

/**
 * Seeds the signed-in user's plan through the API (replaces the old localStorage seeding). `edit` receives the
 * current server plan (or, for a brand-new user, the plan the app created on first load).
 */
export async function seedPlan(page: Page, edit: (plan: any) => void, options: { reload?: boolean } = {}): Promise<number> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await getPlan(page.request);
    // A brand-new user may not have a server plan yet: start from the engine's default plan.
    const document = current.document ? structuredClone(current.document) : { plan: createDefaultPlan() as unknown as Record<string, unknown>, disclaimerDismissed: true };
    edit(document.plan);
    const response = await page.request.put('/api/plan', { headers: CSRF, data: { baseRevision: current.revision, envelope: envelope(document) } });
    if (response.status() === 409) continue; // the app saved in between; re-read and re-apply
    expect(response.status(), await response.text()).toBe(200);
    if (options.reload !== false) await page.reload();
    return (await response.json()).revision;
  }
  throw new Error('seedPlan: repeated revision conflicts');
}

/** Restarts the API process on the same database (persistence across a backend restart). */
export async function restartApi(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${CONTROL_ORIGIN}/restart`, { timeout: 90_000 });
  expect(response.status()).toBe(200);
}

/** A second browser context (another device) signed in as the same user. */
export async function secondDevice(context: BrowserContext, user: string): Promise<Page> {
  const browser = context.browser()!;
  const other = await browser.newContext({ baseURL: APP_ORIGIN });
  const page = await other.newPage();
  await openPlanner(page, user);
  return page;
}

/** Fixture: `user` is a fresh unique account per test; `signedIn` opens the planner as that user. */
export const test = base.extend<{ user: string; signedIn: Page }>({
  user: async ({}, provide, testInfo) => { await provide(uniqueUser(testInfo)); }, // eslint-disable-line no-empty-pattern
  signedIn: async ({ page, user }, provide) => { await openPlanner(page, user); await provide(page); },
});
export { expect };
