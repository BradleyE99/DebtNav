import { describe,expect,it } from 'vitest';
import type { PlannerLoan, PlannerPlan } from '../engine/planner-contracts';
import { federalReference } from './reference';
import { createDefaultPlan } from '../engine/planner';
import { D, sum } from '../engine/money';
import { rapPayment,modelRap,loanLimitNotices,modelIbr,modelTieredStandard,tieredStandardTerm } from './federal';
it('uses verified RAP income band edges and dependent reduction',()=>{expect(rapPayment('10000',0)).toBe('10.00');expect(rapPayment('20000',0)).toBe('16.67');expect(rapPayment('20000.01',0)).toBe('33.33');expect(rapPayment('55000',0)).toBe('229.17');expect(rapPayment('55000',2)).toBe('129.17');expect(rapPayment('55000',20)).toBe('10.00');});
it('conserves cash and records subsidy, principal match, and forgiveness separately',()=>{const p=createDefaultPlan();p.settings.graduationDate=p.settings.startDate;p.repayment.voluntaryStart={kind:'afterGraduation',months:0};p.repayment.annualAGI='0';p.loans=[{id:'a',name:'Direct',type:'unsubsidized',principal:'30000',annualRate:'0.06',disbursementDate:p.settings.startDate,termMonths:120}];const r=modelRap(p);expect(r.rows).toHaveLength(360);expect(r.monthlyPayment).toBe('10.00');expect(r.rows[0].interestSubsidy).toBe('140.00');expect(r.rows[0].principalMatch).toBe('10.00');expect(r.forgiven).toBe('26400.00');expect(r.totalPaid).toBe('3600.00');for(const m of r.rows)expect(new D(m.interestPaid).plus(m.principalPaid).eq(m.payment)).toBe(true);});
it('caps allocations to loan dues and never loses cash on mixed rates/tiny loans',()=>{const p=createDefaultPlan();p.settings.graduationDate=p.settings.startDate;p.repayment.voluntaryStart={kind:'afterGraduation',months:0};p.repayment.annualAGI='120000';p.loans=[{id:'a',name:'Tiny',type:'unsubsidized',principal:'1',annualRate:'0',disbursementDate:p.settings.startDate,termMonths:120},{id:'b',name:'Large',type:'unsubsidized',principal:'300',annualRate:'0.3',disbursementDate:p.settings.startDate,termMonths:120}];const r=modelRap(p);expect(r.forgiven).toBe('0.00');for(const m of r.rows){expect(new D(m.interestPaid).plus(m.principalPaid).eq(m.payment)).toBe(true);expect(new D(m.balance).gte(0)).toBe(true);}});
it('warns without blocking loans above versioned federal limits',()=>{const p=createDefaultPlan();p.loans=[{id:'a',name:'Direct',type:'subsidized',principal:'10000',annualRate:'0.06',disbursementDate:p.settings.startDate,termMonths:120}];expect(loanLimitNotices(p).join(' ')).toContain('$5,500');expect(loanLimitNotices(p).join(' ')).toContain('subsidized');p.borrower.level='graduate';expect(loanLimitNotices(p).join(' ')).toContain('interim exception');});

it('reports calendar overflow instead of rendering invalid federal projection dates',()=>{const p=createDefaultPlan();p.settings.graduationDate='9998-01-01';p.repayment.voluntaryStart={kind:'afterGraduation',months:0};expect(()=>modelRap(p)).toThrow('supported calendar');});

it('warns for graduate annual Direct limits without guessing transitional aggregate eligibility',()=>{const p=createDefaultPlan();p.borrower.level='graduate';p.loans=[{id:'g',name:'Graduate',type:'unsubsidized',principal:'25000',annualRate:'0.06',disbursementDate:p.settings.startDate,termMonths:120}];expect(loanLimitNotices(p).join(' ')).toContain('$20,500');p.loans[0].disbursementDate=p.settings.graduationDate;expect(loanLimitNotices(p).join(' ')).toContain('$20,500');expect(loanLimitNotices(p).join(' ')).toContain('interim exception');});

// ------------------------------------------------------------------ Lead policy updates (2026-10)

const directLoan = (id: string, principal: string, extra: Partial<PlannerLoan> = {}): PlannerLoan =>
  ({ id, name: id, type: 'unsubsidized', principal, annualRate: '0.065', disbursementDate: '2026-08-24', termMonths: 120, ...extra });
/** Repayment starts on the school start date with no grace, so no interest accrues before repayment. */
function immediatePlan(loans: PlannerLoan[]): PlannerPlan {
  const p = createDefaultPlan();
  p.settings.graduationDate = p.settings.startDate;
  p.repayment.voluntaryStart = { kind: 'afterGraduation', months: 0 };
  p.loans = loans.map(loan => ({ ...loan, disbursementDate: p.settings.startDate }));
  return p;
}

