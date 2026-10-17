/**
 * Workbook → plan (import). Safety rules (US-1005):
 * - Rejects macro-enabled/legacy files (.xlsm, .xlsb, .xls, vbaProject.bin) and any formula in a data
 *   sheet, with guidance; formulas are never evaluated and cached results are never used.
 * - Reads every populated row up to each sheet's last row (not just the table size); fully blank rows
 *   (or rows with only an ID) are ignored.
 * - Validates types, ranges, dates, unique IDs and references here, then the whole plan with the same
 *   validation as JSON import. Errors name sheet, row and column. Nothing is saved here.
 */
import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import type { CostItem, LifeEvent, OverrideValue, PlannerDocument, PlannerLoan, PlannerPlan, PlannerYear, RequiredPaymentTerms, Resource, Scenario } from '../../../src/engine/planner-contracts';
import { schoolYearRanges } from '../../../src/engine/plan';
import { academicYearOfSchoolYear, isAcademicYear, UNASSIGNED_ACADEMIC_YEAR } from '../../../src/engine/academicYear';
import { validDate } from '../../../src/engine/dates';
import { dateInRange } from '../../../src/data/validation';
import { checkDocument } from '../planDocument';
import { BODY_LIMIT_BYTES } from '../config';
import { DATA_SHEETS, WORKBOOK_PLAN_SCHEMA_VERSION, WORKBOOK_SCHEMA, sheetSpecs, type ColumnSpec, type SheetName, type SheetSpec } from './schema';
import { strategyOptions } from './write';

export interface WorkbookIssue { sheet: string; row: number | null; column: string | null; message: string }
export type WorkbookCounts = Record<'schoolYears' | 'costs' | 'resources' | 'loans' | 'lifeEvents' | 'scenarios' | 'scenarioOverrides' | 'customOrder', number>;
export type ReadResult =
  | { ok: true; document: PlannerDocument; counts: WorkbookCounts }
  | { ok: false; errors: WorkbookIssue[]; counts: Partial<WorkbookCounts> };

const MAX_ISSUES = 200;
const MAX_ROWS_PER_SHEET = 20_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const FORBIDDEN_IDS = new Set(['__proto__', 'prototype', 'constructor']);

const fileIssue = (message: string): ReadResult => ({ ok: false, errors: [{ sheet: '', row: null, column: null, message }], counts: {} });

/** Raw cell content after unwrapping rich text/hyperlinks. `formula` marks formula cells. */
type Raw = { kind: 'blank' } | { kind: 'string'; value: string } | { kind: 'number'; value: number } | { kind: 'boolean'; value: boolean }
  | { kind: 'date'; value: Date } | { kind: 'formula' } | { kind: 'error' };

function rawOf(cell: ExcelJS.Cell): Raw {
  const value = cell.value as unknown;
  if (cell.formula || (cell as { sharedFormula?: string }).sharedFormula || cell.type === ExcelJS.ValueType.Formula) return { kind: 'formula' };
  if (value === null || value === undefined) return { kind: 'blank' };
  if (typeof value === 'string') return value.trim() === '' ? { kind: 'blank' } : { kind: 'string', value };
  if (typeof value === 'number') return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'error' };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? { kind: 'error' } : { kind: 'date', value };
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if ('formula' in object || 'sharedFormula' in object) return { kind: 'formula' };
    if ('error' in object) return { kind: 'error' };
    if (Array.isArray(object.richText)) {
      const text = (object.richText as Array<{ text?: unknown }>).map(part => String(part.text ?? '')).join('');
      return text.trim() === '' ? { kind: 'blank' } : { kind: 'string', value: text };
    }
    if ('text' in object) {
      const text = String(object.text ?? '');
      return text.trim() === '' ? { kind: 'blank' } : { kind: 'string', value: text };
    }
  }
  return { kind: 'error' };
}

/** Undo the export escape: one leading apostrophe is removed. */
const unescapeText = (value: string): string => (value.startsWith("'") ? value.slice(1) : value);

type Parsed<T> = { ok: true; value: T | undefined } | { ok: false; message: string };
const ok = <T>(value: T | undefined): Parsed<T> => ({ ok: true, value });
const bad = <T>(message: string): Parsed<T> => ({ ok: false, message });

function decimalText(raw: Raw, places: number, symbol: '$' | '%' | null): Parsed<Decimal> {
  let text: string;
  if (raw.kind === 'number') text = String(raw.value);
  else if (raw.kind === 'string') {
    text = unescapeText(raw.value).trim();
    if (symbol === '$' && text.startsWith('$')) text = text.slice(1).trim();
    if (symbol === '%' && text.endsWith('%')) text = text.slice(0, -1).trim();
    if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(text)) text = text.replaceAll(',', '');
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(text)) return bad('Enter a number using digits only, like 1250.50.');
  } else if (raw.kind === 'blank') return ok(undefined);
  else return bad('Enter a number.');
  if (text.length > 40) return bad('That number is too long.');
  let number: Decimal;
  try {
    number = new Decimal(text);
  } catch {
    return bad('Enter a number.');
  }
  if (!number.isFinite()) return bad('Enter a number.');
  if (number.isNegative()) return bad('Enter a number that is zero or more.');
  if (number.decimalPlaces() > places) return bad(places === 2 ? 'Use at most 2 decimal places.' : `Use at most ${places} decimal places.`);
  return ok(number);
}

