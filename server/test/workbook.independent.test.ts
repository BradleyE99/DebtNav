/**
 * Independent US-1004/US-1005 workbook checks (tester), through the HTTP routes: template → rows added beyond the
 * template's table → preview counts → commit; bad rows reported by sheet/row/column with the plan unchanged;
 * formulas/macros rejected; export → import → export round trip lossless (team/tester-expected.md §8).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import { createTestContext, signInAs, api, uploadForm } from './support';
import { createDefaultPlan, calculatePlannerOutputs, calculatePlannerComparisons } from '../../src/engine/planner';
import { toPersistedPlan } from '../../src/data/validation';
import type { PlannerDocument, PlannerPlan } from '../../src/engine/planner-contracts';

type Ctx = Awaited<ReturnType<typeof createTestContext>>;
let ctx: Ctx;
let user: { cookie: string; userId: string; token: string };
beforeEach(async () => {
  ctx = await createTestContext();
  user = await signInAs(ctx, 'e2e|workbook', 'workbook-owner@example.test');
});
afterEach(async () => { await ctx.close(); });

const bytesOf = async (response: Response) => new Uint8Array(await response.arrayBuffer());
async function load(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as never);
  return workbook;
}
async function save(workbook: ExcelJS.Workbook) { return new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer); }
async function preview(bytes: Uint8Array, filename = 'plan.xlsx') {
  const response = await api(ctx, 'POST', '/api/workbook/import/preview', { cookie: user.cookie, body: uploadForm(bytes, filename) });
  return { status: response.status, body: await response.json() };
}
async function currentPlan() {
  return (await (await api(ctx, 'GET', '/api/plan', { cookie: user.cookie })).json()) as { document: PlannerDocument | null; revision: number | null };
}
async function commit(previewId: string) {
  const { revision } = await currentPlan();
  const response = await api(ctx, 'POST', '/api/workbook/import/commit', { cookie: user.cookie, body: { previewId, baseRevision: revision } });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json();
}
/** Writes a row of values by header name (header row 1). */
function setRow(sheet: ExcelJS.Worksheet, rowNumber: number, values: Record<string, string | number>) {
  const headers = (sheet.getRow(1).values as unknown[]).map(v => (typeof v === 'string' ? v : ''));
  for (const [key, value] of Object.entries(values)) {
    const column = headers.indexOf(key);
    if (column < 1) throw new Error(`no column ${key} on ${sheet.name}`);
    sheet.getCell(rowNumber, column).value = value;
  }
}
async function seed(plan: PlannerPlan) {
  const put = await api(ctx, 'PUT', '/api/plan', { cookie: user.cookie, body: { baseRevision: null, envelope: { app: 'debtnav', schemaVersion: 4, savedAt: '2026-10-16T00:00:00.000Z', document: { plan, disclaimerDismissed: true } } } });
  expect(put.status, await put.clone().text()).toBe(200);
}

const loanRow = (n: number) => ({
  loanId: `loan-${n}`, name: `Loan ${n}`, type: n % 2 ? 'unsubsidized' : 'private', principal: 1000 * n, ratePercent: 5 + n / 10,
  disbursementDate: '2026-08-24', termMonths: 120, academicYear: '2026-2027', ...(n % 2 ? {} : { graceMonths: 6 }),
});

async function filledTemplate() {
  const template = await api(ctx, 'GET', '/api/workbook/template?years=1&loans=2', { cookie: user.cookie });
  expect(template.status).toBe(200);
  expect(template.headers.get('content-disposition')).toMatch(/attachment/);
  const workbook = await load(await bytesOf(template));
  setRow(workbook.getWorksheet('Settings')!, 2, { startDate: '2026-08-24', graduationDate: '2027-05-20' });
  setRow(workbook.getWorksheet('RepaymentPlan')!, 2, { annualSalary: 50000, monthlyDebtBudget: 500, raiseAllocationPercent: 50 });
  const loans = workbook.getWorksheet('Loans')!;
  setRow(loans, 2, loanRow(1));
  setRow(loans, 3, loanRow(2));
  // Rows beyond the template's 2-row table, after one blank row (ignored).
  for (let n = 3; n <= 7; n++) setRow(loans, n + 2, loanRow(n));
  const costs = workbook.getWorksheet('Costs')!;
  for (let n = 1; n <= 6; n++) setRow(costs, n + 1, { costId: `cost-${n}`, yearId: 'year-1', category: 'tuition', label: `Cost ${n}`, amount: 1500, period: 'annual' });
  return workbook;
}

