/**
 * Versioned federal reference data (SRS §8.9, US-405, US-1102). Every value below was checked on
 * `asOf` against the cited authoritative source. Values marked `verified: false` could not be
 * confirmed and must not be modeled as fact. No financial inputs are ever transmitted.
 *
 * Distinguish two kinds of statements in the UI:
 *  - federalRules: what current law/regulation says (sourced here).
 *  - modelingAssumptions: simplifications DebtNav makes on top of those rules.
 */
const ECFR_685_209 = 'https://www.ecfr.gov/current/title-34/subtitle-B/chapter-VI/part-685/subpart-B/section-685.209';
const ECFR_685_202 = 'https://www.ecfr.gov/current/title-34/subtitle-B/chapter-VI/part-685/subpart-B/section-685.202';
const ECFR_685_208 = 'https://www.ecfr.gov/current/title-34/subtitle-B/chapter-VI/part-685/subpart-B/section-685.208';
const ECFR_685_207 = 'https://www.ecfr.gov/current/title-34/subtitle-B/chapter-VI/part-685/subpart-B/section-685.207';
const FINAL_RULE_2026 = 'https://www.federalregister.gov/documents/2026/05/01/2026-08556/reimagining-and-improving-student-education-federal-student-loan-program-final-regulations';
const LIMITS_FAQ = 'https://fsapartners.ed.gov/sites/default/files/2026-05/FrequentlyAskedQuestionsLoanLimits.pdf';
const RATES_2026 = 'https://fsapartners.ed.gov/knowledge-center/library/electronic-announcements/2026-06-04/interest-rates-federal-direct-loans-first-disbursed-between-july-1-2026-and-june-30-2027';
const POVERTY_2026 = 'https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines';