function parseCell(column: ColumnSpec, raw: Raw): Parsed<string | number | boolean> {
  if (raw.kind === 'formula') return bad('Formulas are not allowed. Replace the formula with its value (copy, then Paste Values).');
  if (raw.kind === 'error') return bad('This cell contains an error or an unsupported value.');
  if (raw.kind === 'blank') return ok(undefined);
  switch (column.kind) {
    case 'money': {
      const result = decimalText(raw, 2, '$');
      return result.ok ? ok(result.value?.toFixed(2)) : result;
    }
    case 'percent':
    case 'quantity': {
      const result = decimalText(raw, 8, column.kind === 'percent' ? '%' : null);
      return result.ok ? ok(result.value?.toFixed()) : result;
    }
    case 'ratePercent': {
      const result = decimalText(raw, 10, '%');
      if (!result.ok) return result;
      if (result.value?.gt(30)) return bad('Enter a rate from 0% to 30% (6.53 means 6.53%).');
      return ok(result.value?.div(100).toFixed());
    }
    case 'integer': {
      if (raw.kind === 'number') return Number.isInteger(raw.value) ? ok(raw.value) : bad('Enter a whole number.');
      if (raw.kind === 'string' && /^-?\d{1,9}$/.test(unescapeText(raw.value).trim())) return ok(Number(unescapeText(raw.value).trim()));
      return bad('Enter a whole number.');
    }
    case 'date':
    case 'derived': {
      if (raw.kind === 'date') {
        const iso = raw.value.toISOString().slice(0, 10);
        return dateInRange(iso) ? ok(iso) : bad('Enter a date between 1900 and 2199.');
      }
      if (raw.kind === 'string') {
        const text = unescapeText(raw.value).trim();
        if (column.kind === 'derived' && !/^\d{4}-\d{2}-\d{2}$/.test(text)) return ok(text);
        if (!validDate(text)) return bad('Enter the date as YYYY-MM-DD, for example 2026-08-24.');
        return dateInRange(text) ? ok(text) : bad('Enter a date between 1900 and 2199.');
      }
      return bad('Enter the date as text YYYY-MM-DD (for example 2026-08-24), not a number.');
    }
    case 'boolean': {
      if (raw.kind === 'boolean') return ok(raw.value);
      const text = raw.kind === 'string' ? unescapeText(raw.value).trim().toLowerCase() : raw.kind === 'number' ? String(raw.value) : '';
      if (['yes', 'y', 'true', '1'].includes(text)) return ok(true);
      if (['no', 'n', 'false', '0'].includes(text)) return ok(false);
      return bad('Enter yes or no.');
    }
    case 'enum': {
      const text = raw.kind === 'string' ? unescapeText(raw.value).trim() : raw.kind === 'number' ? String(raw.value) : '';
      const match = column.options?.find(option => option.toLowerCase() === text.toLowerCase());
      return match ? ok(match) : bad(`Choose one of: ${column.options?.join(', ')}.`);
    }
    case 'academicYear': {
      const text = raw.kind === 'string' ? unescapeText(raw.value).trim().replace('–', '-') : '';
      if (text.toLowerCase() === UNASSIGNED_ACADEMIC_YEAR) return ok(UNASSIGNED_ACADEMIC_YEAR);
      return isAcademicYear(text) ? ok(text) : bad('Enter an academic year such as 2026-2027, or unassigned.');
    }
    case 'id':
    case 'ref': {
      const text = raw.kind === 'string' ? unescapeText(raw.value).trim() : raw.kind === 'number' ? String(raw.value) : '';
      return ID_PATTERN.test(text) && !FORBIDDEN_IDS.has(text) ? ok(text) : bad('IDs use letters, digits, - and _ only (at most 100 characters).');
    }
    case 'overrideValue':
      if (raw.kind === 'string') return ok(unescapeText(raw.value));
      if (raw.kind === 'number') return ok(raw.value);
      if (raw.kind === 'boolean') return ok(raw.value);
      return ok(raw.value.toISOString().slice(0, 10));
    case 'text':
    default:
      if (raw.kind === 'string') return ok(unescapeText(raw.value));
      if (raw.kind === 'number') return ok(String(raw.value));
      if (raw.kind === 'boolean') return ok(raw.value ? 'yes' : 'no');
      return ok(raw.value.toISOString().slice(0, 10));
  }
}

interface Row { row: number; values: Record<string, string | number | boolean | undefined> }
interface Location { sheet: SheetName; row: number; column: string | null }