describe('template with rows added beyond the initial size', () => {
  it('imports every populated row (7 loans, 6 costs), ignores the blank row and keeps ids and academic years', async () => {
    const result = await preview(await save(await filledTemplate()));
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.errors).toEqual([]);
    expect(result.body.counts).toMatchObject({ loans: 7, costs: 6, schoolYears: 1 });
    // Preview alone changes nothing.
    expect((await currentPlan()).document).toBeNull();
    await commit(result.body.previewId);
    const { document } = await currentPlan();
    expect(document!.plan.loans.map(l => l.id)).toEqual(['loan-1', 'loan-2', 'loan-3', 'loan-4', 'loan-5', 'loan-6', 'loan-7']);
    expect(document!.plan.loans.every(l => l.academicYear === '2026-2027')).toBe(true);
    expect(document!.plan.loans[6]).toMatchObject({ principal: '7000.00', annualRate: '0.057', type: 'unsubsidized' });
    expect(document!.plan.loans[1].requiredPayment).toEqual({ graceMonths: 6 });
    const out = calculatePlannerOutputs(document!.plan);
    expect(out.ok && out.value.years[0]).toMatchObject({ costs: '9000.00', borrowed: '28000.00' });
  });

  it('reports a bad value by sheet, row and column and leaves the saved plan unchanged', async () => {
    await seed(createDefaultPlan());
    const before = await currentPlan();
    const workbook = await filledTemplate();
    setRow(workbook.getWorksheet('Loans')!, 8, { ratePercent: 'six' }); // loan-6
    setRow(workbook.getWorksheet('Loans')!, 9, { disbursementDate: '2026-13-45' }); // loan-7
    const result = await preview(await save(workbook));
    expect(result.body.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ sheet: 'Loans', row: 8, column: 'ratePercent' }),
      expect.objectContaining({ sheet: 'Loans', row: 9, column: 'disbursementDate' }),
    ]));
    if (result.body.previewId) {
      const response = await api(ctx, 'POST', '/api/workbook/import/commit', { cookie: user.cookie, body: { previewId: result.body.previewId, baseRevision: before.revision } });
      expect(response.status).not.toBe(200);
    }
    expect(await currentPlan()).toEqual(before);
  });

  it('a formula in a data cell is rejected (never evaluated, cached results never trusted)', async () => {
    const workbook = await filledTemplate();
    workbook.getWorksheet('Loans')!.getCell('D2').value = { formula: '1000*2', result: 2000 } as ExcelJS.CellFormulaValue;
    const result = await preview(await save(workbook));
    expect(result.body.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.body.errors)).toMatch(/formula/i);
  });

  it('macro-enabled files and unknown workbook schemas are rejected with guidance', async () => {
    const bytes = await save(await filledTemplate());
    const xlsm = await preview(bytes, 'plan.xlsm');
    expect(xlsm.body.errors?.length ?? 0).toBeGreaterThan(0);
    expect(JSON.stringify(xlsm.body)).toMatch(/macro|xlsm/i);
    const workbook = await filledTemplate();
    setRow(workbook.getWorksheet('Metadata')!, 2, { value: 'debtnav-workbook-99' });
    const unknown = await preview(await save(workbook));
    expect(unknown.body.errors.length).toBeGreaterThan(0);
  });

  it('not a spreadsheet / over 5 MB → clear error, not a crash', async () => {
    const junk = await preview(new TextEncoder().encode('not a zip'));
    expect(junk.status).toBeLessThan(500);
    const big = await api(ctx, 'POST', '/api/workbook/import/preview', { cookie: user.cookie, body: uploadForm(new Uint8Array(5 * 1024 * 1024 + 10), 'big.xlsx') });
    expect([413, 422, 400]).toContain(big.status);
  });
});

