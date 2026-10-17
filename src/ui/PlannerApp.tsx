import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { dashboardForFieldId, readinessStatusText } from '../data/readiness';
import { ResultFigure } from './results/Readiness';
import type { PlannerStore } from '../engine/planner-contracts';
import { PlannerProvider, usePlanner } from './PlannerContext';
import { Disclaimer } from './sections/Disclaimer';
import { SetupSection } from './sections/SetupSection';
import { SchoolYearsSection } from './sections/SchoolYearsSection';
import { LoansSection } from './sections/LoansSection';
import { RepaymentSection } from './sections/RepaymentSection';
import { EventsSection } from './sections/EventsSection';
import { ScenariosSection } from './sections/ScenariosSection';
import { FederalSection } from './sections/FederalSection';
import { DataSection, SaveStatusBadge } from './sections/DataSection';
import type { AccountInfo, WorkbookApi } from './sections/dataExchange';
import { ResultsSection } from './results/ResultsSection';
import { KeyFigures } from './results/KeyFigures';
import { AppShell } from './nav/AppShell';
import { NAV_ITEMS } from './nav/navItems';
import { navigateDashboard, type NavigateDetail } from './nav/navigation';
import { onRevealRequest } from './reveal';
import { IncomeSection } from './sections/IncomeSection';
import { OverviewContent } from './overview/OverviewContent';
import { UndoHistory } from './common/UndoHistory';
import { AccountHeader } from './auth/AuthComponents';
import { formatCurrency, formatDate, formatMonthYear, plural } from './format';
import { money, sum } from '../engine/money';
import './planner.css';

export interface PlannerAppProps {
  store: PlannerStore;
  /** Signed-in account (email + sign out). Omitted for the local store (tests, dev fallback). */
  account?: AccountInfo;
  /** Excel template/export/import through the account API. Omitted → Excel controls explain they need an account. */
  workbook?: WorkbookApi;
  /** Optional "Use my device plan" prompt (US-1201), rendered at the top of the main area. */
  devicePlanPrompt?: ReactNode;
}

export default function PlannerApp({ store, account, workbook, devicePlanPrompt }: PlannerAppProps) {
  return (
    <PlannerProvider store={store}>
      <PlannerLayout account={account} workbook={workbook} devicePlanPrompt={devicePlanPrompt} />
    </PlannerProvider>
  );
}

function PlannerLayout({ account, workbook, devicePlanPrompt }: Omit<PlannerAppProps, 'store'>) {
  const { store, plan, readiness } = usePlanner();
  const dashboardFromHash = () => {
    const id = window.location.hash.slice(1);
    return NAV_ITEMS.some(item => item.id === id) ? id : 'overview';
  };
  const [activeDashboard, setActiveDashboard] = useState(dashboardFromHash);
  const [requestedFieldId, setRequestedFieldId] = useState<string>();
  const [navigationVersion, setNavigationVersion] = useState(0);
  // Where a readiness action was followed from (`from`) and where it led (`to`). Navigation to another
  // dashboard clears it; the follow-up reveal navigation to the same dashboard keeps it.
  const [returnTo, setReturnTo] = useState<{ from: string; to: string }>();
  useEffect(() => {
    const historyChanged = () => { if (window.location.hash === '#main') return; if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); setRequestedFieldId(undefined); setReturnTo(undefined); setActiveDashboard(dashboardFromHash()); setNavigationVersion(version => version + 1); };
    const navigation = (event: Event) => {
      const { dashboard, fieldId, returnTo: from } = (event as CustomEvent<NavigateDetail>).detail;
      if (!NAV_ITEMS.some(item => item.id === dashboard)) return;
      setRequestedFieldId(fieldId);
      setReturnTo(previous => from && NAV_ITEMS.some(item => item.id === from) ? { from, to: dashboard }
        : previous?.to === dashboard ? previous : undefined);
      setActiveDashboard(dashboard);
      setNavigationVersion(version => version + 1);
    };
    window.addEventListener('hashchange', historyChanged);
    window.addEventListener('popstate', historyChanged);
    window.addEventListener('debt-nav:navigate', navigation);
    return () => {
      window.removeEventListener('hashchange', historyChanged);
      window.removeEventListener('popstate', historyChanged);
      window.removeEventListener('debt-nav:navigate', navigation);
    };
  }, []);
  useEffect(() => onRevealRequest(id => {
    // Same field → dashboard routing as the readiness checklist targets (src/data/readiness.ts).
    const dashboard = dashboardForFieldId(plan, id);
    if (dashboard) navigateDashboard(dashboard, id);
  }), [plan]);
  useEffect(() => {
    if (!navigationVersion) return;
    if (requestedFieldId && !(requestedFieldId.startsWith('schoolYears.') && requestedFieldId.split('.').length === 2)) return;
    const heading = document.getElementById(activeDashboard + '-heading') ?? document.getElementById('main');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
    window.scrollTo?.({ top: 0, behavior: 'instant' });
  }, [activeDashboard, requestedFieldId, navigationVersion]);
  const [disclaimerReopened, setDisclaimerReopened] = useState(false);
  const [focusLoanId, setFocusLoanId] = useState<string | null>(null);
  const clearLoanFocus = useCallback(() => setFocusLoanId(null), []);
  const showDisclaimer = !store.document.disclaimerDismissed || disclaimerReopened;

  return (
    <AppShell
      items={NAV_ITEMS}
      activeDashboard={activeDashboard}
      onDashboardChange={navigateDashboard}
      badges={readiness.byDashboard}
      header={(
        <header className="app-header">
          <div>
            <h1>DebtNav</h1>
          </div>
          <div className="app-header__status">
            <SaveStatusBadge />
            {account && <AccountHeader email={account.email} onSignOut={() => { void account.onSignOut(); }} />}
          </div>
          <UndoHistory store={store} />
        </header>
      )}
      banner={(
        <>
          {showDisclaimer && (
            <Disclaimer
              focusOnOpen={disclaimerReopened}
              onDismiss={() => {
                store.dismissDisclaimer();
                setDisclaimerReopened(false);
                if (disclaimerReopened) requestAnimationFrame(() => document.getElementById('disclaimer-open')?.focus());
              }}
            />
          )}
        </>
      )}
      footer={(
        <footer className="app-footer">
          <button type="button" id="disclaimer-open" className="link-button" onClick={() => setDisclaimerReopened(true)}>
            About these estimates (disclaimer)
          </button>
          <p>DebtNav · Estimates for your own planning, not financial advice.{account ? ' Your plan is saved to your DebtNav account.' : ''}</p>
        </footer>
      )}
    >
      {devicePlanPrompt}
      <div className="dashboard" data-dashboard={activeDashboard}>
        {returnTo?.to === activeDashboard && <ReturnLink dashboard={returnTo.from} />}
        {activeDashboard === 'overview' && <Overview />}
        {activeDashboard === 'income' && <IncomeSection requestedFieldId={requestedFieldId} />}
        {SUMMARY_DASHBOARDS.has(activeDashboard) && <DashboardSummary dashboard={activeDashboard} />}
        {activeDashboard === 'setup' && <SetupSection />}
        {activeDashboard === 'school' && <SchoolYearsSection requestedFieldId={requestedFieldId} onLoanCreated={id => { setFocusLoanId(id); navigateDashboard('loans', `loans.${id}.name`); }} />}
        {activeDashboard === 'loans' && <LoansSection focusLoanId={focusLoanId} onFocused={clearLoanFocus} />}
        {activeDashboard === 'repayment' && <RepaymentSection />}
        {activeDashboard === 'events' && <EventsSection />}
        {activeDashboard === 'scenarios' && <ScenariosSection />}
        {activeDashboard === 'federal' && <FederalSection />}
        {activeDashboard === 'results' && <ResultsSection />}
        {activeDashboard === 'data' && <DataSection workbook={workbook} signedIn={Boolean(account)} />}
      </div>
    </AppShell>
  );
}

