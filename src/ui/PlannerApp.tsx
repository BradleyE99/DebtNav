import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { dashboardForFieldId } from '../data/readiness';
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
import { ResultsSection } from './results/ResultsSection';
import { KeyFigures } from './results/KeyFigures';
import { AppShell } from './nav/AppShell';
import { NAV_ITEMS } from './nav/navItems';
import { navigateDashboard, type NavigateDetail } from './nav/navigation';
import { onRevealRequest } from './reveal';
import { IncomeSection } from './sections/IncomeSection';
import { formatCurrency, formatDate, formatMonthYear } from './format';
import { money, sum } from '../engine/money';
import './planner.css';


export default function PlannerApp({ store }: { store: PlannerStore }) {
  return (
    <PlannerProvider store={store}>
      <PlannerLayout />
    </PlannerProvider>
  );
}

function PlannerLayout() {
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
          <SaveStatusBadge />
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
          <UndoBar />
        </>
      )}
      footer={(
        <footer className="app-footer">
          <button type="button" id="disclaimer-open" className="link-button" onClick={() => setDisclaimerReopened(true)}>
            About these estimates (disclaimer)
          </button>
          <p>DebtNav · Estimates for your own planning, not financial advice. Your data stays on this device.</p>
        </footer>
      )}
    >
      <div className="dashboard" data-dashboard={activeDashboard}>
        {returnTo?.to === activeDashboard && <ReturnLink dashboard={returnTo.from} />}
        {activeDashboard === 'overview' && <Overview />}
        {activeDashboard === 'income' && <IncomeSection requestedFieldId={requestedFieldId} />}
        {activeDashboard !== 'overview' && activeDashboard !== 'income' && activeDashboard !== 'school' && activeDashboard !== 'results' && <DashboardSummary dashboard={activeDashboard} />}
        {activeDashboard === 'setup' && <SetupSection />}
        {activeDashboard === 'school' && <SchoolYearsSection requestedFieldId={requestedFieldId} onLoanCreated={id => { setFocusLoanId(id); navigateDashboard('loans', `loans.${id}.name`); }} />}
        {activeDashboard === 'loans' && <LoansSection focusLoanId={focusLoanId} onFocused={clearLoanFocus} />}
        {activeDashboard === 'repayment' && <RepaymentSection />}
        {activeDashboard === 'events' && <EventsSection />}
        {activeDashboard === 'scenarios' && <ScenariosSection />}
        {activeDashboard === 'federal' && <FederalSection />}
        {activeDashboard === 'results' && <ResultsSection />}
        {activeDashboard === 'data' && <DataSection />}
      </div>
    </AppShell>
  );
}

function Overview() {
  const { plan } = usePlanner();
  return <section id="overview" className="panel overview" aria-labelledby="overview-heading">
    <h2 id="overview-heading">Overview</h2>
    <p className="section-intro">Your plan at a glance. Open a dashboard to review or change its details.</p>
    <KeyFigures />
    <div className="button-row overview-actions">
      <button type="button" className="button-primary" onClick={() => navigateDashboard('income')}>Edit income</button>
      <button type="button" onClick={() => navigateDashboard('school')}>Review school costs</button>
      <button type="button" onClick={() => navigateDashboard('loans')}>Manage {plan.loans.length} loans</button>
      <button type="button" onClick={() => navigateDashboard('results')}>Explore results</button>
    </div>
    <p className="field-hint">Your earnings while in school, your expected salary, and the monthly amount you can pay toward loans all live in Income &amp; Earnings.</p>
  </section>;
}

function DashboardSummary({ dashboard }: { dashboard: string }) {
  const { plan, projection } = usePlanner();
  const repayment = projection?.repayment;
  // Results-dependent metrics use the same readiness states as Results (never $0.00 or a date when inputs are missing).
  const metrics: Record<string, [string, ReactNode][]> = {
    setup: [['School years', String(plan.schoolYears.length)], ['Graduation', formatDate(plan.settings.graduationDate)]],
    loans: [['Loans', String(plan.loans.length)], ['Total borrowed', <ResultFigure key="borrowed" result="totalBorrowed" value={formatCurrency(money(sum(plan.loans.map(loan => loan.principal))))} action={false} />]],
    repayment: [['Monthly loan budget', formatCurrency(plan.postGradIncome.monthlyDebtBudget)],
      ['Minimum payments', <ResultFigure key="minimums" result="minimumPayments" value={`${formatCurrency(projection?.minimumTotal)}/mo`} action={false} />],
      ['Total projected interest', <ResultFigure key="interest" result="totalInterest" value={formatCurrency(repayment?.totalInterestPaid)} />]],
    events: [['Life events', String(plan.lifeEvents.length)], ['Income changes', String(plan.lifeEvents.filter(event => event.type === 'income').length)], ['Starting loan budget', formatCurrency(plan.postGradIncome.monthlyDebtBudget) + '/mo']],
    scenarios: [['Scenarios', String(plan.scenarios.length)], ['Base debt-free date', <ResultFigure key="debt-free" result="debtFreeDate" nonPayoffValue="No debt-free date" value={repayment?.debtFreeDate ? formatMonthYear(repayment.debtFreeDate) : 'No debt-free date'} />]],
    federal: [['Federal loans', String(plan.loans.filter(loan => loan.type === 'subsidized' || loan.type === 'unsubsidized').length)], ['School years', String(plan.schoolYears.length)]],
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

/** One-level undo for destructive edits (record removal, school-year removal, copy-forward, import). */
function UndoBar() {
  const { store } = usePlanner();
  if (!store.undo) return null;
  const undo = store.undo;
  return (
    <div className="undo-bar" role="status">
      <span>{undo.label}.</span>
      <button type="button" onClick={() => undo.apply()}>Undo</button>
    </div>
  );
}
