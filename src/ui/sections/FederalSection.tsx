import { useMemo, useState } from 'react';
import { D, money, sum } from '../../engine/money';
import { federalReference as ref } from '../../policy/reference';
import { loanLimitNotices } from '../../policy/federal';
import {
  debtEarningsRatio, fetchScorecard, scorecardYearLabel, SCORECARD_LATEST_PROGRAM_YEAR, SCORECARD_SOURCE_NAME, SCORECARD_SOURCE_URL, type EarningsRecord,
} from '../../integrations/scorecard';
import { usePlanner } from '../PlannerContext';
import { IntegerField, MoneyField, SelectField } from '../fields/fields';
import { Explain, TableRegion } from '../common/common';
import { formatCurrency, formatDate, formatMonthYear } from '../format';

/** Federal loan limits, federal repayment plan comparison, and the College Scorecard check (US-405, 1101, 1102). */
export function FederalSection() {
  return (
    <section id="federal" className="panel" aria-labelledby="federal-heading">
      <h2 id="federal-heading">7. Federal rules and earnings context</h2>
      <p className="section-intro">Optional checks based on published federal reference data (snapshot as of {formatDate(ref.asOf)}). They never block your plan.</p>
      <LoanLimits />
      <RepaymentPlanComparison />
      <ScorecardLookup />
    </section>
  );
}

function LoanLimits() {
  const { plan, update } = usePlanner();
  const notices = useMemo(() => { try { return loanLimitNotices(plan); } catch { return []; } }, [plan]);
  const exceedances = notices.filter(notice => /exceed/i.test(notice));
  const context = notices.filter(notice => !/exceed/i.test(notice));
  return (
    <div className="subsection">
      <h3>Federal loan limits</h3>
      <div className="field-grid">
        <SelectField id="borrower.dependency" label="Dependency status" value={plan.borrower.dependency}
          options={[['dependent', 'Dependent student'], ['independent', 'Independent student']]}
          onCommit={dependency => update(p => ({ ...p, borrower: { ...p.borrower, dependency } }))} />
        <SelectField id="borrower.level" label="Study level" value={plan.borrower.level}
          options={[['undergraduate', 'Undergraduate'], ['graduate', 'Graduate']]}
          onCommit={level => update(p => ({ ...p, borrower: { ...p.borrower, level } }))} />
        <MoneyField id="borrower.priorFederalDebt" label="Federal loans borrowed before this plan" value={plan.borrower.priorFederalDebt}
          onCommit={priorFederalDebt => update(p => ({ ...p, borrower: { ...p.borrower, priorFederalDebt } }))} />
      </div>
      {exceedances.length > 0 ? (
        <div className="notice notice--warning" role="status">
          <span className="notice-icon" aria-hidden="true">!</span>
          <div className="notice-body">
            <p><strong>Possible federal limit issue (warning only):</strong></p>
            <ul>{exceedances.map(notice => <li key={notice}>{notice}</li>)}</ul>
          </div>
        </div>
      ) : <p className="computed">No modeled federal loan-limit exceedance.</p>}
      {context.map(notice => <p key={notice} className="field-hint">{notice}</p>)}
      <Explain>
        <p>For each school year, federal Direct loans disbursed in that year (or created from its gap) are summed and compared with the annual limit for your dependency status, study level, and year of study; the total including prior federal debt is compared with the aggregate limit. For undergraduates, subsidized amounts are also compared with the subsidized annual and aggregate limits.</p>
      </Explain>
      <p className="source">
        Source: <a href={ref.limitsSource} target="_blank" rel="noreferrer">Federal loan limits (FSA)</a> Â· <a href={ref.subsidySource} target="_blank" rel="noreferrer">Subsidized and unsubsidized loans</a> Â· as of {formatDate(ref.asOf)}. Schools may set lower limits; year of study is assumed from the school-year position.
      </p>
    </div>
  );
}

