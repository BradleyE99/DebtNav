/** Workbook facade: the only entry point routes use, so exceljs can be swapped behind it. */
export { writeTemplate, writeWorkbook, planToRows, escapeText } from './write';
export { readWorkbook, type ReadResult, type WorkbookIssue, type WorkbookCounts } from './read';
export { TEMPLATE_LIMITS, WORKBOOK_SCHEMA, WORKBOOK_PLAN_SCHEMA_VERSION } from './schema';