class Reader {
  issues: WorkbookIssue[] = [];
  /** Field path (or record path) → cell, to place plan-validation errors. */
  locations = new Map<string, Location>();
  fail(sheet: string, row: number | null, column: string | null, message: string): void {
    if (this.issues.length < MAX_ISSUES) this.issues.push({ sheet, row, column, message });
  }
  at(path: string, sheet: SheetName, row: number, column: string | null): void {
    this.locations.set(path, { sheet, row, column });
  }
  locate(path: string): Location | undefined {
    for (let parts = path.split('.'); parts.length; parts = parts.slice(0, -1)) {
      const found = this.locations.get(parts.join('.'));
      if (found) return found;
    }
    return undefined;
  }
}

function readSheet(reader: Reader, sheet: ExcelJS.Worksheet, spec: SheetSpec): Row[] | null {
  const headerRow = sheet.getRow(1);
  const columnIndex = new Map<string, number>();
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const raw = rawOf(cell);
    if (raw.kind === 'string') columnIndex.set(raw.value.trim().toLowerCase(), col);
  });
  const missing = spec.columns.filter(column => !columnIndex.has(column.header.toLowerCase()));
  for (const column of missing) reader.fail(spec.name, 1, column.header, `The column "${column.header}" is missing. Use the DebtNav template headers.`);
  if (missing.length) return null;

  const lastRow = sheet.rowCount;
  if (lastRow - 1 > MAX_ROWS_PER_SHEET) {
    reader.fail(spec.name, null, null, `This sheet has more than ${MAX_ROWS_PER_SHEET} rows.`);
    return null;
  }
  // Formulas anywhere in a data sheet are rejected, including columns DebtNav does not read.
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      if (rawOf(cell).kind === 'formula') {
        const header = [...columnIndex.entries()].find(([, index]) => index === col)?.[0] ?? null;
        const column = spec.columns.find(c => c.header.toLowerCase() === header)?.header ?? header ?? sheet.getColumn(col).letter;
        reader.fail(spec.name, rowNumber, column, 'Formulas are not allowed in DebtNav workbooks. Replace the formula with its value (copy, then Paste Values) and import again.');
      }
    });
  });

  const rows: Row[] = [];
  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
    const excelRow = sheet.getRow(rowNumber);
    const raws = spec.columns.map(column => rawOf(excelRow.getCell(columnIndex.get(column.header.toLowerCase())!)));
    // A row counts only when a non-ID cell is filled (template rows come with prefilled IDs).
    const meaningful = spec.columns.some((column, i) => raws[i].kind !== 'blank' && (column.kind !== 'id' || spec.name === 'SchoolYears'));
    if (!meaningful) continue;
    const values: Row['values'] = {};
    spec.columns.forEach((column, i) => {
      const parsed = parseCell(column, raws[i]);
      if (!parsed.ok) {
        if (raws[i].kind !== 'formula') reader.fail(spec.name, rowNumber, column.header, parsed.message);
        return;
      }
      values[column.header] = parsed.value;
    });
    rows.push({ row: rowNumber, values });
  }
  return rows;
}

function requireValues(reader: Reader, spec: SheetSpec, row: Row, headers: string[]): boolean {
  let complete = true;
  for (const header of headers) {
    if (row.values[header] === undefined) {
      // A cell that failed to parse is already reported; only report truly blank required cells.
      if (!reader.issues.some(issue => issue.sheet === spec.name && issue.row === row.row && issue.column === header)) {
        reader.fail(spec.name, row.row, header, 'This value is required.');
      }
      complete = false;
    }
  }
  return complete;
}

/** Assign IDs: keep given ones (reporting duplicates), create unique ones for blanks. */
function assignIds(reader: Reader, spec: SheetSpec, rows: Row[], header: string, prefix: string): Map<Row, string> {
  const ids = new Map<Row, string>();
  const used = new Set<string>();
  for (const row of rows) {
    const id = row.values[header];
    if (typeof id !== 'string') continue;
    if (used.has(id)) reader.fail(spec.name, row.row, header, `The ID "${id}" is used more than once on this sheet.`);
    else { used.add(id); ids.set(row, id); }
  }
  let counter = 1;
  for (const row of rows) {
    if (ids.has(row) || typeof row.values[header] === 'string') continue;
    while (used.has(`${prefix}-${counter}`)) counter++;
    const id = `${prefix}-${counter}`;
    used.add(id);
    ids.set(row, id);
  }
  return ids;
}

const str = (value: unknown): string => value as string;
const optStr = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const optNum = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
const optBool = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

function single(reader: Reader, spec: SheetSpec, rows: Row[]): Row | null {
  if (rows.length === 0) {
    reader.fail(spec.name, 2, null, `Fill in row 2 of the ${spec.name} sheet.`);
    return null;
  }
  for (const extra of rows.slice(1)) reader.fail(spec.name, extra.row, null, `The ${spec.name} sheet holds one row; remove this row.`);
  return rows[0];
}

