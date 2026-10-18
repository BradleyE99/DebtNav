/**
 * US-506 / US-507 in the browser: required monthly payment for a payoff target (values from
 * team/tester-expected.md), chosen budget never changed silently, invalid targets explained, required vs
 * voluntary payment dates and missed-obligation warnings in Results. Plans are seeded through the API.
 */
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, goTo, seedPlan, getPlan } from './support/fixtures';

const go = goTo;
const loan = (id: string, principal: string, annualRate: string, extra: Record<string, unknown> = {}) => ({
  id, name: `Loan ${id}`, type: 'unsubsidized', principal, annualRate, disbursementDate: '2030-11-20', termMonths: 120, academicYear: 'unassigned', ...extra,
});
const metric = (page: Page, label: string) => page.locator('.target-result .metric').filter({ has: page.locator('dt', { hasText: label }) }).locator('.metric-value');

async function seedTarget(page: Page, loans: unknown[], months: number, budget = '400.00') {
  await seedPlan(page, plan => {
    plan.loans = loans;
    plan.repayment.customOrder = [];
    plan.postGradIncome.monthlyDebtBudget = budget;
    plan.repayment.payoffTarget = { mode: 'target', kind: 'duration', months };
  });
  await go(page, 'repayment');
}

test('$12,000 at 0% within 1 year requires exactly $1,000.00 and the chosen budget is unchanged', async ({ signedIn: page }) => {
  await seedTarget(page, [loan('z', '12000.00', '0')], 12);
  await expect(metric(page, 'Required monthly payment')).toHaveText('$1,000.00');
  await expect(metric(page, 'Your monthly payment')).toHaveText('$400.00');
  await expect(page.locator('.target-result')).toContainText(/Nov(ember)? 2031/);
  expect(((await getPlan(page.request)).document!.plan.postGradIncome as { monthlyDebtBudget: string }).monthlyDebtBudget).toBe('400.00');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map(v => v.id)).toEqual([]);
});

test('editing the duration in years and months recalculates (11 months → $1,090.91)', async ({ signedIn: page }) => {
  await seedTarget(page, [loan('z', '12000.00', '0')], 12);
  await expect(metric(page, 'Required monthly payment')).toHaveText('$1,000.00');
  const years = page.getByLabel('Years', { exact: true });
  await years.fill('0');
  await years.blur();
  const months = page.getByLabel('Months', { exact: true });
  await months.fill('11');
  await months.blur();
  await expect(metric(page, 'Required monthly payment')).toHaveText('$1,090.91');
});

test('interest-bearing and multi-loan targets match the independent reference', async ({ signedIn: page }) => {
  await seedTarget(page, [loan('s', '10000.00', '0.06')], 24);
  await expect(metric(page, 'Required monthly payment')).toHaveText('$443.21');
  await expect(page.locator('.target-result')).toContainText('$636.94');
  await seedTarget(page, [loan('hi', '5000.00', '0.07'), loan('lo', '8000.00', '0.04')], 36);
  await expect(metric(page, 'Required monthly payment')).toHaveText('$387.16');
  await expect(page.locator('.target-result')).toContainText('$937.58');
});

test('using the required payment is explicit and undoable', async ({ signedIn: page }) => {
  await seedTarget(page, [loan('z', '12000.00', '0')], 12);
  await page.getByRole('button', { name: 'Use $1,000.00 as my monthly payment' }).click();
  await expect.poll(async () => ((await getPlan(page.request)).document!.plan.postGradIncome as { monthlyDebtBudget: string }).monthlyDebtBudget).toBe('1000.00');
  await page.getByRole('group', { name: 'Undo' }).getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => ((await getPlan(page.request)).document!.plan.postGradIncome as { monthlyDebtBudget: string }).monthlyDebtBudget).toBe('400.00');
});

test('a past target date is rejected with an explanation; no projection-horizon control remains', async ({ signedIn: page }) => {
  await seedPlan(page, plan => {
    plan.loans = [loan('s', '10000.00', '0.06')];
    plan.repayment.payoffTarget = { mode: 'target', kind: 'date', date: '2020-01-20' };
  });
  await go(page, 'repayment');
  await expect(page.locator('.target-result[data-status="invalid"], .target-result[data-status="infeasible"]')).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/Projection horizon/i);
});

test('a late voluntary start shows required dates and a missed-payment warning in Results', async ({ signedIn: page }) => {
  await seedPlan(page, plan => {
    plan.loans = [loan('u1', '10000.00', '0.0653', { disbursementDate: '2029-08-24' })];
    plan.repayment.voluntaryStart = { kind: 'afterGraduation', months: 9 };
    plan.repayment.payoffTarget = { mode: 'budget' };
  });
  await go(page, 'repayment'); // Results with every section open (Repayment start lists the required dates)
  await expect(page.getByRole('alert').filter({ hasText: 'Required payments come before your first payment.' })).toBeVisible();
  await expect(page.locator('main')).toContainText(/Dec(ember)? 20, 2030|2030-12-20|12\/20\/2030/);
});
