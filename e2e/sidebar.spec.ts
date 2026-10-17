import type { Page } from '@playwright/test';
import { test, expect, openPlanner } from './support/fixtures';
import AxeBuilder from '@axe-core/playwright';

// Sidebar navigation (desktop) and off-canvas drawer (≤ 768 px), driven with real mouse and keyboard input.
// Run with: E2E_PORT=5191 npx playwright test e2e/sidebar.spec.ts

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'income', label: 'Income & Earnings' },
  { id: 'setup', label: 'Timeline' },
  { id: 'school', label: 'Costs' },
  { id: 'loans', label: 'Loans' },
  { id: 'repayment', label: 'Repayment Plan' },
  { id: 'events', label: 'Life events' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'federal', label: 'Federal' },
  { id: 'results', label: 'Results' },
  { id: 'data', label: 'Your data' },
];
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const PREFERENCE_KEY = 'debtnav.ui.sidebar';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Planner sections' });
const navLink = (page: Page, name: string) => nav(page).getByRole('link', { name, exact: true });
const mainBox = async (page: Page) => {
  const box = await page.locator('#main').boundingBox();
  if (!box) throw new Error('main has no box');
  return box;
};
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const axeViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`);
};
/** Waits until the sidebar width transition has finished (main stops moving). */
async function settledMainBox(page: Page) {
  let previous = await mainBox(page);
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(60);
    const next = await mainBox(page);
    if (next.x === previous.x && next.width === previous.width) return next;
    previous = next;
  }
  return previous;
}

/** Reload (the disclaimer stays dismissed) so keyboard navigation starts from the top of the document. */
async function freshPage(page: Page) {
  // Load without a dashboard hash: a hash URL focuses that dashboard's heading on load.
  await page.goto('/');
  // The account plan loads before the shell renders; keyboard input before then goes nowhere.
  await expect(page.locator('.dashboard')).toBeVisible();
  await expect(page.getByRole('button', { name: 'I understand' })).toHaveCount(0);
}
/** Waits for CSS animations (drawer slide-in) to finish before measuring. */
const animationsDone = (page: Page) => page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'));

// Every test signs in as a fresh account through the real OIDC flow; the sidebar preference is per browser.
test.beforeEach(async ({ page, user }) => {
  await openPlanner(page, user);
});

// ------------------------------------------------------------------ desktop sidebar

test('every sidebar link opens only its dashboard, focuses its heading and becomes active', async ({ page }) => {
  for (const { id, label } of SECTIONS) {
    await navLink(page, label).click();
    await expect(page.locator('#' + id)).toBeInViewport();
    await expect(page).toHaveURL(new RegExp('#' + id + '$'));
    await expect(page.locator('#' + id + '-heading')).toBeFocused();
    await expect(navLink(page, label)).toHaveAttribute('aria-current', 'page');
    await expect(nav(page).locator('[aria-current]')).toHaveCount(1);
    for (const other of SECTIONS.filter(item => item.id !== id)) {
      await expect(page.locator('main #' + other.id)).toHaveCount(0);
    }
    await page.mouse.move(800, 400);
    await page.mouse.wheel(0, 10000);
    await expect(navLink(page, label)).toHaveAttribute('aria-current', 'page');
  }
});

test('direct section URLs and Back/Forward keep the navigation highlight in sync', async ({ page }) => {
  await page.goto('/#loans');
  await expect(navLink(page, 'Loans')).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(navLink(page, 'Loans')).toHaveAttribute('aria-current', 'page');
  await navLink(page, 'Repayment Plan').click();
  await navLink(page, 'Scenarios').click();
  await page.goBack();
  await expect(page).toHaveURL(/#repayment$/);
  await expect(navLink(page, 'Repayment Plan')).toHaveAttribute('aria-current', 'page');
  await page.goForward();
  await expect(page).toHaveURL(/#scenarios$/);
  await expect(navLink(page, 'Scenarios')).toHaveAttribute('aria-current', 'page');
  await page.evaluate(() => { window.location.hash = 'school'; });
  await expect(navLink(page, 'Costs')).toHaveAttribute('aria-current', 'page');
});

test('sidebar stays visible while scrolling and does not cover the content', async ({ page }) => {
  const sidebar = page.locator('#app-sidebar');
  await page.mouse.move(800, 400);
  await page.mouse.wheel(0, 3000);
  await expect(sidebar).toBeInViewport();
  const sidebarBox = await sidebar.boundingBox();
  expect(sidebarBox?.y).toBe(0);
  const main = await mainBox(page);
  expect(sidebarBox!.x + sidebarBox!.width).toBeLessThanOrEqual(main.x);
});

test('collapsing to the icon rail widens the main content, and expanding restores it', async ({ page }) => {
  const before = await settledMainBox(page);
  const toggle = page.getByRole('button', { name: 'Collapse navigation' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAttribute('aria-controls', 'app-sidebar');
  await toggle.click();
  const expand = page.getByRole('button', { name: 'Expand navigation' });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  const after = await settledMainBox(page);
  expect(after.width).toBeGreaterThan(before.width + 100);
  expect(after.x).toBeLessThan(before.x);
  const rail = await page.locator('#app-sidebar').boundingBox();
  expect(rail!.width).toBeLessThan(100);
  expect(rail!.x + rail!.width).toBeLessThanOrEqual(after.x);
  // Active state is still shown on the rail.
  await navLink(page, 'Federal').click();
  await expect(navLink(page, 'Federal')).toHaveAttribute('aria-current', 'page');
  await expect(navLink(page, 'Federal')).toBeVisible();
  await expand.click();
  const restored = await settledMainBox(page);
  expect(restored.width).toBeCloseTo(before.width, 0);
});

test('the collapsed preference survives a reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  expect(await page.evaluate(key => localStorage.getItem(key), PREFERENCE_KEY)).toBe('collapsed');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute('aria-expanded', 'false');
  expect((await page.locator('#app-sidebar').boundingBox())!.width).toBeLessThan(100);
  await page.getByRole('button', { name: 'Expand navigation' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Collapse navigation' })).toHaveAttribute('aria-expanded', 'true');
});

test('rail links show a tooltip on hover and on keyboard focus', async ({ page }) => {
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  const tooltip = page.locator('.shell-tooltip');
  await navLink(page, 'Scenarios').hover();
  await expect(tooltip).toHaveText('Scenarios');
  await expect(tooltip).toBeVisible();
  await page.mouse.move(900, 600);
  await expect(tooltip).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand navigation' }).focus();
  await page.keyboard.press('Tab');
  await expect(navLink(page, 'Overview')).toBeFocused();
  await expect(tooltip).toHaveText('Overview');
  await page.keyboard.press('Tab');
  await expect(tooltip).toHaveText('Income & Earnings');
  const linkBox = await navLink(page, 'Income & Earnings').boundingBox();
  const tipBox = await tooltip.boundingBox();
  expect(tipBox!.x).toBeGreaterThanOrEqual(linkBox!.x + linkBox!.width - 1);
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
});

test('rail tooltips dismiss when a short sidebar scrolls or the viewport resizes', async ({ page }) => {
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await settledMainBox(page);
  await page.setViewportSize({ width: 1280, height: 320 });
  await navLink(page, 'Timeline').hover();
  const tooltip = page.locator('.shell-tooltip');
  await expect(tooltip).toHaveText('Timeline');
  await page.locator('#app-sidebar').evaluate(el => { el.scrollTop = 100; });
  await expect(tooltip).toHaveCount(0);
  await page.locator('#app-sidebar').evaluate(el => { el.scrollTop = 0; });
  await page.mouse.move(900, 300);
  await navLink(page, 'Timeline').hover();
  await expect(tooltip).toHaveText('Timeline');
  await page.setViewportSize({ width: 1280, height: 400 });
  await expect(tooltip).toHaveCount(0);
});

test('keyboard only: skip link first, then the toggle and links in order; Enter and Space activate', async ({ page }) => {
  await freshPage(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to your plan' })).toBeFocused();
  await page.keyboard.press('Tab');
  const toggle = page.getByRole('button', { name: 'Collapse navigation' });
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Collapse navigation' })).toBeFocused();
  for (const { label } of SECTIONS.slice(0, SECTIONS.findIndex(item => item.id === 'loans') + 1)) {
    await page.keyboard.press('Tab');
    await expect(navLink(page, label)).toBeFocused();
  }
  await page.keyboard.press('Enter');
  await expect(page.locator('#loans-heading')).toBeFocused();
  await expect(navLink(page, 'Loans')).toHaveAttribute('aria-current', 'page');
  // The next Tab continues inside the chosen section.
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('#loans'))).toBe(true);
  // The skip link still moves focus to the main landmark.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('body').focus();
  await page.getByRole('link', { name: 'Skip to your plan' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('axe: no violations with the sidebar expanded and collapsed; no horizontal overflow at 1280 px', async ({ page }) => {
  expect(page.viewportSize()?.width).toBe(1280);
  expect(await axeViolations(page)).toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await settledMainBox(page);
  expect(await axeViolations(page)).toEqual([]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('print hides the sidebar and the top bar', async ({ page }) => {
  await navLink(page, 'Results').click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#app-sidebar')).toBeHidden();
  await expect(page.locator('.shell-topbar')).toBeHidden();
  await expect(page.locator('#results')).toBeVisible();
});

// ------------------------------------------------------------------ narrow screens: off-canvas drawer

test.describe('360 px drawer @narrow', () => {
  test('sidebar is hidden; the Menu button opens a modal drawer and Escape closes it', async ({ page }) => {
    await expect(page.locator('#app-sidebar')).toBeHidden();
    const menu = page.getByRole('button', { name: 'Menu' });
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    const drawer = page.getByRole('dialog', { name: 'Navigation' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Close navigation' })).toBeFocused();
    await expect(page.locator('.shell-content')).toHaveAttribute('inert', '');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(menu).toBeFocused();
    await expect(page.locator('.shell-content')).not.toHaveAttribute('inert', '');
  });

  test('backdrop click and the Close button close the drawer and return focus to Menu', async ({ page }) => {
    const menu = page.getByRole('button', { name: 'Menu' });
    await menu.click();
    await page.getByTestId('nav-backdrop').click({ position: { x: 340, y: 400 } });
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(menu).toBeFocused();
    await menu.click();
    await page.getByRole('button', { name: 'Close navigation' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(menu).toBeFocused();
  });

  test('choosing a link closes the drawer, switches dashboard and focuses its heading', async ({ page }) => {
    for (const { id, label } of SECTIONS.filter(item => ['results', 'loans', 'data'].includes(item.id))) {
      await page.getByRole('button', { name: 'Menu' }).click();
      await page.getByRole('dialog').getByRole('link', { name: label, exact: true }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.locator(`#${id}-heading`)).toBeFocused();
      await expect(page.locator(`#${id}-heading`)).toBeInViewport();
      // The heading is not hidden under the sticky top bar.
      // Scrolling is smooth (style.css); once it settles the heading sits just below the sticky top bar.
      const headingTop = async () => (await page.locator(`#${id}-heading`).boundingBox())!.y;
      await expect.poll(headingTop, { message: `${id} heading settles below the top bar` }).toBeGreaterThanOrEqual(56);
      // The closed drawer is hidden, so check the link element directly.
      await expect(page.locator(`#app-sidebar a[href="#${id}"]`)).toHaveAttribute('aria-current', 'page');
    }
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(navLink(page, 'Your data')).toHaveAttribute('aria-current', 'page');
  });

  test('keyboard only: skip link, Menu, trapped Tab inside the drawer', async ({ page }) => {
    await freshPage(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to your plan' })).toBeFocused();
    await page.keyboard.press('Tab');
    const menu = page.getByRole('button', { name: 'Menu' });
    await expect(menu).toBeFocused();
    await page.keyboard.press('Enter');
    const close = page.getByRole('button', { name: 'Close navigation' });
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(navLink(page, 'Your data')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    for (const { label } of SECTIONS) {
      await page.keyboard.press('Tab');
      await expect(navLink(page, label)).toBeFocused();
    }
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    for (let i = 0; i <= SECTIONS.findIndex(item => item.id === 'loans'); i += 1) await page.keyboard.press('Tab');
    await expect(navLink(page, 'Loans')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByRole('dialog')).toBeVisible(); // Space does not activate links (native behavior)
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('#loans-heading')).toBeFocused();
  });

  test('axe with the drawer open and closed; no horizontal overflow at 360 px', async ({ page }) => {
    expect(page.viewportSize()?.width).toBe(360);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await animationsDone(page);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    const drawerBox = await page.getByRole('dialog').boundingBox();
    expect(drawerBox!.x).toBeGreaterThanOrEqual(0);
    expect(drawerBox!.x + drawerBox!.width).toBeLessThanOrEqual(360);
    expect(await axeViolations(page)).toEqual([]);
  });
});

test('crossing the drawer breakpoint keeps focus on a visible navigation control', async ({ page }) => {
  await page.getByRole('button', { name: 'Collapse navigation' }).focus();
  await page.setViewportSize({ width: 360, height: 720 });
  const menu = page.getByRole('button', { name: 'Menu' });
  await expect(menu).toBeFocused();
  await menu.click();
  await expect(page.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Collapse navigation' })).toBeFocused();
  await expect(page.locator('.shell-content')).not.toHaveAttribute('inert', '');
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
});

test('reduced motion disables the sidebar transition; no overflow just above the drawer breakpoint', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('#app-sidebar').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await page.locator('#app-sidebar').evaluate(el => getComputedStyle(el).transitionDuration)).not.toBe('0s');
  await page.setViewportSize({ width: 800, height: 720 });
  await expect(page.locator('#app-sidebar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 768, height: 720 });
  await expect(page.locator('#app-sidebar')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});