/** US-903: introduction to DebtNav's two tasks + cards to the main dashboards. No Results charts or tables. */
function Overview() {
  const { plan, readiness } = usePlanner();
  const loansTotal = formatCurrency(money(sum(plan.loans.map(loan => loan.principal))));
  const status = {
    school: plural(plan.schoolYears.length, 'school year'),
    loans: plan.loans.length ? `${plural(plan.loans.length, 'loan')} · ${loansTotal}` : 'No loans yet',
    repayment: plan.repayment.payoffTarget?.mode === 'target' ? 'Planning to a payoff target' : `Budget ${formatCurrency(plan.postGradIncome.monthlyDebtBudget)}/mo`,
    results: readinessStatusText(readiness),
  };
  return <section id="overview" className="panel overview" aria-labelledby="overview-heading">
    <OverviewContent headingId="overview-heading" heading="Overview" onOpen={id => navigateDashboard(id)} status={status} />
    <KeyFigures />
  </section>;
}

const SUMMARY_DASHBOARDS = new Set(['setup', 'loans', 'repayment', 'events', 'scenarios', 'data']);

function DashboardSummary({ dashboard }: { dashboard: string }) {
  const { plan, projection } = usePlanner();
  const repayment = projection?.repayment;
  // Results-dependent metrics use the same readiness states as Results (never $0.00 or a date when inputs are missing).
  const metrics: Record<string, [string, ReactNode][]> = {
    setup: [['School years', String(plan.schoolYears.length)], ['Graduation', formatDate(plan.settings.graduationDate)]],
    loans: [['Loans', String(plan.loans.length)], ['Total borrowed', <ResultFigure key="borrowed" result="totalBorrowed" value={formatCurrency(money(sum(plan.loans.map(loan => loan.principal))))} action={false} />]],
    repayment: [['Monthly debt budget', formatCurrency(plan.postGradIncome.monthlyDebtBudget)],
      ['Minimum payments', <ResultFigure key="minimums" result="minimumPayments" value={`${formatCurrency(projection?.minimumTotal)}/mo`} action={false} />],
      ['Total projected interest', <ResultFigure key="interest" result="totalInterest" value={formatCurrency(repayment?.totalInterestPaid)} />]],
    events: [['Life events', String(plan.lifeEvents.length)], ['Income changes', String(plan.lifeEvents.filter(event => event.type === 'income').length)], ['Starting debt budget', formatCurrency(plan.postGradIncome.monthlyDebtBudget) + '/mo']],
    scenarios: [['Scenarios', String(plan.scenarios.length)], ['Base debt-free date', <ResultFigure key="debt-free" result="debtFreeDate" nonPayoffValue="No debt-free date" value={repayment?.debtFreeDate ? formatMonthYear(repayment.debtFreeDate) : 'No debt-free date'} />]],
    data: [['School years saved', String(plan.schoolYears.length)], ['Loans saved', String(plan.loans.length)], ['Scenarios saved', String(plan.scenarios.length)]],
  };
  return <dl className="dashboard-metrics" aria-label="Dashboard summary">{(metrics[dashboard] ?? []).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

/** "Back to Results" after following a readiness action to the field it needs. */
function ReturnLink({ dashboard }: { dashboard: string }) {
  const label = NAV_ITEMS.find(item => item.id === dashboard)?.label ?? dashboard;
  return (
    <p className="return-link">
      <a href={`#${dashboard}`} onClick={event => { event.preventDefault(); navigateDashboard(dashboard); }}>
        <span aria-hidden="true">←</span> Back to {label}
      </a>
    </p>
  );
}
