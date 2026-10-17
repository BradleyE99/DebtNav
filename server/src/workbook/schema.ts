/**
 * Canonical workbook schema `debtnav-workbook-1` (plan schema 4). One sheet per record type, one row
 * per record, stable IDs and foreign-key columns (never year-numbered columns). This file is the
 * single description used by the writer, the reader and the Instructions sheet.
 */
export const WORKBOOK_SCHEMA = 'debtnav-workbook-1';
export const WORKBOOK_PLAN_SCHEMA_VERSION = 4;

export type ColumnKind =
  | 'id' | 'ref' | 'text' | 'money' | 'percent' | 'ratePercent' | 'quantity' | 'integer' | 'date' | 'enum' | 'boolean'
  | 'academicYear' | 'derived' | 'overrideValue';

export interface ColumnSpec {
  header: string;
  kind: ColumnKind;
  /** 'yes' | 'no' | text explaining when it is required. */
  required: string;
  options?: readonly string[];
  units?: string;
  /** What blank means for this column. */
  blank: string;
  note: string;
  example: string;
  width?: number;
}

export interface SheetSpec {
  name: SheetName;
  /** Single-row sheets hold one record (Settings, RepaymentPlan). */
  single: boolean;
  purpose: string;
  columns: ColumnSpec[];
}

export type SheetName = 'Settings' | 'SchoolYears' | 'Costs' | 'Resources' | 'Loans' | 'RepaymentPlan' | 'LifeEvents' | 'Scenarios' | 'ScenarioOverrides' | 'CustomOrder';

export const COST_CATEGORIES = ['tuition', 'fees', 'housing', 'food', 'books', 'transportation', 'personal', 'other'] as const;
export const COST_PERIODS = ['annual', 'fall', 'spring', 'summer'] as const;
export const RESOURCE_TYPES = ['grant', 'scholarship', 'job', 'savings', 'family', 'other'] as const;
export const LOAN_TYPES = ['subsidized', 'unsubsidized', 'private', 'other'] as const;
export const EVENT_TYPES = ['income', 'windfall', 'expense', 'aid'] as const;
export const YES_NO = ['yes', 'no'] as const;

const id = (header: string, what: string, example: string): ColumnSpec => ({
  header, kind: 'id', required: 'no', blank: 'An ID is created for you.',
  note: `Stable ID of this ${what} (letters, digits, - and _; at most 100). Other sheets refer to it. Keep it unchanged when editing.`, example,
});
const ref = (header: string, target: string, required: string, example: string, blank = 'Not set.'): ColumnSpec => ({
  header, kind: 'ref', required, blank, note: `Must match an ID on the ${target} sheet.`, example,
});
const money = (header: string, required: string, note: string, example: string, blank = required === 'yes' ? 'Not allowed (enter 0 for zero).' : 'Not set.'): ColumnSpec => ({
  header, kind: 'money', required, units: 'US dollars, up to 2 decimals', blank, note, example,
});
const percent = (header: string, note: string, example: string, blank = 'Means 0%.'): ColumnSpec => ({
  header, kind: 'percent', required: 'no', units: 'percent (5 = 5%)', blank, note, example,
});
const date = (header: string, required: string, note: string, example: string): ColumnSpec => ({
  header, kind: 'date', required, units: 'date as text YYYY-MM-DD', blank: required === 'yes' ? 'Not allowed.' : 'Not set.', note, example,
});
const bool = (header: string, note: string, blank: string): ColumnSpec => ({
  header, kind: 'boolean', required: 'no', options: YES_NO, blank, note, example: 'no',
});
const choice = (header: string, options: readonly string[], required: string, note: string, blank: string, example = options[0]): ColumnSpec => ({
  header, kind: 'enum', required, options, blank, note, example,
});
const int = (header: string, required: string, units: string, note: string, example: string, blank = required === 'yes' ? 'Not allowed.' : 'Not set.'): ColumnSpec => ({
  header, kind: 'integer', required, units, blank, note, example,
});
const text = (header: string, note: string, example: string): ColumnSpec => ({
  header, kind: 'text', required: 'yes', units: 'text, at most 200 characters', blank: 'Not allowed.', note, example,
});