function buildDocument(reader: Reader, sheets: Record<SheetName, Row[]>, specs: Record<SheetName, SheetSpec>): { document: PlannerDocument; counts: WorkbookCounts } | null {
  // ---- Settings
  const settingsRow = single(reader, specs.Settings, sheets.Settings);
  if (!settingsRow || !requireValues(reader, specs.Settings, settingsRow, ['startDate', 'graduationDate'])) return null;
  const startDate = str(settingsRow.values.startDate);
  const graduationDate = str(settingsRow.values.graduationDate);
  for (const column of ['startDate', 'graduationDate']) reader.at(`settings.${column}`, 'Settings', settingsRow.row, column);
  const ranges = schoolYearRanges(startDate, graduationDate);
  if (!ranges.ok) {
    for (const [key, message] of Object.entries(ranges.errors)) reader.fail('Settings', settingsRow.row, key, message);
    return null;
  }

  // ---- School years (ordinal)
  const yearRows = sheets.SchoolYears;
  const yearIds = assignIds(reader, specs.SchoolYears, yearRows, 'yearId', 'year');
  if (yearRows.length > ranges.ranges.length) {
    for (const row of yearRows.slice(ranges.ranges.length)) {
      reader.fail('SchoolYears', row.row, null, `Settings dates give ${ranges.ranges.length} school year(s), so this row has no school year. Remove it or change startDate/graduationDate.`);
    }
  }
  const years: PlannerYear[] = [];
  const usedYearIds = new Set<string>();
  ranges.ranges.forEach((range, index) => {
    const row = yearRows[index];
    let id = row ? yearIds.get(row) : undefined;
    if (!id) {
      for (let n = index + 1; !id || usedYearIds.has(id) || [...yearIds.values()].includes(id); n++) id = `year-${n}`;
    }
    usedYearIds.add(id);
    const year: PlannerYear = { id, startDate: range.startDate, endDate: range.endDate, costItems: [], resources: [], bufferPercent: '0' };
    if (row) {
      reader.at(`schoolYears.${id}`, 'SchoolYears', row.row, null);
      reader.at(`schoolYears.${id}.bufferPercent`, 'SchoolYears', row.row, 'bufferPercent');
      if (row.values.bufferPercent !== undefined) year.bufferPercent = str(row.values.bufferPercent);
      const expected: Record<string, string> = { startDate: range.startDate, endDate: range.endDate, academicYear: academicYearOfSchoolYear(range) };
      for (const [column, value] of Object.entries(expected)) {
        const given = row.values[column];
        if (given !== undefined && String(given).replace('–', '-') !== value) {
          reader.fail('SchoolYears', row.row, column, `This school year's ${column} is calculated from Settings as ${value}. Leave it blank or enter ${value}.`);
        }
      }
    }
    years.push(year);
  });
  const yearById = new Map(years.map(year => [year.id, year]));
  const checkYearRef = (sheet: SheetName, row: Row, column: string, required: boolean): PlannerYear | null | undefined => {
    const ref = row.values[column];
    if (ref === undefined) {
      if (required) requireValues(reader, specs[sheet], row, [column]);
      return undefined;
    }
    const year = yearById.get(str(ref));
    if (!year) reader.fail(sheet, row.row, column, `No school year has the ID "${String(ref)}" (see the SchoolYears sheet).`);
    return year ?? null;
  };

  // ---- Costs
  const costIds = assignIds(reader, specs.Costs, sheets.Costs, 'costId', 'cost');
  for (const row of sheets.Costs) {
    const year = checkYearRef('Costs', row, 'yearId', true);
    const complete = requireValues(reader, specs.Costs, row, ['category', 'label', 'amount']);
    const id = costIds.get(row);
    if (!year || !complete || !id) continue;
    if (year.costItems.some(item => item.id === id)) continue;
    const item: CostItem = { id, category: str(row.values.category) as CostItem['category'], label: str(row.values.label), amount: str(row.values.amount), semester: (optStr(row.values.period) ?? 'annual') as CostItem['semester'] };
    const path = `schoolYears.${year.id}.costItems.${id}`;
    reader.at(path, 'Costs', row.row, null);
    for (const [field, column] of [['category', 'category'], ['label', 'label'], ['amount', 'amount'], ['semester', 'period']]) reader.at(`${path}.${field}`, 'Costs', row.row, column);
    year.costItems.push(item);
  }

  // ---- Resources
  const resourceIds = assignIds(reader, specs.Resources, sheets.Resources, 'resourceId', 'resource');
  for (const row of sheets.Resources) {
    const year = checkYearRef('Resources', row, 'yearId', true);
    const mode = (optStr(row.values.incomeMode) ?? 'fixed') as Resource['incomeMode'];
    const hourly = mode === 'hourly';
    const complete = requireValues(reader, specs.Resources, row, ['type', 'label', ...(hourly ? ['hourlyWage', 'hoursPerWeek', 'weeksWorked'] : ['amount'])]);
    const id = resourceIds.get(row);
    if (!year || !complete || !id) continue;
    const resource: Resource = {
      id, type: str(row.values.type) as Resource['type'], label: str(row.values.label), incomeMode: mode,
      amount: optStr(row.values.amount) ?? '0.00', hourlyWage: optStr(row.values.hourlyWage) ?? '0.00',
      hoursPerWeek: optStr(row.values.hoursPerWeek) ?? '0', weeksWorked: optStr(row.values.weeksWorked) ?? '0',
      unavailablePercent: optStr(row.values.unavailablePercent) ?? '0',
    };
    const path = `schoolYears.${year.id}.resources.${id}`;
    reader.at(path, 'Resources', row.row, null);
    for (const field of ['type', 'label', 'incomeMode', 'amount', 'hourlyWage', 'hoursPerWeek', 'weeksWorked', 'unavailablePercent']) reader.at(`${path}.${field}`, 'Resources', row.row, field);
    year.resources.push(resource);
  }

  // ---- Loans
  const loanIds = assignIds(reader, specs.Loans, sheets.Loans, 'loanId', 'loan');
  const loans: PlannerLoan[] = [];
  for (const row of sheets.Loans) {
    const complete = requireValues(reader, specs.Loans, row, ['name', 'type', 'principal', 'ratePercent', 'disbursementDate', 'termMonths']);
    const yearRef = checkYearRef('Loans', row, 'schoolYearId', false);
    const id = loanIds.get(row);
    if (!complete || !id || yearRef === null) continue;
    const loan: PlannerLoan = {
      id, name: str(row.values.name), type: str(row.values.type) as PlannerLoan['type'], principal: str(row.values.principal),
      annualRate: str(row.values.ratePercent), disbursementDate: str(row.values.disbursementDate), termMonths: row.values.termMonths as number,
    };
    const optional: Array<[keyof PlannerLoan, unknown]> = [
      ['payInterestWhileInSchool', optBool(row.values.payInterestWhileInSchool)], ['accruesInterestInSchool', optBool(row.values.accruesInterestInSchool)],
      ['monthlyPayment', optStr(row.values.monthlyPayment)], ['schoolYearId', yearRef?.id], ['academicYear', optStr(row.values.academicYear)],
      ['gapAtCreation', optStr(row.values.gapAtCreation)], ['capitalizeInterest', optBool(row.values.capitalizeInterest)],
    ];
    for (const [key, value] of optional) if (value !== undefined) (loan as unknown as Record<string, unknown>)[key] = value;
    const terms: RequiredPaymentTerms = {};
    if (optStr(row.values.firstDueDate) !== undefined) terms.firstDueDate = optStr(row.values.firstDueDate);
    if (optNum(row.values.graceMonths) !== undefined) terms.graceMonths = optNum(row.values.graceMonths);
    if (optBool(row.values.inSchoolPayments) !== undefined) terms.inSchoolPayments = optBool(row.values.inSchoolPayments);
    if (Object.keys(terms).length) loan.requiredPayment = terms;
    const path = `loans.${id}`;
    reader.at(path, 'Loans', row.row, null);
    for (const column of specs.Loans.columns) {
      const field = column.header === 'ratePercent' ? 'annualRate' : column.header === 'loanId' ? 'id'
        : ['firstDueDate', 'graceMonths', 'inSchoolPayments'].includes(column.header) ? `requiredPayment.${column.header}` : column.header;
      reader.at(`${path}.${field}`, 'Loans', row.row, column.header);
    }
    loans.push(loan);
  }
  const loanIdSet = new Set(loans.map(loan => loan.id));
  const allLoanIds = new Set(loanIds.values());

  // ---- Repayment plan
  const repaymentRow = single(reader, specs.RepaymentPlan, sheets.RepaymentPlan);
  if (!repaymentRow) return null;
  const rv = repaymentRow.values;
  const payoffMode = optStr(rv.payoffMode);
  const startKind = optStr(rv.voluntaryStartKind);
  const needed = ['annualSalary', 'monthlyDebtBudget', 'raiseAllocationPercent', 'strategyId', 'payoffMode', 'voluntaryStartKind'];
  if (payoffMode === 'date') needed.push('payoffDate');
  if (payoffMode === 'duration') needed.push('payoffMonths');
  if (startKind === 'afterGraduation') needed.push('voluntaryStartMonths');
  if (startKind === 'date') needed.push('voluntaryStartDate');
  const repaymentComplete = requireValues(reader, specs.RepaymentPlan, repaymentRow, needed);
  const repaymentPaths: Record<string, string> = {
    'postGradIncome.annualSalary': 'annualSalary', 'postGradIncome.monthlyTakeHome': 'monthlyTakeHome', 'postGradIncome.monthlyExpenses': 'monthlyExpenses',
    'postGradIncome.monthlyDebtBudget': 'monthlyDebtBudget', 'postGradIncome.raiseAllocationPercent': 'raiseAllocationPercent',
    'repayment.strategyId': 'strategyId', 'repayment.extraMonthlyPayment': 'extraMonthlyPayment', 'repayment.payoffTarget': 'payoffMode',
    'repayment.payoffTarget.date': 'payoffDate', 'repayment.payoffTarget.months': 'payoffMonths', 'repayment.voluntaryStart': 'voluntaryStartKind',
    'repayment.voluntaryStart.months': 'voluntaryStartMonths', 'repayment.voluntaryStart.date': 'voluntaryStartDate', 'repayment.mode': 'federalMode',
    'repayment.federalPlan': 'federalPlan', 'repayment.familySize': 'familySize', 'repayment.annualAGI': 'annualAGI',
    'borrower.dependency': 'dependency', 'borrower.level': 'level', 'borrower.priorFederalDebt': 'priorFederalDebt', 'repayment': 'strategyId',
  };
  for (const [path, column] of Object.entries(repaymentPaths)) reader.at(path, 'RepaymentPlan', repaymentRow.row, column);

  // ---- Life events
  const eventIds = assignIds(reader, specs.LifeEvents, sheets.LifeEvents, 'eventId', 'event');
  const lifeEvents: LifeEvent[] = [];
  for (const row of sheets.LifeEvents) {
    const complete = requireValues(reader, specs.LifeEvents, row, ['name', 'date', 'type', 'amount', 'allocationPercent']);
    const year = checkYearRef('LifeEvents', row, 'yearId', false);
    const id = eventIds.get(row);
    if (!complete || !id || year === null) continue;
    const event: LifeEvent = {
      id, name: str(row.values.name), date: str(row.values.date), type: str(row.values.type) as LifeEvent['type'],
      amount: str(row.values.amount), allocationPercent: str(row.values.allocationPercent),
    };
    if (year) event.schoolYearId = year.id;
    if (optStr(row.values.recurrence)) event.recurrence = optStr(row.values.recurrence) as LifeEvent['recurrence'];
    if (optStr(row.values.recurrenceEndDate)) event.recurrenceEndDate = optStr(row.values.recurrenceEndDate);
    const path = `lifeEvents.${id}`;
    reader.at(path, 'LifeEvents', row.row, null);
    for (const column of specs.LifeEvents.columns) reader.at(`${path}.${column.header === 'yearId' ? 'schoolYearId' : column.header}`, 'LifeEvents', row.row, column.header);
    lifeEvents.push(event);
  }

  // ---- Scenarios + overrides
  const scenarioIds = assignIds(reader, specs.Scenarios, sheets.Scenarios, 'scenarioId', 'scenario');
  const scenarios: Scenario[] = [];
  for (const row of sheets.Scenarios) {
    const complete = requireValues(reader, specs.Scenarios, row, ['name']);
    const id = scenarioIds.get(row);
    if (!complete || !id) continue;
    reader.at(`scenarios.${id}`, 'Scenarios', row.row, null);
    reader.at(`scenarios.${id}.name`, 'Scenarios', row.row, 'name');
    scenarios.push({ id, name: str(row.values.name), overrides: {} });
  }
  const scenarioById = new Map(scenarios.map(scenario => [scenario.id, scenario]));
  const allScenarioIds = new Set(scenarioIds.values());
  let overrideCount = 0;
  for (const row of sheets.ScenarioOverrides) {
    if (!requireValues(reader, specs.ScenarioOverrides, row, ['scenarioId', 'fieldPath', 'valueType', 'value'])) continue;
    const scenarioId = str(row.values.scenarioId);
    const scenario = scenarioById.get(scenarioId);
    if (!scenario) {
      if (!allScenarioIds.has(scenarioId)) reader.fail('ScenarioOverrides', row.row, 'scenarioId', `No scenario has the ID "${scenarioId}" (see the Scenarios sheet).`);
      continue;
    }
    const fieldPath = str(row.values.fieldPath).trim();
    if (Object.hasOwn(scenario.overrides, fieldPath)) {
      reader.fail('ScenarioOverrides', row.row, 'fieldPath', `Scenario "${scenarioId}" already changes ${fieldPath}.`);
      continue;
    }
    const raw = row.values.value;
    let value: OverrideValue | undefined;
    switch (row.values.valueType) {
      case 'number': {
        const numberValue = typeof raw === 'number' ? raw : typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
        if (Number.isFinite(numberValue)) value = numberValue;
        break;
      }
      case 'boolean':
        if (typeof raw === 'boolean') value = raw;
        else if (typeof raw === 'string' && ['yes', 'no', 'true', 'false'].includes(raw.trim().toLowerCase())) value = ['yes', 'true'].includes(raw.trim().toLowerCase());
        break;
      default:
        value = typeof raw === 'string' ? raw : String(raw);
    }
    if (value === undefined) {
      reader.fail('ScenarioOverrides', row.row, 'value', `This value does not match valueType "${String(row.values.valueType)}".`);
      continue;
    }
    scenario.overrides[fieldPath] = value;
    reader.at(`scenarios.${scenarioId}.overrides.${fieldPath}`, 'ScenarioOverrides', row.row, 'value');
    overrideCount++;
  }
  for (const scenario of scenarios) {
    if (!reader.locations.has(`scenarios.${scenario.id}.overrides`)) reader.at(`scenarios.${scenario.id}.overrides`, 'Scenarios', reader.locations.get(`scenarios.${scenario.id}`)!.row, null);
  }

  // ---- Custom order
  const ordered: Array<{ position: number; loanId: string; row: number }> = [];
  const positions = new Set<number>();
  for (const row of sheets.CustomOrder) {
    if (!requireValues(reader, specs.CustomOrder, row, ['position', 'loanId'])) continue;
    const position = row.values.position as number;
    const loanId = str(row.values.loanId);
    if (position < 1) { reader.fail('CustomOrder', row.row, 'position', 'Positions start at 1.'); continue; }
    if (positions.has(position)) { reader.fail('CustomOrder', row.row, 'position', `Position ${position} is used more than once.`); continue; }
    if (!allLoanIds.has(loanId)) { reader.fail('CustomOrder', row.row, 'loanId', `No loan has the ID "${loanId}" (see the Loans sheet).`); continue; }
    if (ordered.some(entry => entry.loanId === loanId)) { reader.fail('CustomOrder', row.row, 'loanId', `Loan "${loanId}" is listed more than once.`); continue; }
    positions.add(position);
    ordered.push({ position, loanId, row: row.row });
  }
  ordered.sort((a, b) => a.position - b.position);
  if (ordered[0]) reader.at('repayment.customOrder', 'CustomOrder', ordered[0].row, 'loanId');

  if (!repaymentComplete) return null;
  const plan: PlannerPlan = {
    settings: { startDate, graduationDate, currency: 'USD' },
    schoolYears: years,
    loans,
    postGradIncome: {
      annualSalary: str(rv.annualSalary), monthlyDebtBudget: str(rv.monthlyDebtBudget), raiseAllocationPercent: str(rv.raiseAllocationPercent),
      ...(optStr(rv.monthlyTakeHome) !== undefined ? { monthlyTakeHome: optStr(rv.monthlyTakeHome) } : {}),
      ...(optStr(rv.monthlyExpenses) !== undefined ? { monthlyExpenses: optStr(rv.monthlyExpenses) } : {}),
    },
    repayment: {
      strategyId: str(rv.strategyId),
      extraMonthlyPayment: optStr(rv.extraMonthlyPayment) ?? '0.00',
      customOrder: ordered.map(entry => entry.loanId).filter(loanId => loanIdSet.has(loanId)),
      payoffTarget: payoffMode === 'date' ? { mode: 'target', kind: 'date', date: str(rv.payoffDate) }
        : payoffMode === 'duration' ? { mode: 'target', kind: 'duration', months: rv.payoffMonths as number } : { mode: 'budget' },
      voluntaryStart: startKind === 'date' ? { kind: 'date', date: str(rv.voluntaryStartDate) } : { kind: 'afterGraduation', months: rv.voluntaryStartMonths as number },
      mode: (optStr(rv.federalMode) ?? 'standard') as PlannerPlan['repayment']['mode'],
      federalPlan: (optStr(rv.federalPlan) ?? 'rap') as PlannerPlan['repayment']['federalPlan'],
      familySize: optNum(rv.familySize) ?? 1,
      annualAGI: optStr(rv.annualAGI) ?? '0.00',
    },
    lifeEvents,
    scenarios,
    borrower: {
      dependency: (optStr(rv.dependency) ?? 'dependent') as PlannerPlan['borrower']['dependency'],
      level: (optStr(rv.level) ?? 'undergraduate') as PlannerPlan['borrower']['level'],
      priorFederalDebt: optStr(rv.priorFederalDebt) ?? '0.00',
    },
  };
  const counts: WorkbookCounts = {
    schoolYears: years.length,
    costs: years.reduce((total, year) => total + year.costItems.length, 0),
    resources: years.reduce((total, year) => total + year.resources.length, 0),
    loans: loans.length, lifeEvents: lifeEvents.length, scenarios: scenarios.length,
    scenarioOverrides: overrideCount, customOrder: ordered.length,
  };
  return { document: { plan, disclaimerDismissed: optBool(settingsRow.values.disclaimerDismissed) ?? false }, counts };
}