export const federalReference = {
  version: '2026-10-13',
  asOf: '2026-10-13',
  effectiveDate: '2026-07-01',

  // Source links shown by the UI.
  limitsSource: LIMITS_FAQ,
  subsidySource: ECFR_685_207,
  interestSource: RATES_2026,
  capitalizationSource: ECFR_685_202,
  rapSource: ECFR_685_209,
  tieredStandardSource: ECFR_685_208,
  ibrSource: ECFR_685_209,
  plansSource: FINAL_RULE_2026,
  povertySource: POVERTY_2026,

  /** Fixed rates for Direct Loans first disbursed 2026-07-01 through 2027-06-30 (GENERAL-26-33). */
  interestRates: {
    awardYear: '2026-27',
    source: RATES_2026,
    verified: true,
    undergraduateDirect: { rate: '0.0652', label: 'Direct Subsidized/Unsubsidized (undergraduate)' },
    graduateUnsubsidized: { rate: '0.0807', label: 'Direct Unsubsidized (graduate/professional)' },
    plus: { rate: '0.0907', label: 'Direct PLUS' },
  },

  // Loan limits (FSA Loan Limits FAQ, May 20, 2026; 34 CFR 685.203). Undergraduate limits are
  // unchanged by the 2025 law. Index 0 = first year, 1 = second year, 2 = third year and beyond.
  dependentAnnual: ['5500', '6500', '7500'],
  independentAnnual: ['9500', '10500', '12500'],
  subsidizedAnnual: ['3500', '4500', '5500'],
  dependentAggregate: '31000',
  independentAggregate: '57500',
  subsidizedAggregate: '23000',
  /**
   * Graduate limits from 2026-07-01 for borrowers NOT covered by the interim exception. Only Direct
   * Sub/Unsub loans borrowed as a graduate student count toward the graduate aggregate (FAQ GPSLL-Q2);
   * undergraduate loans and Grad PLUS do not. Grad PLUS is eliminated for new borrowers
   * (34 CFR 685.200(b)(2)(i)).
   */
  graduateAnnual: '20500',
  graduateAggregate: '100000',
  /** Professional-program limits: DebtNav cannot classify programs, so these are informational only. */
  professionalAnnual: '50000',
  professionalAggregate: '200000',
  /**
   * Interim exception (FAQ IE-Q1): students enrolled in a program as of 2026-06-30 who received a Direct
   * Loan for it before 2026-07-01 keep legacy limits (and Grad PLUS) for the lesser of 3 academic years
   * or the remaining published program length, and are not subject to the lifetime maximum then.
   */
  legacyGraduateAnnual: '20500',
  legacyGraduateAggregate: '138500',
  lifetimeMaximum: '257500',

  /**
   * Tiered Standard plan, 34 CFR 685.208(c)(1): term set by total Direct Loans at repayment entry;
   * minimum payment $50. Tiers are [upper bound (exclusive) or null for no bound, term in months].
   */
  tieredStandard: {
    verified: true,
    source: ECFR_685_208,
    minimumPayment: '50',
    tiers: [['25000', 120], ['50000', 180], ['100000', 240], [null, 300]] as ReadonlyArray<readonly [string | null, number]>,
  },

  /** Repayment Assistance Plan, 34 CFR 685.209 (verified against eCFR text current as of 2026-10-01). */
  rap: {
    verified: true,
    source: ECFR_685_209,
    minimum: '10',
    dependentReduction: '50',
    principalMatchCap: '50',
    forgivenessMonths: 360,
    /** [AGI upper bound (inclusive), share of AGI]. AGI ≤ $10,000 → $120/year base payment. Above $100,000 → 10%. */
    brackets: [['10000', '0'], ['20000', '0.01'], ['30000', '0.02'], ['40000', '0.03'], ['50000', '0.04'], ['60000', '0.05'], ['70000', '0.06'], ['80000', '0.07'], ['90000', '0.08'], ['100000', '0.09']],
    lowIncomeAnnualPayment: '120',
    topRate: '0.10',
  },

  /**
   * Income-Based Repayment, 34 CFR 685.209(b)(1), (f)(2)–(3), (k). IBR remains available only for
   * loans made before 2026-07-01: HEA §455(d)(7) as amended limits loans made on or after that date
   * to the Tiered Standard plan or RAP (2026 final rule, 91 FR 23768). Partial financial hardship
   * is no longer an entry requirement.
   */
  ibr: {
    verified: true,
    source: ECFR_685_209,
    newLoansCutoff: '2026-07-01',
    /** "New borrower": no outstanding balance before 2014-07-01 and no new loan on or after 2026-07-01. */
    newBorrowerSince: '2014-07-01',
    povertyMultiple: '1.5',
    newBorrower: { share: '0.10', forgivenessMonths: 240 },
    otherBorrower: { share: '0.15', forgivenessMonths: 300 },
  },

  /** 2026 HHS poverty guidelines, 48 contiguous states and DC. */
  povertyGuideline: { year: 2026, base: '15960', perAdditionalPerson: '5680', source: POVERTY_2026, verified: true },

  federalRules: [
    'Direct Subsidized Loans: no interest is charged while enrolled at least half-time or during the 6-month grace period (34 CFR 685.207(b)).',
    'Exception: subsidized loans first disbursed from July 1, 2012 through June 30, 2014 do accrue interest during grace (34 CFR 685.207(b)(3)(iii)). DebtNav does not model this exception.',
    'Direct Unsubsidized Loans: interest accrues from the first disbursement, including in school and grace (34 CFR 685.207(c)(3)).',
    'Grace period: 6 months after the student drops below half-time enrollment (34 CFR 685.207(b)(2), (c)(2)).',
    'Capitalization: current regulations capitalize unpaid Direct Loan interest when a deferment ends (34 CFR 685.202(b)), and under IBR when the payment reaches the standard cap or the borrower leaves IBR (34 CFR 685.209(j)). Entering repayment after grace is not a listed capitalization event. Interest forborne during forbearance is capitalized (34 CFR 685.205(a)).',
    'Tiered Standard plan (loans made on or after July 1, 2026): term of 10, 15, 20 or 25 years for total Direct Loans under $25,000, under $50,000, under $100,000, or $100,000 and above; minimum payment $50 (34 CFR 685.208(c)(1)).',
    'A borrower with any Direct Loan made on or after July 1, 2026 may choose only the Tiered Standard plan or RAP, and all Direct Loans of one borrower are repaid under the same plan (34 CFR 685.210(a)(1)(ii), (a)(3)). IBR is therefore unavailable in that case.',
    'Loans made on or after July 1, 2026 can be repaid only under the Tiered Standard plan or the Repayment Assistance Plan (HEA §455(d)(7)).',
    'RAP: base payment by AGI band (≤ $10,000: $120/year; then 1%–10% of AGI in $10,000 bands, 10% above $100,000) ÷ 12, minus $50 per dependent, minimum $10; unpaid monthly interest is not charged after an on-time payment; principal is matched up to $50; remaining balance forgiven after 360 qualifying payments.',
    'IBR (loans made before July 1, 2026): 10% (new borrowers) or 15% (others) of AGI above 150% of the poverty guideline, ÷ 12, capped at the 10-year standard payment; forgiveness after 240 or 300 qualifying payments.',
  ],
  modelingAssumptions: [
    'DebtNav capitalizes in-school interest at repayment start by default (SRS §8.4). This is a simplification; turn off capitalization on a loan to keep that interest separate, which matches current Direct Loan rules more closely.',
    'Income, family size, and dependents stay constant for the whole federal estimate; real payments are recalculated every year.',
    'Dependents for RAP are estimated as family size minus one.',
    'Every RAP/IBR payment is assumed to be on time and every month qualifies; deferment, forbearance, and taxes on forgiveness are not modeled.',
    'The poverty guideline for the 48 contiguous states and DC is used.',
    'A loan is treated as "made" on its disbursement date.',
    'Autopay interest-rate reductions (0.25%, plus a temporary 0.75% announced June 18, 2026 for enrollees through June 30, 2028) are not modeled; enter your effective rate if you use autopay.',
    'Alaska and Hawaii poverty guidelines, the spouse-debt adjustment for RAP, and regaining graduate aggregate eligibility through repayment are not modeled.',
  ],
} as const;