function RepaymentPlanComparison() {
  const { plan, update, projection, federal, comparisonsUpdating } = usePlanner();
  const rap = federal?.rap ?? null;
  const ibr = federal?.ibr ?? null;
  const tiered = federal?.tiered ?? null;
  const federalLoans = plan.loans.filter(loan => loan.type === 'subsidized' || loan.type === 'unsubsidized');
  const standardMinimum = projection
    ? money(sum(projection.repayment.loans.filter(item => federalLoans.some(loan => loan.id === item.loanId)).map(item => item.minimumMonthlyPayment)))
    : null;
  return (
    <div className="subsection">
      <h3>Federal repayment plan comparison</h3>
      <p>Compares the Tiered Standard plan, the Repayment Assistance Plan (RAP), and Income-Based Repayment (IBR) for your federal Direct loans with the standard projection above. Your main projection is not changed.</p>
      <div className="field-grid">
        <MoneyField id="repayment.annualAGI" label="Annual adjusted gross income (AGI)" value={plan.repayment.annualAGI}
          onCommit={annualAGI => update(p => ({ ...p, repayment: { ...p.repayment, annualAGI } }))} />
        <IntegerField id="repayment.familySize" label="Household size (you + tax dependents)" hint="1â€“20." min={1} max={20} value={plan.repayment.familySize}
          onCommit={familySize => update(p => ({ ...p, repayment: { ...p.repayment, familySize } }))} />
      </div>
      {federalLoans.length > 0 && comparisonsUpdating && <p className="updating" aria-hidden="true">Updating federal plan estimates…</p>}
      {federalLoans.length === 0 ? <p className="empty">Add a Federal Direct loan to compare federal repayment plans.</p>
        : !federal ? <p className="updating">Calculating federal plan estimates…</p>
        : !rap ? <p className="notice notice--warning">RAP comparison unavailable: its 360-month term would exceed the supported date range.</p>
          : (
            <TableRegion label="Federal repayment plan comparison">
              <table>
                <caption>Federal Direct loans only ({federalLoans.length} loan{federalLoans.length === 1 ? '' : 's'})</caption>
                <thead>
                  <tr><th scope="col">Plan</th><th scope="col">First monthly payment</th><th scope="col">Ends</th><th scope="col">Total paid</th><th scope="col">Remaining balance forgiven</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Standard (your projection, all loans)</th>
                    <td>{formatCurrency(standardMinimum)} minimum</td>
                    <td>{projection?.repayment.debtFreeDate ? formatMonthYear(projection.repayment.debtFreeDate) : 'No debt-free date'}</td>
                    <td>{formatCurrency(projection?.repayment.totalRepaymentPayments)}</td>
                    <td>{formatCurrency('0')}</td>
                  </tr>
                  {tiered?.eligible && (
                    <tr>
                      <th scope="row">Tiered Standard ({tiered.termMonths / 12}-year term)</th>
                      <td>{formatCurrency(tiered.monthlyPayment)}{tiered.minimumApplied ? ' ($50 minimum)' : ''}</td>
                      <td>{formatMonthYear(tiered.endDate)}</td>
                      <td>{formatCurrency(tiered.totalPaid)}</td>
                      <td>{formatCurrency('0')}</td>
                    </tr>
                  )}
                  <tr>
                    <th scope="row">Repayment Assistance Plan (RAP)</th>
                    <td>{formatCurrency(rap.monthlyPayment)}</td>
                    <td>{formatMonthYear(rap.endDate)}</td>
                    <td>{formatCurrency(rap.totalPaid)}</td>
                    <td>{formatCurrency(rap.forgiven)}</td>
                  </tr>
                  {ibr && !ibr.eligible && (
                    <tr>
                      <th scope="row">Income-Based Repayment (IBR)</th>
                      <td colSpan={4}>Not available: {ibr.reason}</td>
                    </tr>
                  )}
                  {ibr?.eligible && (
                    <tr>
                      <th scope="row">Income-Based Repayment (IBR{ibr.newBorrower ? ', new borrower' : ''})</th>
                      <td>{formatCurrency(ibr.monthlyPayment)}{ibr.capped ? ' (standard cap)' : ''}</td>
                      <td>{formatMonthYear(ibr.endDate)}</td>
                      <td>{formatCurrency(ibr.totalPaid)}</td>
                      <td>{formatCurrency(ibr.forgiven)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </TableRegion>
          )}
      {federalLoans.length > 0 && tiered && !tiered.eligible && <p className="field-hint">Tiered Standard: {tiered.reason}</p>}
      {rap && federalLoans.length > 0 && (
        <p className="computed">RAP interest subsidy: {formatCurrency(rap.totalInterestSubsidy)} Â· principal match: {formatCurrency(rap.totalPrincipalMatch)}</p>
      )}
      <Explain title="How is the RAP estimate calculated? (assumptions)">
        <p>Monthly payment = AGI Ã— its published rate band Ã· 12, minus $50 per tax dependent, minimum $10. Unpaid monthly interest is waived (subsidy); interest accrued before repayment is not. If a payment reduces principal by less than $50, the government matches the difference up to $50. Any remaining balance is modeled as forgiven after 360 qualifying payments.</p>
        <p>Assumptions: single borrower, AGI stays constant, every payment is on time and qualifying, no prior qualifying payments, private and other loans excluded. Eligibility and any tax on forgiveness must be confirmed with your servicer.</p>
        <p>Tiered Standard: term set by your total Direct Loan balance when repayment begins (under $25,000: 10 years; under $50,000: 15; under $100,000: 20; $100,000 or more: 25), fixed payment M = P × r ÷ (1 − (1 + r)^−n) summed over loans, minimum $50. No forgiveness.</p>
        <p>IBR: payment = your IBR share Ã— max(0, AGI âˆ’ 150% of the poverty guideline for your household) Ã· 12, never more than the 10-year standard payment; under $5 is $0 and $5â€“$10 becomes $10. Only Direct loans made before July 1, 2026 qualify. Remaining balance is modeled as forgiven after 240 payments (new borrower) or 300.</p>
        <p><strong>Federal rules used:</strong></p>
        <ul>{ref.federalRules.map(rule => <li key={rule}>{rule}</li>)}</ul>
        <p><strong>DebtNav modeling assumptions:</strong></p>
        <ul>{ref.modelingAssumptions.map(item => <li key={item}>{item}</li>)}</ul>
        <p>Source: <a href={ref.rapSource} target="_blank" rel="noreferrer">RAP rules</a> Â· <a href={ref.ibrSource} target="_blank" rel="noreferrer">IBR rules</a> · <a href={ref.tieredStandardSource} target="_blank" rel="noreferrer">Tiered Standard rules</a> Â· <a href={ref.povertySource} target="_blank" rel="noreferrer">Poverty guidelines</a> Â· <a href={ref.plansSource} target="_blank" rel="noreferrer">Check current federal plans</a> Â· as of {formatDate(ref.asOf)}.</p>
      </Explain>
    </div>
  );
}

function ScorecardLookup() {
  const { plan } = usePlanner();
  const [school, setSchool] = useState('');
  const [program, setProgram] = useState('');
  const [year, setYear] = useState(SCORECARD_LATEST_PROGRAM_YEAR);
  const [apiKey, setApiKey] = useState('');
  const [records, setRecords] = useState<EarningsRecord[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const totalDebt = money(sum(plan.loans.map(loan => loan.principal)).plus(new D(plan.borrower.priorFederalDebt)));

  async function lookup() {
    setLoading(true);
    setStatus('Looking up public College Scorecard dataâ€¦');
    setRecords([]);
    const result = await fetchScorecard({ school, program: program.trim() || undefined, year, apiKey: apiKey.trim() || undefined });
    setLoading(false);
    if (!result.ok) { setStatus(`Unavailable: ${result.message}`); return; }
    setRecords(result.records);
    setStatus(result.records.length
      ? `Found ${result.records.length} program earnings figure${result.records.length === 1 ? '' : 's'} (data: ${scorecardYearLabel(result.dataYear)}${result.usedDemoKey ? ', shared demo key' : ''}).`
      : `Unavailable: College Scorecard has no published program earnings for this school${program.trim() ? ' and program' : ''} (data: ${scorecardYearLabel(result.dataYear)}). Suppressed figures are not estimated.`);
  }

  return (
    <div className="subsection">
      <h3>Debt-to-earnings check (College Scorecard)</h3>
      <p className="notice notice--info">Privacy: only the school name, data year, and an API key are sent to the U.S. Department of Education College Scorecard API. The program filter is applied on this device. Your debt, income, and plan never leave this device.</p>
      <form className="field-grid" onSubmit={event => { event.preventDefault(); void lookup(); }}>
        <div className="field">
          <label htmlFor="scorecard-school">School name</label>
          <input id="scorecard-school" value={school} maxLength={150} autoComplete="off" onChange={event => setSchool(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="scorecard-program">Program contains (optional)</label>
          <input id="scorecard-program" value={program} maxLength={150} autoComplete="off" onChange={event => setProgram(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="scorecard-year">Data year</label>
          <input id="scorecard-year" value={year} maxLength={6} autoComplete="off" onChange={event => setYear(event.target.value)} aria-describedby="scorecard-year-hint" />
          <p id="scorecard-year-hint" className="field-hint">"latest" uses the newest College Scorecard release, which includes 1-year and 5-year earnings (measures may come from different years). You can also enter a four-digit data year such as 2022.</p>
        </div>
        <div className="field">
          <label htmlFor="scorecard-key">Your api.data.gov key (optional)</label>
          <input id="scorecard-key" type="password" value={apiKey} autoComplete="off" spellCheck={false} onChange={event => setApiKey(event.target.value)} aria-describedby="scorecard-key-hint" />
          <p id="scorecard-key-hint" className="field-hint">The API requires a key. Without one, the shared DEMO_KEY is used and is rate-limited quickly (about 10 requests per IP). A free personal key is kept only for this session, never saved.</p>
        </div>
        <div className="field field--action">
          <button type="submit" disabled={loading || !school.trim()}>{loading ? 'Looking upâ€¦' : 'Look up earnings'}</button>
        </div>
      </form>
      <p role="status" className="field-hint">{status}</p>
      {records.length > 0 && (
        <TableRegion label="Program earnings and debt-to-earnings">
          <table>
            <caption>Median earnings by program, compared with your planned debt of {formatCurrency(totalDebt)}</caption>
            <thead>
              <tr><th scope="col">School / program / credential</th><th scope="col">Median annual earnings</th><th scope="col">Your debt Ã· earnings</th><th scope="col">Source and data year</th></tr>
            </thead>
            <tbody>
              {records.map((record, index) => (
                <tr key={`${record.program}-${record.credential}-${index}`}>
                  <th scope="row">{record.school} / {record.program} / {record.credential}</th>
                  <td>{formatCurrency(record.medianEarnings)} <span className="subtle">({record.measurement})</span></td>
                  <td>{debtEarningsRatio(totalDebt, record.medianEarnings) ?? 'Unavailable'}</td>
                  <td><a href={record.sourceUrl} target="_blank" rel="noreferrer">{record.source}</a>, {scorecardYearLabel(record.dataYear)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      )}
      <p className="source">Source: <a href={SCORECARD_SOURCE_URL} target="_blank" rel="noreferrer">{SCORECARD_SOURCE_NAME}</a>.</p>
    </div>
  );
}
