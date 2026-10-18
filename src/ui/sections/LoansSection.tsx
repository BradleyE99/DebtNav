import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { PlannerLoan, RequiredPaymentTerms } from '../../engine/planner-contracts';
import type { InSchoolInterestPayment, LoanType } from '../../engine/contracts';
import { D, money, sum } from '../../engine/money';
import { federalReference } from '../../policy/reference';
import { formatRatePercent } from '../../data/parse';
import { usePlanner } from '../PlannerContext';
import {
  CheckboxField, DateField, IntegerField, MoneyField, OptionalDateField, OptionalIntegerField, OptionalMoneyField, RateField, SelectField, TextField,
} from '../fields/fields';
import { timingBasisText } from '../results/PaymentTiming';
import { useFieldStatus } from '../fields/fieldStatus';
import { Explain } from '../common/common';
import { LOAN_TYPE_LABELS, formatCurrency, formatDate, formatMonthYear, plural } from '../format';
import { errorsForLoan, fieldIdForPath, updateLoan } from '../planUpdates';
import { onRevealRequest } from '../reveal';
import { newId } from '../ids';
import { academicYearOptions, groupLoansByAcademicYear, loanYearKey, useLoanGroupingPreference } from './loanYearGroups';
import { loanAcademicYear } from '../../engine/planner';
import { UNASSIGNED_ACADEMIC_YEAR, academicYearFromStart, formatAcademicYear } from '../../engine/academicYear';
import './loans.css';

const loanTypeOptions = Object.entries(LOAN_TYPE_LABELS) as [LoanType, string][];

/** Name shown in a loan's summary; blank or whitespace-only names get a numbered fallback. */
function loanDisplayName(loan: PlannerLoan, index: number): string {
  return loan.name.trim() || `Unnamed loan ${index + 1}`;
}

/** Loan id addressed by a field id such as `loans.<loanId>.principal`, or null. */
function loanIdFromFieldId(fieldId: string): string | null {
  const match = /^loans\.([^.]+)\./.exec(fieldId);
  return match ? match[1] : null;
}

/** `ids` with `id` opened or closed; returns the same set when nothing changes. */
function withOpen(ids: ReadonlySet<string>, id: string, open: boolean): ReadonlySet<string> {
  if (ids.has(id) === open) return ids;
  const next = new Set(ids);
  if (open) next.add(id); else next.delete(id);
  return next;
}