export function sheetSpecs(strategyIds: readonly string[]): SheetSpec[] {
  return [
    {
      name: 'Settings', single: true, purpose: 'School dates for the plan (one row).',
      columns: [
        date('startDate', 'yes', 'First day of school. School years run from this date.', '2026-08-24'),
        date('graduationDate', 'yes', 'Expected graduation date.', '2030-05-20'),
        choice('currency', ['USD'], 'no', 'Only US dollars are supported.', 'Means USD.'),
        bool('disclaimerDismissed', 'Whether the planning disclaimer has been dismissed.', 'Means no.'),
      ],
    },
    {
      name: 'SchoolYears', single: false,
      purpose: 'One row per school year, in order (first row = first school year). The number of school years is calculated from Settings startDate and graduationDate; dates here are for reference.',
      columns: [
        id('yearId', 'school year', 'year-1'),
        { header: 'startDate', kind: 'derived', required: 'no', units: 'YYYY-MM-DD', blank: 'Calculated.', note: 'Calculated from Settings. If filled in, it must match the calculated date.', example: '2026-08-24' },
        { header: 'endDate', kind: 'derived', required: 'no', units: 'YYYY-MM-DD', blank: 'Calculated.', note: 'Calculated from Settings. If filled in, it must match the calculated date.', example: '2027-08-24' },
        { header: 'academicYear', kind: 'derived', required: 'no', units: 'YYYY-YYYY', blank: 'Calculated.', note: 'Academic year this school year represents (named by the calendar year it starts in). If filled in, it must match.', example: '2026-2027' },
        percent('bufferPercent', 'Safety buffer added to this year\'s funding gap.', '5'),
      ],
    },
    {
      name: 'Costs', single: false, purpose: 'Cost-of-attendance items, one row per item.',
      columns: [
        id('costId', 'cost item', 'cost-1'),
        ref('yearId', 'SchoolYears', 'yes', 'year-1', 'Not allowed.'),
        choice('category', COST_CATEGORIES, 'yes', 'Kind of cost.', 'Not allowed.', 'tuition'),
        text('label', 'Short description.', 'Tuition'),
        money('amount', 'yes', 'Cost for the period.', '12000'),
        choice('period', COST_PERIODS, 'no', 'annual counts once for the year; fall/spring/summer are semester entries summed into the year.', 'Means annual.'),
      ],
    },
    {
      name: 'Resources', single: false, purpose: 'Grants, scholarships, savings, family help and in-school jobs, one row per resource. Loans are never resources.',
      columns: [
        id('resourceId', 'resource', 'res-1'),
        ref('yearId', 'SchoolYears', 'yes', 'year-1', 'Not allowed.'),
        choice('type', RESOURCE_TYPES, 'yes', 'Kind of resource.', 'Not allowed.', 'grant'),
        text('label', 'Short description.', 'Pell Grant'),
        choice('incomeMode', ['fixed', 'hourly'], 'no', 'hourly (jobs only): wage × hours per week × weeks worked; otherwise amount is used.', 'Means fixed.', 'fixed'),
        money('amount', 'yes when incomeMode is fixed', 'Annual amount.', '3000', 'Means 0 for hourly jobs; not allowed otherwise.'),
        money('hourlyWage', 'yes when incomeMode is hourly', 'Hourly wage.', '15', 'Means 0 for fixed amounts; not allowed for hourly jobs.'),
        { header: 'hoursPerWeek', kind: 'quantity', required: 'yes when incomeMode is hourly', units: 'hours (0–168)', blank: 'Means 0 for fixed amounts.', note: 'Hours worked per week.', example: '10' },
        { header: 'weeksWorked', kind: 'quantity', required: 'yes when incomeMode is hourly', units: 'weeks (0–53)', blank: 'Means 0 for fixed amounts.', note: 'Weeks worked in the school year.', example: '30' },
        percent('unavailablePercent', 'Share of this resource that will not be available (0–100).', '0'),
      ],
    },
    {
      name: 'Loans', single: false,
      purpose: 'Loans, one row per loan. academicYear decides which school year\'s borrowing a loan counts toward; disbursementDate alone drives interest and repayment dates.',
      columns: [
        id('loanId', 'loan', 'loan-1'),
        text('name', 'Name shown in the plan.', 'Direct Unsubsidized 2026–27'),
        choice('type', LOAN_TYPES, 'yes', 'subsidized/unsubsidized = federal Direct loans; private; other.', 'Not allowed.', 'unsubsidized'),
        money('principal', 'yes', 'Amount borrowed.', '5500'),
        { header: 'ratePercent', kind: 'ratePercent', required: 'yes', units: 'annual percent (6.53 = 6.53%), 0–30', blank: 'Not allowed (enter 0 for 0%).', note: 'Annual interest rate.', example: '6.39' },
        date('disbursementDate', 'yes', 'Date the money is paid out. Drives interest; not the same as the academic year.', '2026-08-24'),
        int('termMonths', 'yes', 'months (1–1200)', 'Repayment term used for the minimum payment.', '120'),
        { header: 'academicYear', kind: 'academicYear', required: 'no', units: 'YYYY-YYYY or unassigned', blank: 'Older plans: worked out from the disbursement date when unambiguous.', note: 'School year this loan pays for (for example 2026-2027), or unassigned. Does not change dates or interest.', example: '2026-2027' },
        ref('schoolYearId', 'SchoolYears', 'no', 'year-1'),
        money('monthlyPayment', 'no', 'Fixed monthly payment instead of the calculated minimum.', ''),
        bool('payInterestWhileInSchool', 'Pay interest while in school.', 'Not set (no).'),
        bool('accruesInterestInSchool', 'private/other only: interest accrues while in school.', 'Not set (yes).'),
        bool('capitalizeInterest', 'Modeling assumption: add unpaid interest to the balance when repayment starts.', 'Not set (yes).'),
        money('gapAtCreation', 'no', 'Gap + buffer recorded when the loan was created from a year\'s gap (informational).', ''),
        date('firstDueDate', 'no', 'Actual first payment due date from your servicer or lender; overrides every estimate.', ''),
        int('graceMonths', 'no', 'months (0–60)', 'private/other only: months after graduation before required payments start.', '', 'Not configured (no default is assumed).'),
        bool('inSchoolPayments', 'private/other only: the lender requires payments while in school.', 'Not set.'),
      ],
    },
    {
      name: 'RepaymentPlan', single: true,
      purpose: 'Earnings after graduation, the monthly budget, payoff target and when voluntary payments start (one row). The last block holds stored federal settings that are not used in this release.',
      columns: [
        money('annualSalary', 'yes', 'Gross annual salary after graduation.', '55000'),
        money('monthlyTakeHome', 'no', 'Monthly take-home pay (affordability context only).', ''),
        money('monthlyExpenses', 'no', 'Monthly living expenses (affordability context only).', ''),
        money('monthlyDebtBudget', 'yes', 'Your chosen monthly amount for loan payments.', '400'),
        percent('raiseAllocationPercent', 'Share of future raises put toward loans.', '50', 'Not allowed (enter 0).'),
        choice('strategyId', strategyIds, 'yes', 'Payoff strategy for extra payments.', 'Not allowed.', 'avalanche'),
        money('extraMonthlyPayment', 'no', 'Legacy extra payment (normally 0).', '0', 'Means 0.'),
        choice('payoffMode', ['budget', 'date', 'duration'], 'yes', 'budget = choose a budget and see payoff; date = pay off by payoffDate; duration = pay off within payoffMonths.', 'Not allowed.', 'budget'),
        date('payoffDate', 'yes when payoffMode is date', 'Target payoff date.', ''),
        int('payoffMonths', 'yes when payoffMode is duration', 'months (1–1200)', 'Pay off within this many months of the first voluntary payment.', ''),
        choice('voluntaryStartKind', ['afterGraduation', 'date'], 'yes', 'When your own payments start: a number of months after graduation, or a date.', 'Not allowed.', 'afterGraduation'),
        int('voluntaryStartMonths', 'yes when voluntaryStartKind is afterGraduation', 'months (0–60)', 'Months after graduation.', '6'),
        date('voluntaryStartDate', 'yes when voluntaryStartKind is date', 'Date voluntary payments start.', ''),
        choice('federalMode', ['standard', 'federal'], 'no', 'Stored federal setting (not used in this release).', 'Means standard.', 'standard'),
        choice('federalPlan', ['ibr', 'rap'], 'no', 'Stored federal setting (not used in this release).', 'Means rap.', 'rap'),
        int('familySize', 'no', 'people (1–20)', 'Stored federal setting (not used in this release).', '1', 'Means 1.'),
        money('annualAGI', 'no', 'Stored federal setting (not used in this release).', '55000', 'Means 0.'),
        choice('dependency', ['dependent', 'independent'], 'no', 'Stored federal setting (not used in this release).', 'Means dependent.', 'dependent'),
        choice('level', ['undergraduate', 'graduate'], 'no', 'Stored federal setting (not used in this release).', 'Means undergraduate.', 'undergraduate'),
        money('priorFederalDebt', 'no', 'Stored federal setting (not used in this release).', '0', 'Means 0.'),
      ],
    },
    {
      name: 'LifeEvents', single: false, purpose: 'Income changes, windfalls, expenses and aid changes, one row per event.',
      columns: [
        id('eventId', 'event', 'event-1'),
        text('name', 'Name of the event.', 'Raise'),
        date('date', 'yes', 'When it happens.', '2032-01-01'),
        choice('type', EVENT_TYPES, 'yes', 'income = new annual salary from date; windfall = lump sum; expense/aid change a school year\'s gap.', 'Not allowed.', 'income'),
        money('amount', 'yes', 'New annual salary (income) or amount.', '62000'),
        percent('allocationPercent', 'Share put toward loans (income/windfall).', '50', 'Not allowed (enter 0).'),
        ref('yearId', 'SchoolYears', 'no', ''),
        choice('recurrence', ['once', 'yearly'], 'no', 'Windfalls can repeat yearly.', 'Not set (once).', 'once'),
        date('recurrenceEndDate', 'no', 'Last date a yearly event repeats.', ''),
      ],
    },
    {
      name: 'Scenarios', single: false, purpose: 'What-if scenarios, one row per scenario. Their changed assumptions are on ScenarioOverrides.',
      columns: [
        id('scenarioId', 'scenario', 'scenario-1'),
        text('name', 'Scenario name.', 'Higher salary'),
      ],
    },
    {
      name: 'ScenarioOverrides', single: false,
      purpose: 'One row per changed assumption in a scenario. fieldPath names the changed field by record IDs (for example loans.loan-1.annualRate or postGradIncome.monthlyDebtBudget); value is written in the stored form: money as 1234.50, rates as annual fractions (0.065 = 6.5%), percents as 5, dates as YYYY-MM-DD.',
      columns: [
        ref('scenarioId', 'Scenarios', 'yes', 'scenario-1', 'Not allowed.'),
        { header: 'fieldPath', kind: 'text', required: 'yes', units: 'dot path using record IDs', blank: 'Not allowed.', note: 'Field this scenario changes.', example: 'postGradIncome.monthlyDebtBudget' },
        choice('valueType', ['text', 'number', 'boolean'], 'yes', 'Stored value type: text (money, rates, percents, dates and choices are text), number (whole numbers such as months) or boolean (yes/no).', 'Not allowed.', 'text'),
        { header: 'value', kind: 'overrideValue', required: 'yes', units: 'stored form (see purpose)', blank: 'Not allowed.', note: 'The scenario\'s value for fieldPath.', example: '550.00' },
      ],
    },
    {
      name: 'CustomOrder', single: false, purpose: 'Your own payoff ranking for the custom strategy, one row per loan (position 1 is paid first).',
      columns: [
        int('position', 'yes', 'rank (1, 2, 3 …)', 'Order in which extra payments go to loans.', '1'),
        ref('loanId', 'Loans', 'yes', 'loan-1', 'Not allowed.'),
      ],
    },
  ];
}

