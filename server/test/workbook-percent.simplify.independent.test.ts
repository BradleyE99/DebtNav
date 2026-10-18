/**
 * Independent reproduction (tester) of the suspected Excel percent-cell issue (team/math-audit.md S2, lead ruling
 * "Suspected Excel percent cells ×100"). A user who formats a cell as a percentage and types 6.53% gets a numeric
 * cell holding 0.0653 (displayed "6.53%"). The importer treats a numeric percent column as "6.53 = 6.53%", so it
 * reads 0.0653 as 0.0653 % (annual rate 0.000653) and 50% (0.5) as 0.5 %.
 * Acceptable outcomes: the displayed value is honoured (0.0653 / 50), or the row is rejected with a clear message.
 * Silently importing a 100× smaller value is the defect.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { readWorkbook, writeWorkbook } from '../src/workbook';
import { createDefaultPlan } from '../../src/engine/planner';
import type { PlannerDocument, PlannerPlan } from '../../src/engine/planner-contracts';

function documentWith(): PlannerDocument {
  const base = createDefaultPlan();
  const plan: PlannerPlan = {
    ...base,
    loans: [{ id: 'l1', name: 'Unsub', type: 'unsubsidized', principal: '2000.00', annualRate: '0.0653', disbursementDate: '2026-08-24', termMonths: 120, academicYear: '2026-2027' }],
    lifeEvents: [{ id: 'e1', name: 'Bonus', type: 'windfall', date: '2032-06-15', amount: '5000.00', allocationPercent: '50', recurrence: 'once' }],
  };
  return { plan, disclaimerDismissed: true };
}
function columnOf(sheet: ExcelJS.Worksheet, header: string): number {
  const headers = (sheet.getRow(1).values as unknown[]).map(v => (typeof v === 'string' ? v : ''));
  const index = headers.indexOf(header);
  if (index < 1) throw new Error(`no column ${header} on ${sheet.name}`);
  return index;
}
async function edit(mutate: (workbook: ExcelJS.Workbook) => void) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await writeWorkbook(documentWith(), { exportedAt: new Date('2026-10-17T00:00:00Z') }) as never);
  mutate(workbook);
  return readWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer), 'plan.xlsx');
}

describe('Excel percent-formatted numeric cells (suspected ×100 defect)', () => {
  it('control: the exported workbook re-imports with rate 0.0653 and allocation 50', async () => {
    const result = await edit(() => {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.plan.loans[0].annualRate).toBe('0.0653');
    expect(result.document.plan.lifeEvents[0].allocationPercent).toBe('50');
  });

  it('a rate typed as 6.53% (numeric 0.0653, format 0.00%) is read as 6.53%, or rejected — never 0.0653%', async () => {
    const result = await edit(workbook => {
      const sheet = workbook.getWorksheet('Loans')!;
      const cell = sheet.getCell(2, columnOf(sheet, 'ratePercent'));
      cell.value = 0.0653;
      cell.numFmt = '0.00%';
    });
    if (result.ok) expect(result.document.plan.loans[0].annualRate).toBe('0.0653'); // DEFECT: imports '0.000653'
  });

  it('an allocation typed as 50% (numeric 0.5, format 0%) is read as 50, or rejected — never 0.5', async () => {
    const result = await edit(workbook => {
      const sheet = workbook.getWorksheet('LifeEvents')!;
      const cell = sheet.getCell(2, columnOf(sheet, 'allocationPercent'));
      cell.value = 0.5;
      cell.numFmt = '0%';
    });
    if (result.ok) expect(result.document.plan.lifeEvents[0].allocationPercent).toBe('50'); // DEFECT: imports '0.5'
  });
});