export function LoansSection({ focusLoanId, onFocused }: { focusLoanId: string | null; onFocused(): void }) {
  const { plan, update, projection } = usePlanner();
  const totalDebt = money(sum(plan.loans.map(loan => loan.principal)));
  const payers = plan.loans.filter(loan => loan.payInterestWhileInSchool && loan.type !== 'subsidized');
  const inSchoolMonthly = payers.length
    ? money(sum(payers.map(loan => inSchoolCost(loan, projection?.repayment?.inSchoolInterestPayments ?? null).monthly)))
    : null;

  // Which loan cards are expanded. UI-only state (never stored in the plan); existing loans start collapsed.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  // A loan added here that should receive focus once it has opened.
  const pendingFocusRef = useRef<string | null>(null);

  // Optional grouping by academic year (presentation only; remembered on this device).
  const [groupByYear, setGroupByYear] = useLoanGroupingPreference();
  // Year sections the user collapsed. UI-only state; year sections start open.
  const [collapsedYears, setCollapsedYears] = useState<ReadonlySet<string>>(() => new Set());
  // Each loan's academic year as of the last render, to spot loans that are new or moved to another year.
  const yearSignature = plan.loans.map(loan => `${loan.id}:${loanYearKey(plan, loan)}`).join('|');
  const [seenYears, setSeenYears] = useState(yearSignature);
  const planRef = useRef(plan);
  useEffect(() => { planRef.current = plan; });

  // Drop ids of loans that no longer exist (adjusting state during render, without an extra effect pass).
  const loanIds = new Set(plan.loans.map(loan => loan.id));
  if ([...expanded].some(id => !loanIds.has(id))) {
    setExpanded(new Set([...expanded].filter(id => loanIds.has(id))));
  }

  // A loan created from a year's gap opens; the effect below then focuses its name field.
  if (focusLoanId && loanIds.has(focusLoanId) && !expanded.has(focusLoanId)) {
    setExpanded(withOpen(expanded, focusLoanId, true));
  }

  // A new loan, or an open loan reassigned to another academic year, opens its year section so it stays in view.
  if (yearSignature !== seenYears) {
    const before = new Map(seenYears ? seenYears.split('|').map(entry => entry.split(':') as [string, string]) : []);
    const reveal = plan.loans
      .filter(loan => before.get(loan.id) !== loanYearKey(plan, loan) && (!before.has(loan.id) || expanded.has(loan.id)))
      .map(loan => loanYearKey(plan, loan));
    setSeenYears(yearSignature);
    if (reveal.some(key => collapsedYears.has(key))) setCollapsedYears(new Set([...collapsedYears].filter(key => !reveal.includes(key))));
  }
  if (focusLoanId && loanIds.has(focusLoanId)) {
    const key = loanYearKey(plan, plan.loans.find(loan => loan.id === focusLoanId)!);
    if (collapsedYears.has(key)) setCollapsedYears(withOpen(collapsedYears, key, false));
  }

  // A loan reassigned to another year section is remounted there; keep focus on the field being edited.
  const sectionRef = useRef<HTMLElement>(null);
  const lastFocusedRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = lastFocusedRef.current;
    if (!id || (document.activeElement && document.activeElement !== document.body)) return;
    const element = document.getElementById(id);
    if (element && sectionRef.current?.contains(element)) element.focus({ preventScroll: true });
  }, [yearSignature]);
  useEffect(() => {
    const target = pendingFocusRef.current ?? focusLoanId;
    if (!target || !expanded.has(target)) return;
    const element = document.getElementById(`loans.${target}.name`);
    if (!element) return;
    element.focus();
    element.scrollIntoView?.({ block: 'center' });
    if (target === pendingFocusRef.current) pendingFocusRef.current = null;
    if (target === focusLoanId) onFocused();
  }, [focusLoanId, expanded, onFocused]);

  // "Go to the field" links elsewhere ask collapsed containers to reveal a field.
  useEffect(() => onRevealRequest(fieldId => {
    const loanId = loanIdFromFieldId(fieldId);
    if (!loanId) return;
    const current = planRef.current;
    const loan = current.loans.find(item => item.id === loanId);
    flushSync(() => {
      setExpanded(ids => withOpen(ids, loanId, true));
      if (loan) setCollapsedYears(keys => withOpen(keys, loanYearKey(current, loan), false));
    });
  }), []);

  function addLoan() {
    const id = newId();
    update(p => {
      const loan: PlannerLoan = {
        id, name: `Loan ${p.loans.length + 1}`, type: 'unsubsidized', principal: '0.00', annualRate: federalReference.interestRates.undergraduateDirect.rate,
        disbursementDate: p.settings.startDate, termMonths: 120, payInterestWhileInSchool: false, capitalizeInterest: true,
      };
      // Starts in the school year its default date falls in (shown in the open card, where it can be changed).
      loan.academicYear = loanAcademicYear(p, loan) ?? UNASSIGNED_ACADEMIC_YEAR;
      return {
        ...p,
        loans: [...p.loans, loan],
        repayment: { ...p.repayment, customOrder: [...p.repayment.customOrder, id] },
      };
    });
    pendingFocusRef.current = id;
    setExpanded(current => withOpen(current, id, true));
  }

  const groups = groupByYear ? groupLoansByAcademicYear(plan) : [];
  const allExpanded = plan.loans.length > 0 && plan.loans.every(loan => expanded.has(loan.id)) && groups.every(group => !collapsedYears.has(group.key));
  const noneExpanded = plan.loans.every(loan => !expanded.has(loan.id));
  const card = (loan: PlannerLoan, index: number) => (
    <LoanCard key={loan.id} loan={loan} index={index} nested={groupByYear} open={expanded.has(loan.id)}
      onToggle={() => setExpanded(current => withOpen(current, loan.id, !current.has(loan.id)))} />
  );

  return (
    <section id="loans" ref={sectionRef} className="panel" aria-labelledby="loans-heading"
      onFocus={event => { lastFocusedRef.current = event.target.id || null; }}>
      <h2 id="loans-heading" tabIndex={-1}>Loan Amounts</h2>
      <p className="section-intro">Each loan you have or plan to take. Loans never change when a gap changes.</p>
      <p className="computed" role="status">Total borrowed: <strong>{formatCurrency(totalDebt)}</strong> across {plan.loans.length} loan{plan.loans.length === 1 ? '' : 's'}</p>
      {inSchoolMonthly && (
        <p className="computed">In-school interest you pay: about <strong>{formatCurrency(inSchoolMonthly)} per month</strong> while in school and grace.</p>
      )}
      {plan.loans.length === 0 && <p className="empty">No loans yet. Add each loan you have or plan to take, or create one from a school year's gap under College Costs. Your debt-free date and total interest need at least one loan.</p>}
      {plan.loans.length > 0 && (
        <div className="loan-list-toolbar">
          <div className="field-check loan-list-grouping">
            <input id="loans-group-by-year" type="checkbox" checked={groupByYear} onChange={event => setGroupByYear(event.target.checked)} />
            <label htmlFor="loans-group-by-year">Group by academic year</label>
          </div>
          <div className="loan-list-controls" role="group" aria-label="Show or hide loan details">
            <button type="button" className="loan-list-control" aria-disabled={allExpanded || undefined}
              onClick={() => {
                if (allExpanded) return;
                setExpanded(new Set(plan.loans.map(loan => loan.id)));
                setCollapsedYears(new Set());
              }}>
              Expand all
            </button>
            <button type="button" className="loan-list-control" aria-disabled={noneExpanded || undefined}
              onClick={() => { if (!noneExpanded) setExpanded(new Set()); }}>
              Collapse all
            </button>
          </div>
        </div>
      )}
      {groupByYear ? (
        <div className="loan-years">
          {groups.map(group => {
            const open = !collapsedYears.has(group.key);
            const groupId = `loans-year-${group.key}`;
            return (
              <section key={group.key} id={groupId} className="loan-year" aria-labelledby={`${groupId}-title`}>
                <h3 className="loan-year__heading">
                  <button type="button" className="loan-year__toggle" aria-expanded={open} aria-controls={`${groupId}-loans`}
                    onClick={() => setCollapsedYears(current => withOpen(current, group.key, open))}>
                    <span id={`${groupId}-title`} className="loan-year__title">{group.label}</span>
                    <span className="loan-year__summary">
                      {plural(group.loans.length, 'loan')} · <span className="loan-year__total">{formatCurrency(group.totalPrincipal)}</span> principal
                    </span>
                    <span className="loan-card__chevron" aria-hidden="true" />
                  </button>
                </h3>
                <div id={`${groupId}-loans`} className="loan-list loan-year__loans" hidden={!open}>
                  {group.loans.map(({ loan, index }) => card(loan, index))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="loan-list">
          {plan.loans.map((loan, index) => card(loan, index))}
        </div>
      )}
      <button type="button" id="loans-add" className="button-primary" onClick={addLoan} disabled={plan.loans.length >= 50}>Add loan</button>
      {plan.loans.length >= 50 && <p className="field-hint">You have reached the 50-loan limit.</p>}
      <Explain>
        <p>Unsubsidized and private loans accrue simple interest in school and grace: principal × annual rate × days ÷ 365. Subsidized loans accrue nothing during school and grace.</p>
        <p>First required payment: an actual due date you enter is used as is. Otherwise federal Direct loans are estimated at 6 months after graduation plus one month; private loans use the grace period you enter (graduation + grace + one month) or, if payments are required in school, the month after disbursement. Loans with no terms set are assumed to start with your first payment.</p>
        <p>Capitalization (a modeling assumption you can turn off per loan) adds that unpaid interest to the balance when repayment starts. If you pay interest while in school, nothing capitalizes and the in-school interest is shown as a monthly cost.</p>
        <p>Minimum payment M = P × r ÷ (1 − (1 + r)^−n), r = annual rate ÷ 12, n = term in months, unless you enter a fixed payment.</p>
        <p>Total borrowed = Σ principal of every loan.</p>
      </Explain>
    </section>
  );
}

function LoanCard({ loan, index, nested, open, onToggle }: { loan: PlannerLoan; index: number; nested: boolean; open: boolean; onToggle(): void }) {
  const { plan, update, remove, projection, projectionErrors } = usePlanner();
  const { invalidFieldIds, FieldStatusProvider } = useFieldStatus();
  const base = `loans.${loan.id}`;
  const loanErrors = errorsForLoan(plan, projectionErrors, loan.id);
  const patch = (value: Partial<PlannerLoan>) => update(p => updateLoan(p, loan.id, value));
  const headingId = `${base}-heading`;
  const nameId = `${base}-title`;
  const detailsId = `${base}-details`;
  const attentionId = `${base}-attention`;
  const displayName = loanDisplayName(loan, index);
  // Advanced terms open by themselves when one of their fields needs attention (reveal also opens them).
  const [advancedOpen, setAdvancedOpen] = useState(() => loanErrors.some(error => !/\.(name|type|principal|annualRate|academicYear|disbursementDate)$/.test(fieldIdForPath(plan, error.path))));
  const yearIndex = loan.schoolYearId ? plan.schoolYears.findIndex(year => year.id === loan.schoolYearId) : -1;
  const yearSummary = projection?.years.find(year => year.mismatchLoanIds.includes(loan.id));
  const atRepayment = projection?.repayment?.loans.find(item => item.loanId === loan.id);
  const accrues = loan.type === 'unsubsidized' || ((loan.type === 'private' || loan.type === 'other') && loan.accruesInterestInSchool !== false);
  const inSchool = inSchoolCost(loan, projection?.repayment?.inSchoolInterestPayments ?? null);
  const academicYear = loanAcademicYear(plan, loan);
  const timing = projection?.paymentTiming?.find(entry => entry.loanId === loan.id);
  // Inside a year section the card heading sits one level below the year's heading.
  const Heading = nested ? 'h4' : 'h3';

  // Fields needing attention: fields showing an error (including invalid drafts that were never saved)
  // plus engine problems tied to a field. Engine problems without a field still flag the loan.
  const attentionFields = new Set(invalidFieldIds);
  for (const error of loanErrors) attentionFields.add(fieldIdForPath(plan, error.path));
  const attention = attentionFields.size > 0
    ? `Needs attention: ${plural(attentionFields.size, 'field')}`
    : null;

  return (
    <article className={`loan-card${open ? ' loan-card--open' : ''}${attention ? ' loan-card--attention' : ''}`} aria-labelledby={nameId}>
      <Heading id={headingId} className="loan-card__heading">
        <button type="button" className="loan-card__toggle" aria-expanded={open} aria-controls={detailsId}
          aria-describedby={attention ? attentionId : undefined} onClick={onToggle}>
          <span className="loan-card__title">
            <span id={nameId} className="loan-card__name">{displayName}</span>
            <span className="loan-card__type">{LOAN_TYPE_LABELS[loan.type]}{yearIndex >= 0 ? ` · from Year ${yearIndex + 1} gap` : ''}</span>
          </span>
          <span className="loan-card__summary">
            <span className="loan-card__figure"><span className="loan-card__label">Principal</span> <span className="loan-card__value">{formatCurrency(loan.principal)}</span></span>
            <span className="loan-card__figure"><span className="loan-card__label">Annual rate</span> <span className="loan-card__value">{formatRatePercent(loan.annualRate)}%</span></span>
            <span className="loan-card__figure"><span className="loan-card__label">Academic year</span> <span className="loan-card__value">{academicYear ? formatAcademicYear(academicYear) : 'Unassigned'}</span></span>
            <span className="loan-card__figure"><span className="loan-card__label">First required payment</span> <span className="loan-card__value">{timing?.firstRequiredPaymentDate ? formatMonthYear(timing.firstRequiredPaymentDate) : 'Not set'}</span></span>
            {atRepayment && (
              <span className="loan-card__figure"><span className="loan-card__label">Balance at repayment</span> <span className="loan-card__value">{formatCurrency(atRepayment.balanceAtRepaymentStart)}</span></span>
            )}
          </span>
          <span className="loan-card__chevron" aria-hidden="true" />
        </button>
      </Heading>
      {attention && (
        <p id={attentionId} className="loan-card__attention">
          <span className="loan-card__attention-icon" aria-hidden="true">!</span>
          {attention}
          {loanErrors.length > 0 ? ' (repayment can’t be projected)' : ''}
        </p>
      )}
      <div id={detailsId} className="loan-card__details" hidden={!open}>
        <FieldStatusProvider>
          {yearSummary && (
            <p className="notice notice--warning">
              Year {plan.schoolYears.findIndex(year => year.id === yearSummary.yearId) + 1}'s gap + buffer is now {formatCurrency(yearSummary.bufferedGap)}; it was {formatCurrency(loan.gapAtCreation)} when this loan was created. The loan ({formatCurrency(loan.principal)}) was not changed — edit the amount if you want it to follow.
            </p>
          )}
          {loanErrors.length > 0 && (
            <div className="notice notice--warning" role="alert">
              <span className="notice-icon" aria-hidden="true">!</span>
              <p><strong>Repayment can't be projected because of this loan:</strong> {loanErrors.map(error => error.message).join(' ')}</p>
            </div>
          )}
          <div className="field-grid">
            <TextField id={`${base}.name`} label="Loan name" value={loan.name} onCommit={name => patch({ name })} />
            <SelectField id={`${base}.type`} label="Loan type" options={loanTypeOptions} value={loan.type} onCommit={type => patch({ type })} />
            <MoneyField id={`${base}.principal`} label="Amount borrowed" value={loan.principal} onCommit={principal => patch({ principal })} />
            <RateField id={`${base}.annualRate`} label="Annual interest rate" value={loan.annualRate} onCommit={annualRate => patch({ annualRate })} />
            <AcademicYearField loan={loan} academicYear={academicYear} onCommit={value => patch({ academicYear: value })} />
            <DateField id={`${base}.disbursementDate`} label="Disbursement date" value={loan.disbursementDate}
              externalError={loanErrors.find(error => fieldIdForPath(plan, error.path) === `${base}.disbursementDate`)?.message} onCommit={disbursementDate => patch({ disbursementDate })} />
          </div>
          <details className="loan-card__advanced" open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
          <summary>Advanced <span className="subtle">term, required payments, interest in school</span></summary>
          <div className="field-grid">
            <IntegerField id={`${base}.termMonths`} label="Repayment term (months)" hint="120 months = 10 years." min={1} max={1200} value={loan.termMonths} onCommit={termMonths => patch({ termMonths })} />
            <OptionalMoneyField id={`${base}.monthlyPayment`} label="Fixed monthly payment (optional)" hint="Blank: the calculated minimum is used."
              value={loan.monthlyPayment} onCommit={monthlyPayment => patch({ monthlyPayment })} />
          </div>
          <RequiredPaymentFields loan={loan} errorFor={path => loanErrors.find(error => fieldIdForPath(plan, error.path) === path)?.message} />
          <div className="check-group">
            {loan.type === 'subsidized' ? (
              <p className="field-hint">Subsidized: no interest accrues during school and grace, so there is no in-school interest to pay.</p>
            ) : (
              <CheckboxField id={`${base}.payInterestWhileInSchool`} label="I pay interest while in school"
                hint={loan.payInterestWhileInSchool && accrues
                  ? `You pay about ${formatCurrency(inSchool.monthly)} per month in school and grace${inSchool.count ? ` (${inSchool.count} payments, ${formatCurrency(inSchool.total)} in all)` : ''}. Nothing is added to the balance.`
                  : 'If you pay the interest as it accrues, nothing capitalizes and the payment is shown as a monthly cost.'}
                value={Boolean(loan.payInterestWhileInSchool)} onCommit={payInterestWhileInSchool => patch({ payInterestWhileInSchool })} />
            )}
            <CheckboxField id={`${base}.capitalizeInterest`} label="Add unpaid interest to the balance at repayment (capitalization)"
              hint="Modeling assumption. Federal Direct Loans no longer capitalize unpaid interest when repayment starts; leave this on for private loans that do."
              value={loan.capitalizeInterest !== false} onCommit={capitalizeInterest => patch({ capitalizeInterest })} />
            {(loan.type === 'private' || loan.type === 'other') && (
              <CheckboxField id={`${base}.accruesInterestInSchool`} label="Interest accrues while in school"
                hint="Most private loans accrue from disbursement. Turn off only if your lender says otherwise."
                value={loan.accruesInterestInSchool !== false} onCommit={accruesInterestInSchool => patch({ accruesInterestInSchool })} />
            )}
          </div>
          </details>
          {atRepayment && (
            <dl className="inline-figures">
              <div><dt>Interest before repayment</dt><dd>{formatCurrency(atRepayment.accruedInterest)}</dd></div>
              {loan.payInterestWhileInSchool && accrues && <div><dt>In-school interest you pay</dt><dd>{formatCurrency(inSchool.monthly)}/mo</dd></div>}
              <div><dt>Interest added at repayment</dt><dd>{formatCurrency(atRepayment.capitalizedInterest)}</dd></div>
              <div><dt>Balance at repayment</dt><dd>{formatCurrency(atRepayment.balanceAtRepaymentStart)}</dd></div>
              <div><dt>Minimum monthly payment</dt><dd>{formatCurrency(atRepayment.minimumMonthlyPayment)}</dd></div>
            </dl>
          )}
          <div className="loan-card__actions">
            <button type="button" className="button-danger"
              onClick={() => {
                remove(`Remove loan "${displayName}"`, p => ({ ...p, loans: p.loans.filter(item => item.id !== loan.id) }));
                requestAnimationFrame(() => document.getElementById('loans-heading')?.focus());
              }}>
              Remove loan<span className="visually-hidden"> {displayName}</span>
            </button>
          </div>
        </FieldStatusProvider>
      </div>
    </article>
  );
}

type TermsMode = 'notSet' | 'grace' | 'inSchool';
const TERMS_OPTIONS: [TermsMode, string][] = [
  ['notSet', 'Not set yet'],
  ['grace', 'After a grace period following graduation'],
  ['inSchool', 'Payments are required while in school'],
];

/** Terms without empty keys; undefined when nothing is set (the contract's "default for the loan type"). */
function cleanTerms(terms: RequiredPaymentTerms): RequiredPaymentTerms | undefined {
  const next: RequiredPaymentTerms = {};
  if (terms.firstDueDate) next.firstDueDate = terms.firstDueDate;
  if (terms.graceMonths !== undefined) next.graceMonths = terms.graceMonths;
  if (terms.inSchoolPayments) next.inSchoolPayments = true;
  return Object.keys(next).length ? next : undefined;
}

/**
 * US-507: when this loan's required payments start. Federal Direct loans show the labeled estimate;
 * private/other loans use the lender's terms (no universal grace default). An actual first due date
 * overrides any estimate.
 */
function RequiredPaymentFields({ loan, errorFor }: { loan: PlannerLoan; errorFor(path: string): string | undefined }) {
  const { plan, update, projection } = usePlanner();
  const base = `loans.${loan.id}.requiredPayment`;
  const terms = loan.requiredPayment ?? {};
  const federal = loan.type === 'subsidized' || loan.type === 'unsubsidized';
  const storedMode: TermsMode = terms.inSchoolPayments ? 'inSchool' : terms.graceMonths !== undefined ? 'grace' : 'notSet';
  // 'grace' can be chosen before a number is entered (nothing is stored until it is: no default grace).
  const [pickedGrace, setPickedGrace] = useState(false);
  const mode: TermsMode = storedMode === 'notSet' && pickedGrace ? 'grace' : storedMode;
  const timing = projection?.paymentTiming?.find(entry => entry.loanId === loan.id);
  const save = (patch: Partial<RequiredPaymentTerms>, label: string) =>
    update(p => updateLoan(p, loan.id, { requiredPayment: cleanTerms({ ...(p.loans.find(item => item.id === loan.id)?.requiredPayment ?? {}), ...patch }) }), label);

  return (
    <fieldset className="loan-required-payment" aria-describedby={`${base}-summary`}>
      <legend>When payments are required</legend>
      <p id={`${base}-summary`} className="computed loan-required-payment__summary">
        First required payment: <strong>{timing?.firstRequiredPaymentDate ? formatDate(timing.firstRequiredPaymentDate) : 'Not set'}</strong>
        {timing && <span className="subtle"> · {timingBasisText(timing)}</span>}
      </p>
      <div className="field-grid">
        {federal ? (
          <p className="field-hint loan-required-payment__federal">
            Federal Direct loans: estimated 6 months after graduation ({formatDate(plan.settings.graduationDate)}), the standard grace period. Leaving school or dropping below half-time earlier starts it sooner. Your servicer's notice gives the actual date.
          </p>
        ) : (
          <>
            <SelectField id={base} label="Lender's payment terms" options={TERMS_OPTIONS} value={mode}
              hint="Private loans have no standard grace period. Check your promissory note or lender."
              onCommit={next => {
                setPickedGrace(next === 'grace');
                if (next === 'inSchool') return save({ inSchoolPayments: true, graceMonths: undefined }, 'Set payments required in school');
                if (next === 'notSet') return save({ inSchoolPayments: undefined, graceMonths: undefined }, 'Clear lender payment terms');
                if (storedMode === 'inSchool') return save({ inSchoolPayments: undefined }, 'Set lender grace period');
              }} />
            {mode === 'grace' && (
              <OptionalIntegerField id={`${base}.graceMonths`} label="Grace period (months after graduation)" min={0} max={60}
                value={terms.graceMonths} externalError={errorFor(`${base}.graceMonths`)}
                hint="0 to 60. 0 means payments start right after graduation."
                onCommit={graceMonths => save({ graceMonths }, 'Change lender grace period')} />
            )}
          </>
        )}
        <OptionalDateField id={`${base}.firstDueDate`} label="Actual first due date (optional)" value={terms.firstDueDate}
          externalError={errorFor(`${base}.firstDueDate`)}
          hint="From your servicer or lender. Replaces the estimate. Can't be before the disbursement date."
          onCommit={firstDueDate => save({ firstDueDate }, 'Change first due date')} />
      </div>
    </fieldset>
  );
}

const ADD_ACADEMIC_YEAR = '__add__';

/** The range named by a typed first year ('2025' → '2025-2026'), or null. */
function rangeFromText(text: string): string | null {
  const value = text.trim();
  return /^\d{4}$/.test(value) ? academicYearFromStart(Number(value)) : null;
}

/**
 * Which academic year a loan pays for: the plan's school years, ranges other loans use, Unassigned, or a
 * new range typed by its first year. Only the assignment changes; dates and amounts are left alone.
 */
function AcademicYearField({ loan, academicYear, onCommit }: { loan: PlannerLoan; academicYear: string | null; onCommit(value: string): void }) {
  const { plan } = usePlanner();
  const id = `loans.${loan.id}.academicYear`;
  const startId = `${id}-start`;
  const [adding, setAdding] = useState(false);
  const [startText, setStartText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const options: [string, string][] = [...academicYearOptions(plan), [ADD_ACADEMIC_YEAR, 'Add another academic year…']];
  const typed = rangeFromText(startText);

  function add() {
    if (!typed) { setError('Enter the year the academic year starts, from 1900 to 2198 (for example 2025).'); return; }
    onCommit(typed);
    setAdding(false);
    setStartText('');
    setError(null);
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }
  function cancel() {
    setAdding(false);
    setError(null);
    document.getElementById(id)?.focus();
  }

  return (
    <div className="loan-academic-year">
      <SelectField id={id} label="Academic year" hint="The school year this loan pays for. It does not change the disbursement date or interest."
        options={options} value={academicYear ?? UNASSIGNED_ACADEMIC_YEAR}
        onCommit={value => {
          if (value !== ADD_ACADEMIC_YEAR) { onCommit(value); return; }
          setAdding(true);
          requestAnimationFrame(() => document.getElementById(startId)?.focus());
        }} />
      {adding && (
        <div className="loan-academic-year__add" role="group" aria-labelledby={`${startId}-label`}>
          <div className="field">
            <label id={`${startId}-label`} htmlFor={startId}>First year of the new academic year</label>
            <p id={`${startId}-hint`} className="field-hint">{typed ? `Adds ${formatAcademicYear(typed)}.` : 'For example, 2025 adds 2025–2026.'}</p>
            <input id={startId} type="text" inputMode="numeric" autoComplete="off" maxLength={4} value={startText}
              aria-invalid={error ? true : undefined} aria-describedby={`${startId}-hint${error ? ` ${startId}-error` : ''}`}
              onChange={event => { setStartText(event.target.value); setError(null); }}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); add(); }
                if (event.key === 'Escape') { event.preventDefault(); cancel(); }
              }} />
            {error && <p id={`${startId}-error`} className="field-error">{error}</p>}
          </div>
          <div className="loan-academic-year__actions">
            <button type="button" onClick={add}>Add academic year</button>
            <button type="button" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Monthly in-school interest cost for a loan whose interest is paid while in school (US-404).
 * Uses the engine's payment periods when available (largest full-month amount); otherwise the
 * principal × rate ÷ 12 approximation while results are recalculating.
 */
function inSchoolCost(loan: PlannerLoan, payments: readonly InSchoolInterestPayment[] | null): { monthly: string; total: string; count: number } {
  const rows = payments?.filter(row => row.loanId === loan.id) ?? [];
  if (rows.length) {
    const monthly = rows.reduce((max, row) => (new D(row.amount).gt(max) ? new D(row.amount) : max), new D(0));
    return { monthly: money(monthly), total: money(sum(rows.map(row => row.amount))), count: rows.length };
  }
  try {
    return { monthly: money(new D(loan.principal).times(loan.annualRate).div(12)), total: '0.00', count: 0 };
  } catch {
    return { monthly: '0.00', total: '0.00', count: 0 };
  }
}