describe('export → import → export round trip', () => {
  function richPlan(): PlannerPlan {
    const plan = createDefaultPlan();
    const [y1, y2] = plan.schoolYears;
    plan.schoolYears[0] = { ...y1, bufferPercent: '5', costItems: [{ id: 'c1', category: 'tuition', label: '=SUM(A1) tuition', amount: '12000.00', semester: 'annual' }], resources: [{ id: 'r1', type: 'job', label: 'Campus job', amount: '0.00', incomeMode: 'hourly', hourlyWage: '15.50', hoursPerWeek: '10', weeksWorked: '30', unavailablePercent: '20' }] };
    plan.schoolYears[1] = { ...y2, costItems: [{ id: 'c2', category: 'housing', label: '+housing', amount: '8000.50', semester: 'fall' }] };
    plan.loans = [
      { id: 'l1', name: 'Sub 26', type: 'subsidized', principal: '3500.00', annualRate: '0.0653', disbursementDate: '2026-08-24', termMonths: 120, academicYear: '2026-2027', schoolYearId: y1.id, gapAtCreation: '3500.00' },
      { id: 'l2', name: 'Private', type: 'private', principal: '9000.00', annualRate: '0.0899', disbursementDate: '2027-08-24', termMonths: 180, academicYear: '2027-2028', capitalizeInterest: false, requiredPayment: { graceMonths: 3 } },
      { id: 'l3', name: 'Unsub', type: 'unsubsidized', principal: '2000.00', annualRate: '0.0653', disbursementDate: '2028-08-24', termMonths: 120, academicYear: 'unassigned', payInterestWhileInSchool: true, requiredPayment: { firstDueDate: '2030-12-15' } },
    ];
    plan.repayment = { ...plan.repayment, strategyId: 'custom', customOrder: ['l3', 'l1', 'l2'], payoffTarget: { mode: 'target', kind: 'duration', months: 84 }, voluntaryStart: { kind: 'date', date: '2030-07-01' } };
    plan.postGradIncome = { annualSalary: '61000.00', monthlyDebtBudget: '450.00', raiseAllocationPercent: '40', monthlyTakeHome: '3900.00', monthlyExpenses: '2600.00' };
    plan.lifeEvents = [
      { id: 'e1', name: 'Raise', date: '2032-01-01', type: 'income', amount: '70000.00', allocationPercent: '50' },
      { id: 'e2', name: 'Bonus', date: '2033-03-01', type: 'windfall', amount: '1500.00', allocationPercent: '100', recurrence: 'yearly', recurrenceEndDate: '2036-03-01' },
    ];
    plan.scenarios = [{ id: 's1', name: 'Higher rate', overrides: { 'loans.l2.annualRate': '0.105', 'postGradIncome.monthlyDebtBudget': '600.00' } }];
    return plan;
  }

  it('preserves every input, academic year, scenario and outcome; the second export matches the first', async () => {
    const original = richPlan();
    await seed(original);
    const first = await bytesOf(await api(ctx, 'GET', '/api/workbook/export', { cookie: user.cookie }));
    const result = await preview(first);
    expect(result.body.errors).toEqual([]);
    expect(result.body.counts).toMatchObject({ loans: 3, scenarios: 1, scenarioOverrides: 2, customOrder: 3, lifeEvents: 2 });
    const committed = await commit(result.body.previewId);
    expect(committed.revision).toBe(2);
    const { document } = await currentPlan();
    expect(toPersistedPlan(document!.plan)).toEqual(toPersistedPlan(original));
    const a = calculatePlannerOutputs(original), b = calculatePlannerOutputs(document!.plan);
    expect(a.ok && b.ok && b.value.repayment?.debtFreeDate).toBe(a.ok && a.value.repayment?.debtFreeDate);
    expect(a.ok && b.ok && b.value.repayment?.totalInterestPaid).toBe(a.ok && a.value.repayment?.totalInterestPaid);
    const ca = calculatePlannerComparisons(original), cb = calculatePlannerComparisons(document!.plan);
    expect(cb.ok && cb.value.scenarioComparisons.map(c => c.projection.totalInterestPaid)).toEqual(ca.ok && ca.value.scenarioComparisons.map(c => c.projection.totalInterestPaid));

    const second = await bytesOf(await api(ctx, 'GET', '/api/workbook/export', { cookie: user.cookie }));
    const [w1, w2] = [await load(first), await load(second)];
    for (const sheet of w1.worksheets.filter(s => s.name !== 'Metadata')) {
      const rows = (w: ExcelJS.Workbook) => { const out: unknown[] = []; w.getWorksheet(sheet.name)!.eachRow(r => out.push(r.values)); return out; };
      expect(rows(w2), sheet.name).toEqual(rows(w1));
    }
  });

  it('escapes formula-like text and never exports account ids, emails or tokens', async () => {
    await seed(richPlan());
    const bytes = await bytesOf(await api(ctx, 'GET', '/api/workbook/export', { cookie: user.cookie }));
    const workbook = await load(bytes);
    const labels: unknown[] = [];
    workbook.getWorksheet('Costs')!.eachRow(r => labels.push((r.values as unknown[])[4]));
    expect(labels).toContain("'=SUM(A1) tuition");
    expect(labels).toContain("'+housing");
    let formulas = 0;
    const text: string[] = [];
    workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => {
      if (cell.formula) formulas++;
      text.push(String(cell.text));
    })));
    expect(formulas).toBe(0);
    const all = text.join('\n');
    for (const secret of [user.userId, user.token, 'workbook-owner@example.test', 'e2e|workbook']) expect(all).not.toContain(secret);
  });
});
