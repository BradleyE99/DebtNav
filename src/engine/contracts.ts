/** Shared M1 contract. Owner: lead orchestrator; agents propose changes by message. */
/** Decimal currency text; never convert monetary values to JS number. Outputs use two decimals. */
export type Money = string;
/** Decimal annual fraction: '0.065' means 6.5%. */
export type AnnualRate = string;
/** Strict Gregorian YYYY-MM-DD, UTC calendar arithmetic, supported years 0001–9999. */
export type ISODate = string;
export interface SchoolYear {
  id: string;
  startDate: ISODate;
  endDate: ISODate;
  costItems: unknown[];
  resources: unknown[];
}
/** Existing US-101 shape; retained for compatibility, not expanded into M2. */
export interface SetupPlan {
  settings: { startDate: ISODate; graduationDate: ISODate };
  schoolYears: SchoolYear[];
}
export type LoanType = 'subsidized' | 'unsubsidized' | 'private' | 'other';
export interface Loan {
  id: string;
  name: string;
  type: LoanType;
  principal: Money;
  annualRate: AnnualRate;
  disbursementDate: ISODate;
  termMonths: number;
  /** Defaults false; subsidized always has no in-school/grace interest. */
  payInterestWhileInSchool?: boolean;
  /** Private/other override; defaults true. Ignored for federal types. */
  accruesInterestInSchool?: boolean;
  /** Optional fixed payment for underpayment/overpayment modeling; otherwise calculated minimum. */
  monthlyPayment?: Money;
}
export interface Plan extends SetupPlan {
  settings: SetupPlan['settings'] & { graceMonths: number; currency: 'USD' };
  loans: Loan[];
  repayment: {
    strategyId: string;
    /** Extra beyond each loan's chosen payment; no budget-entry feature in M1. */
    extraMonthlyPayment: Money;
    /** Safety limit, default 600; integer 1–1200. */
    maxMonths?: number;
  };
}
export interface FieldError {
  path: string;
  code: 'REQUIRED' | 'INVALID_DATE' | 'INVALID_MONEY' | 'INVALID_RATE' | 'OUT_OF_RANGE' | 'DUPLICATE_ID' | 'UNKNOWN_STRATEGY' | 'INVALID_STRATEGY';
  message: string;
}
export interface ProjectionWarning {
  code: 'NEGATIVE_AMORTIZATION' | 'NON_AMORTIZING' | 'HORIZON_EXCEEDED';
  message: string;
  loanId?: string;
  date?: ISODate;
}
export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };
export interface LoanState {
  id: string;
  balance: Money;
  annualRate: AnnualRate;
  minimumPayment: Money;
}
export interface PayoffStrategy {
  id: string;
  name: string;
  /** Return each active loan exactly once; input objects must not be mutated. */
  orderLoans(loans: readonly LoanState[], month: ISODate): readonly LoanState[];
}
export interface LoanAtRepayment {
  loanId: string;
  originalPrincipal: Money;
  accruedInterest: Money;
  capitalizedInterest: Money;
  inSchoolInterestPaid: Money;
  balanceAtRepaymentStart: Money;
  minimumMonthlyPayment: Money;
}
export interface InSchoolInterestPayment {
  loanId: string;
  /** Each disbursement-anchored monthly period, final partial period ends at repayment start. */
  periodStart: ISODate;
  date: ISODate;
  amount: Money;
}
export interface LoanPayment {
  loanId: string;
  payment: Money;
  interest: Money;
  principal: Money;
  remainingBalance: Money;
}
export interface AmortizationMonth {
  month: number;
  date: ISODate;
  loans: LoanPayment[];
  payment: Money;
  interest: Money;
  principal: Money;
  remainingBalance: Money;
}
export interface Projection {
  status: 'paidOff' | 'notAmortizing' | 'horizonExceeded';
  repaymentStartDate: ISODate;
  firstPaymentDate: ISODate;
  loans: LoanAtRepayment[];
  balanceAtRepaymentStart: Money;
  inSchoolInterestPayments: InSchoolInterestPayment[];
  amortizationSchedule: AmortizationMonth[];
  debtFreeDate: ISODate | null;
  /** Sum of projected in-school and repayment interest, including capitalized interest once.
   * Null for incomplete projections; incomplete totals would imply a completed payoff. */
  totalInterestPaid: Money | null;
  /** Repayment cash payments only; excludes in-school interest payments. */
  totalRepaymentPayments: Money;
  warnings: ProjectionWarning[];
}
export type ProjectionResult = Result<Projection>;
/** Implementation entrypoint: calculateProjection(plan: Plan): ProjectionResult, in projection.ts.
 * Strategies are resolved through strategies/registry.ts; 'input-order' is the M1 default.
 * New strategies require one implementation file and one registry entry, never core changes.
 */
