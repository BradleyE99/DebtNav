/**
 * Plan → workbook (export) and blank template. exceljs is used only in this folder so it can be
 * swapped. Text that a spreadsheet could treat as a formula is escaped with a leading apostrophe.
 */
import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import type { PlannerDocument, PlannerPlan } from '../../../src/engine/planner-contracts';
import { listStrategies } from '../../../src/engine/strategies/registry';
import { academicYearOfSchoolYear } from '../../../src/engine/academicYear';
import { GENERAL_INSTRUCTIONS, WORKBOOK_PLAN_SCHEMA_VERSION, WORKBOOK_SCHEMA, sheetSpecs, type ColumnSpec, type SheetName, type SheetSpec } from './schema';

export type CellValue = string | number | null;
export type SheetRows = Record<SheetName, Array<Record<string, CellValue>>>;

/** Text starting with = + - @ tab, CR or an apostrophe gets one leading apostrophe (stripped on import). */
export const escapeText = (value: string): string => (/^[=+\-@\t\r']/.test(value) ? `'${value}` : value);

const num = (value: string | undefined): CellValue => (value === undefined ? null : Number(value));
const yesNo = (value: boolean | undefined): CellValue => (value === undefined ? null : value ? 'yes' : 'no');
const opt = <T>(value: T | undefined): T | null => (value === undefined ? null : value);
const ratePercent = (rate: string): number => Number(new Decimal(rate).times(100).toFixed());

export const strategyOptions = (): string[] => listStrategies().map(entry => entry.id);

/** The plan as sheet rows keyed by column header (values not yet escaped). */
export function planToRows(document: PlannerDocument): SheetRows {
  const plan: PlannerPlan = document.plan;
  const r = plan.repayment;
  const target = r.payoffTarget;
  const start = r.voluntaryStart;
  return {
    Settings: [{
      startDate: plan.settings.startDate, graduationDate: plan.settings.graduationDate, currency: plan.settings.currency,
      disclaimerDismissed: yesNo(document.disclaimerDismissed),
    }],
    SchoolYears: plan.schoolYears.map(year => ({
      yearId: year.id, startDate: year.startDate, endDate: year.endDate, academicYear: academicYearOfSchoolYear(year), bufferPercent: num(year.bufferPercent),
    })),
    Costs: plan.schoolYears.flatMap(year => year.costItems.map(item => ({
      costId: item.id, yearId: year.id, category: item.category, label: item.label, amount: num(item.amount), period: item.semester,
    }))),
    Resources: plan.schoolYears.flatMap(year => year.resources.map(resource => ({
      resourceId: resource.id, yearId: year.id, type: resource.type, label: resource.label, incomeMode: resource.incomeMode,
      amount: num(resource.amount), hourlyWage: num(resource.hourlyWage), hoursPerWeek: num(resource.hoursPerWeek),
      weeksWorked: num(resource.weeksWorked), unavailablePercent: num(resource.unavailablePercent),
    }))),
    Loans: plan.loans.map(loan => ({
      loanId: loan.id, name: loan.name, type: loan.type, principal: num(loan.principal), ratePercent: ratePercent(loan.annualRate),
      disbursementDate: loan.disbursementDate, termMonths: loan.termMonths, academicYear: opt(loan.academicYear),
      schoolYearId: opt(loan.schoolYearId), monthlyPayment: num(loan.monthlyPayment),
      payInterestWhileInSchool: yesNo(loan.payInterestWhileInSchool), accruesInterestInSchool: yesNo(loan.accruesInterestInSchool),
      capitalizeInterest: yesNo(loan.capitalizeInterest), gapAtCreation: num(loan.gapAtCreation),
      firstDueDate: opt(loan.requiredPayment?.firstDueDate), graceMonths: opt(loan.requiredPayment?.graceMonths),
      inSchoolPayments: yesNo(loan.requiredPayment?.inSchoolPayments),
    })),
    RepaymentPlan: [{
      annualSalary: num(plan.postGradIncome.annualSalary), monthlyTakeHome: num(plan.postGradIncome.monthlyTakeHome),
      monthlyExpenses: num(plan.postGradIncome.monthlyExpenses), monthlyDebtBudget: num(plan.postGradIncome.monthlyDebtBudget),
      raiseAllocationPercent: num(plan.postGradIncome.raiseAllocationPercent), strategyId: r.strategyId,
      extraMonthlyPayment: num(r.extraMonthlyPayment),
      payoffMode: target.mode === 'budget' ? 'budget' : target.kind,
      payoffDate: target.mode === 'target' && target.kind === 'date' ? target.date : null,
      payoffMonths: target.mode === 'target' && target.kind === 'duration' ? target.months : null,
      voluntaryStartKind: start.kind,
      voluntaryStartMonths: start.kind === 'afterGraduation' ? start.months : null,
      voluntaryStartDate: start.kind === 'date' ? start.date : null,
      federalMode: r.mode, federalPlan: r.federalPlan, familySize: r.familySize, annualAGI: num(r.annualAGI),
      dependency: plan.borrower.dependency, level: plan.borrower.level, priorFederalDebt: num(plan.borrower.priorFederalDebt),
    }],
    LifeEvents: plan.lifeEvents.map(event => ({
      eventId: event.id, name: event.name, date: event.date, type: event.type, amount: num(event.amount),
      allocationPercent: num(event.allocationPercent), yearId: opt(event.schoolYearId), recurrence: opt(event.recurrence),
      recurrenceEndDate: opt(event.recurrenceEndDate),
    })),
    Scenarios: plan.scenarios.map(scenario => ({ scenarioId: scenario.id, name: scenario.name })),
    ScenarioOverrides: plan.scenarios.flatMap(scenario => Object.entries(scenario.overrides).map(([fieldPath, value]) => ({
      scenarioId: scenario.id, fieldPath,
      valueType: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'text',
      value: typeof value === 'boolean' ? (value ? 'yes' : 'no') : value,
    }))),
    CustomOrder: r.customOrder.map((loanId, index) => ({ position: index + 1, loanId })),
  };
}

function templateRows(years: number, loans: number): SheetRows {
  const blank = (count: number) => Array.from({ length: count }, () => ({}));
  return {
    Settings: [{ currency: 'USD', disclaimerDismissed: 'no' }],
    SchoolYears: Array.from({ length: years }, (_, i) => ({ yearId: `year-${i + 1}`, bufferPercent: 0 })),
    Costs: blank(Math.max(4, years * 4)),
    Resources: blank(Math.max(2, years * 2)),
    Loans: Array.from({ length: Math.max(loans, 0) }, (_, i) => ({ loanId: `loan-${i + 1}` })),
    RepaymentPlan: [{
      strategyId: 'avalanche', extraMonthlyPayment: 0, payoffMode: 'budget', voluntaryStartKind: 'afterGraduation', voluntaryStartMonths: 6,
      federalMode: 'standard', federalPlan: 'rap', familySize: 1, annualAGI: 0, dependency: 'dependent', level: 'undergraduate', priorFederalDebt: 0,
    }],
    LifeEvents: blank(3),
    Scenarios: blank(2),
    ScenarioOverrides: blank(3),
    CustomOrder: blank(Math.max(loans, 1)),
  };
}

const TEXT_FORMAT_KINDS = new Set(['id', 'ref', 'text', 'date', 'enum', 'boolean', 'academicYear', 'derived']);

function columnFormat(column: ColumnSpec): string | undefined {
  if (TEXT_FORMAT_KINDS.has(column.kind)) return '@';
  if (column.kind === 'money') return '#,##0.00';
  if (column.kind === 'integer') return '0';
  return undefined;
}

function columnWidth(column: ColumnSpec): number {
  if (column.width) return column.width;
  if (column.kind === 'text') return 32;
  return Math.max(12, Math.min(28, column.header.length + 4));
}

function cellFor(value: CellValue | undefined): CellValue {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' ? escapeText(value) : value;
}

function addDataSheet(workbook: ExcelJS.Workbook, spec: SheetSpec, rows: Array<Record<string, CellValue>>): void {
  const sheet = workbook.addWorksheet(spec.name, { views: [{ state: 'frozen', ySplit: 1 }] });
  const data = (rows.length ? rows : [{}]).map(row => spec.columns.map(column => cellFor(row[column.header])));
  sheet.addTable({
    name: `tbl${spec.name}`,
    ref: 'A1',
    headerRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: spec.columns.map(column => ({ name: column.header, filterButton: !spec.single })),
    rows: data,
  });
  const lastRow = Math.max(data.length + 1, spec.single ? 2 : 1000);
  // exceljs implements range data validations but does not declare them in its typings.
  const validations = (sheet as unknown as { dataValidations: { add(range: string, validation: ExcelJS.DataValidation): void } }).dataValidations;
  spec.columns.forEach((column, index) => {
    const col = sheet.getColumn(index + 1);
    col.width = columnWidth(column);
    const format = columnFormat(column);
    if (format) {
      col.numFmt = format;
      for (let row = 2; row <= data.length + 1; row++) sheet.getCell(row, index + 1).numFmt = format;
    }
    const letter = col.letter;
    const range = `${letter}2:${letter}${lastRow}`;
    if (column.options && column.options.join(',').length < 250) {
      validations.add(range, {
        type: 'list', allowBlank: true, formulae: [`"${column.options.join(',')}"`],
        showErrorMessage: true, errorStyle: 'stop', errorTitle: column.header, error: `Choose one of: ${column.options.join(', ')}`,
      });
    }
  });
  sheet.getRow(1).font = { bold: true };
}

function addInstructions(workbook: ExcelJS.Workbook, specs: SheetSpec[]): void {
  const sheet = workbook.addWorksheet('Instructions');
  sheet.getColumn(1).width = 18;
  sheet.getColumn(2).width = 24;
  sheet.getColumn(3).width = 22;
  sheet.getColumn(4).width = 36;
  sheet.getColumn(5).width = 26;
  sheet.getColumn(6).width = 34;
  sheet.getColumn(7).width = 60;
  sheet.getColumn(8).width = 22;
  sheet.getCell('A1').value = 'DebtNav workbook — instructions';
  sheet.getCell('A1').font = { bold: true, size: 14 };
  let row = 3;
  for (const line of GENERAL_INSTRUCTIONS) {
    sheet.getCell(row, 1).value = line;
    sheet.mergeCells(row, 1, row, 7);
    sheet.getCell(row, 1).alignment = { wrapText: true, vertical: 'top' };
    sheet.getRow(row).height = 32;
    row++;
  }
  row++;
  sheet.getCell(row, 1).value = 'Sheets';
  sheet.getCell(row, 1).font = { bold: true, size: 12 };
  row++;
  for (const spec of specs) {
    sheet.getCell(row, 1).value = spec.name;
    sheet.getCell(row, 1).font = { bold: true };
    sheet.getCell(row, 2).value = spec.purpose;
    sheet.mergeCells(row, 2, row, 7);
    sheet.getCell(row, 2).alignment = { wrapText: true, vertical: 'top' };
    sheet.getRow(row).height = 30;
    row++;
  }
  row++;
  sheet.getCell(row, 1).value = 'Column dictionary (the Example column is an illustration only and is never imported)';
  sheet.getCell(row, 1).font = { bold: true, size: 12 };
  row++;
  const dictionary = specs.flatMap(spec => spec.columns.map(column => [
    spec.name, column.header, column.required,
    column.options ? `${kindLabel(column)}: ${column.options.join(' | ')}` : kindLabel(column),
    column.units ?? '', column.blank, column.note, escapeText(column.example),
  ]));
  sheet.addTable({
    name: 'tblColumnDictionary', ref: `A${row}`, headerRow: true,
    style: { theme: 'TableStyleLight9', showRowStripes: true },
    columns: ['Sheet', 'Column', 'Required', 'Type / allowed values', 'Units / format', 'Blank means', 'Description', 'Example'].map(name => ({ name, filterButton: true })),
    rows: dictionary,
  });
  for (let r = row + 1; r <= row + dictionary.length; r++) {
    for (const c of [4, 6, 7]) sheet.getCell(r, c).alignment = { wrapText: true, vertical: 'top' };
    sheet.getCell(r, 8).numFmt = '@';
  }
}

function kindLabel(column: ColumnSpec): string {
  switch (column.kind) {
    case 'id': return 'ID text';
    case 'ref': return 'ID of another record';
    case 'money': return 'money';
    case 'percent': return 'percent';
    case 'ratePercent': return 'annual rate percent';
    case 'quantity': return 'number';
    case 'integer': return 'whole number';
    case 'date': return 'date';
    case 'enum': return 'choice';
    case 'boolean': return 'yes/no';
    case 'academicYear': return 'academic year';
    case 'derived': return 'calculated (reference)';
    case 'overrideValue': return 'value in stored form';
    default: return 'text';
  }
}

function addMetadata(workbook: ExcelJS.Workbook, kind: 'export' | 'template', exportedAt: Date): void {
  const sheet = workbook.addWorksheet('Metadata');
  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 30;
  sheet.addTable({
    name: 'tblMetadata', ref: 'A1', headerRow: true, style: { theme: 'TableStyleLight1' },
    columns: [{ name: 'key' }, { name: 'value' }],
    rows: [
      ['workbookSchema', WORKBOOK_SCHEMA],
      ['planSchemaVersion', WORKBOOK_PLAN_SCHEMA_VERSION],
      ['kind', kind],
      ['createdAt', exportedAt.toISOString()],
      ['app', 'DebtNav'],
    ],
  });
}

async function build(rows: SheetRows, kind: 'export' | 'template', at: Date): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DebtNav';
  workbook.created = at;
  const specs = sheetSpecs(strategyOptions());
  addInstructions(workbook, specs);
  for (const spec of specs) addDataSheet(workbook, spec, rows[spec.name]);
  addMetadata(workbook, kind, at);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export function writeWorkbook(document: PlannerDocument, options: { exportedAt?: Date } = {}): Promise<Uint8Array> {
  return build(planToRows(document), 'export', options.exportedAt ?? new Date());
}

export function writeTemplate(options: { years: number; loans: number; createdAt?: Date }): Promise<Uint8Array> {
  return build(templateRows(options.years, options.loans), 'template', options.createdAt ?? new Date());
}