describe('graduate aggregate (FSA Loan Limits FAQ GPSLL-Q2)', () => {
  it('counts only modeled graduate Direct Loans toward $100,000 and notes prior graduate borrowing separately', () => {
    const p = createDefaultPlan();
    p.borrower.level = 'graduate';
    p.loans = [directLoan('a', '60000')];
    p.borrower.priorFederalDebt = '50000';
    const notices = loanLimitNotices(p).join(' ');
    expect(notices).not.toContain('exceeds the $100,000');
    expect(notices).toContain('borrowed earlier as a graduate student also count');
    expect(notices).toContain('financial aid office determines');
    p.loans = [directLoan('a', '100000.01')];
    p.borrower.priorFederalDebt = '0';
    const over = loanLimitNotices(p).join(' ');
    expect(over).toContain('exceeds the $100,000 graduate aggregate');
    expect(over).not.toContain('borrowed earlier');
  });
  it('keeps the $257,500 lifetime check including prior debt and states the legacy exemption', () => {
    const p = createDefaultPlan();
    p.borrower.level = 'graduate';
    p.loans = [directLoan('a', '60000')];
    p.borrower.priorFederalDebt = '197500';
    expect(loanLimitNotices(p).join(' ')).not.toContain('lifetime maximum');
    p.borrower.priorFederalDebt = '197500.01';
    const notices = loanLimitNotices(p).join(' ');
    expect(notices).toContain('$257,500 lifetime maximum');
    expect(notices).toContain('interim (legacy) exception are exempt');
  });
});

describe('IBR availability (34 CFR 685.210(a)(1)(ii), (a)(3))', () => {
  it('is unavailable for all loans once any Direct Loan is made on or after 2026-07-01', () => {
    const p = createDefaultPlan();
    p.settings = { ...p.settings, startDate: '2022-08-24', graduationDate: '2026-12-20' };
    p.loans = [directLoan('old', '20000', { disbursementDate: '2023-08-24' }), directLoan('new', '5000', { disbursementDate: federalReference.ibr.newLoansCutoff })];
    const result = modelIbr(p);
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.reason).toMatch(/Tiered Standard plan or RAP/);
    p.loans = [p.loans[0], { ...p.loans[1], disbursementDate: '2026-06-30' }];
    expect(modelIbr(p).eligible).toBe(true);
    p.loans = [{ ...p.loans[0], type: 'private' }];
    expect(modelIbr(p)).toMatchObject({ eligible: false, reason: expect.stringContaining('no Direct Loans') });
  });
});

describe('Tiered Standard plan (34 CFR 685.208(c)(1), reference tiers)', () => {
  it('chooses the term from the reference tiers (upper bounds exclusive)', () => {
    const cases: [string, number][] = [['0.01', 120], ['24999.99', 120], ['25000', 180], ['49999.99', 180], ['50000', 240], ['99999.99', 240], ['100000', 300], ['900000', 300]];
    for (const [balance, months] of cases) expect(tieredStandardTerm(balance)).toBe(months);
    // Terms come from reference data only.
    for (const [limit, months] of federalReference.tieredStandard.tiers) if (limit) expect(tieredStandardTerm(new D(limit).minus('0.01'))).toBe(months);
  });
  it('amortizes $30,000 at 6.5% over the 15-year tier with a final payment that ends at $0.00', () => {
    const result = modelTieredStandard(immediatePlan([directLoan('a', '30000')]));
    if (!result.eligible) throw new Error(result.reason);
    // M = 30000 × r / (1 − (1 + r)^−180), r = 0.065/12 → 261.3348… → 261.33
    const r = new D('0.065').div(12);
    expect(result.monthlyPayment).toBe(new D(30000).times(r).div(new D(1).minus(r.plus(1).pow(-180))).toFixed(2));
    expect(result.monthlyPayment).toBe('261.33');
    expect(result).toMatchObject({ termMonths: 180, balanceAtEntry: '30000.00', minimumApplied: false, eligibleLoanCount: 1 });
    expect(result.rows).toHaveLength(180);
    expect(result.rows.at(-1)?.balance).toBe('0.00');
    expect(sum(result.rows.map(row => row.principalPaid)).toFixed(2)).toBe('30000.00');
    expect(new D(result.totalPaid).minus(result.totalInterest).toFixed(2)).toBe('30000.00');
    for (const row of result.rows) expect(new D(row.interestPaid).plus(row.principalPaid).eq(row.payment)).toBe(true);
  });
  it('applies the $50 minimum payment, splits across loans, and skips non-Direct loans', () => {
    const result = modelTieredStandard(immediatePlan([directLoan('a', '600', { annualRate: '0' }), directLoan('b', '400', { annualRate: '0', type: 'subsidized' }), directLoan('p', '9000', { type: 'private' })]));
    if (!result.eligible) throw new Error(result.reason);
    expect(result).toMatchObject({ termMonths: 120, monthlyPayment: '50.00', minimumApplied: true, eligibleLoanCount: 2, totalPaid: '1000.00', totalInterest: '0.00' });
    expect(result.rows).toHaveLength(20);
    expect(modelTieredStandard(immediatePlan([directLoan('p', '9000', { type: 'private' })])).eligible).toBe(false);
  });
  it('includes interest accrued before repayment in the entry balance', () => {
    const p = createDefaultPlan();
    p.loans = [directLoan('a', '24000', { annualRate: '0.06' })];
    const result = modelTieredStandard(p);
    if (!result.eligible) throw new Error(result.reason);
    expect(new D(result.balanceAtEntry).gt(25000)).toBe(true);
    expect(result.termMonths).toBe(180);
    expect(result.rows.at(-1)?.balance).toBe('0.00');
  });
});