export const DATA_SHEETS: readonly SheetName[] = ['Settings', 'SchoolYears', 'Costs', 'Resources', 'Loans', 'RepaymentPlan', 'LifeEvents', 'Scenarios', 'ScenarioOverrides', 'CustomOrder'];

/** Template row-count limits (also the plan limits for school years and loans). */
export const TEMPLATE_LIMITS = { years: { min: 1, max: 50 }, loans: { min: 0, max: 50 } } as const;

export const GENERAL_INSTRUCTIONS: readonly string[] = [
  'DebtNav workbook (schema debtnav-workbook-1). Fill in the data sheets, then use Your data → Import Excel in DebtNav. Importing replaces your whole plan after you confirm a preview.',
  'Each data sheet is an Excel table: one row per record. Add rows below a table as needed (they are read up to the last filled row). Fully blank rows are ignored. A row with only an ID filled in counts as blank.',
  'Enter values only — formulas are not allowed in data sheets, and macro-enabled files (.xlsm) are rejected. Copy and "paste values" if needed.',
  'Dates are text in the form YYYY-MM-DD (for example 2026-08-24). Real Excel dates are also accepted. Money is US dollars with at most 2 decimals. Rates are annual percents (6.53 means 6.53%). Percents use 5 for 5%.',
  'Blank is not the same as zero: a blank optional cell means "not set"; enter 0 when the value is zero. Each column below says what blank means.',
  'Academic year vs disbursement date: a loan\'s academicYear (for example 2026-2027) decides which school year\'s borrowing it counts toward. Its disbursementDate decides when interest starts. They can differ.',
  'IDs connect rows across sheets (Costs.yearId → SchoolYears.yearId, ScenarioOverrides.scenarioId → Scenarios.scenarioId, CustomOrder.loanId → Loans.loanId). Keep IDs unchanged when editing an exported plan.',
  'Limits: 50 school years, 100 cost items and 100 resources per year, 50 loans, 100 life events, 20 scenarios, 200 overrides per scenario; files up to 5 MB.',
  'This file never contains account details, sign-in tokens or secrets. The example column below is only an illustration; examples are never imported.',
];