/** True when the bytes look like a zip (xlsx) container. */
const isZip = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
const isOle = (bytes: Uint8Array) => bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;

/** Zip entry names are stored uncompressed, so a byte search finds macro parts without unzipping. */
function containsAscii(bytes: Uint8Array, text: string): boolean {
  const needle = Buffer.from(text, 'latin1');
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(needle);
}

export async function readWorkbook(bytes: Uint8Array, filename = 'workbook.xlsx'): Promise<ReadResult> {
  const lower = filename.toLowerCase();
  if (bytes.byteLength > BODY_LIMIT_BYTES) return fileIssue('The file is larger than the 5 MB import limit.');
  if (/\.(xlsm|xltm|xlam|xlsb)$/.test(lower) || containsAscii(bytes, 'vbaProject.bin') || containsAscii(bytes, 'macroEnabled')) {
    return fileIssue('Macro-enabled workbooks are not accepted. In Excel use File → Save As → "Excel Workbook (*.xlsx)" and import that file.');
  }
  if (isOle(bytes) || lower.endsWith('.xls')) return fileIssue('This is an older Excel (.xls) file. Save it as "Excel Workbook (*.xlsx)" and import that file.');
  if (!isZip(bytes)) return fileIssue('This file is not an Excel workbook (.xlsx). Download the DebtNav template or export and fill that in.');

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as unknown as ArrayBuffer);
  } catch {
    return fileIssue('The workbook could not be read. Make sure it is an .xlsx file saved by Excel, Google Sheets or LibreOffice.');
  }

  const reader = new Reader();
  // ---- Metadata / version
  const meta = workbook.getWorksheet('Metadata');
  if (!meta) return fileIssue('This workbook has no Metadata sheet, so it is not a DebtNav workbook. Start from the DebtNav template or an export.');
  const metadata = new Map<string, Raw>();
  meta.eachRow({ includeEmpty: false }, row => {
    const key = rawOf(row.getCell(1));
    if (key.kind === 'string') metadata.set(key.value.trim(), rawOf(row.getCell(2)));
  });
  if ([...metadata.values()].some(raw => raw.kind === 'formula')) return fileIssue('Formulas are not allowed on the Metadata sheet.');
  const schema = metadata.get('workbookSchema');
  if (!schema || schema.kind !== 'string') return fileIssue('The Metadata sheet does not name a workbook schema. Start from the DebtNav template or an export.');
  if (schema.value.trim() !== WORKBOOK_SCHEMA) {
    return fileIssue(`This workbook uses schema "${schema.value.trim()}", which this version of DebtNav cannot import (it reads ${WORKBOOK_SCHEMA}).`);
  }
  const version = metadata.get('planSchemaVersion');
  const versionNumber = version?.kind === 'number' ? version.value : version?.kind === 'string' ? Number(version.value) : NaN;
  if (versionNumber !== WORKBOOK_PLAN_SCHEMA_VERSION) {
    return fileIssue(versionNumber > WORKBOOK_PLAN_SCHEMA_VERSION
      ? 'This workbook was made by a newer version of DebtNav. Update DebtNav to import it.'
      : `This workbook's plan schema version is not supported (expected ${WORKBOOK_PLAN_SCHEMA_VERSION}).`);
  }

  // ---- Data sheets
  const specList = sheetSpecs(strategyOptions());
  const specs = Object.fromEntries(specList.map(spec => [spec.name, spec])) as Record<SheetName, SheetSpec>;
  const sheets = {} as Record<SheetName, Row[]>;
  for (const name of DATA_SHEETS) {
    const sheet = workbook.getWorksheet(name);
    if (!sheet) {
      reader.fail(name, null, null, `The ${name} sheet is missing. Start from the DebtNav template or an export.`);
      sheets[name] = [];
      continue;
    }
    sheets[name] = readSheet(reader, sheet, specs[name]) ?? [];
  }
  const partialCounts = (): Partial<WorkbookCounts> => ({
    schoolYears: sheets.SchoolYears.length, costs: sheets.Costs.length, resources: sheets.Resources.length, loans: sheets.Loans.length,
    lifeEvents: sheets.LifeEvents.length, scenarios: sheets.Scenarios.length, scenarioOverrides: sheets.ScenarioOverrides.length,
    customOrder: sheets.CustomOrder.length,
  });
  const built = reader.issues.length && reader.issues.some(issue => issue.row === 1 || issue.row === null) ? null : buildDocument(reader, sheets, specs);
  if (!built || reader.issues.length) {
    if (!reader.issues.length) reader.fail('', null, null, 'The workbook could not be imported.');
    return { ok: false, errors: reader.issues, counts: built?.counts ?? partialCounts() };
  }

  // ---- Whole-plan validation (same rules as JSON import), errors mapped back to cells.
  const checked = checkDocument(built.document);
  if (!checked.ok) {
    for (const error of checked.errors) {
      const location = reader.locate(error.path);
      if (location) reader.fail(location.sheet, location.row, location.column, error.message);
      else reader.fail('', null, null, `${error.path}: ${error.message}`);
    }
    return { ok: false, errors: reader.issues, counts: built.counts };
  }
  return { ok: true, document: checked.document, counts: built.counts };
}
