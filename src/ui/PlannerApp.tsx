import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { dashboardForFieldId, readinessStatusText } from '../data/readiness';
import type { PlannerStore } from '../engine/planner-contracts';
import { PlannerProvider, usePlanner } from './PlannerContext';
import { Disclaimer } from './sections/Disclaimer';
import { SchoolYearsSection } from './sections/SchoolYearsSection';
import { LoansSection } from './sections/LoansSection';
import { DataTools, SaveStatusBadge } from './sections/DataSection';
import type { AccountInfo, WorkbookApi } from './sections/dataExchange';
import { ResultsSection } from './results/ResultsSection';
import { AppShell } from './nav/AppShell';
import { AccountMenu } from './nav/AccountMenu';
import { NAV_ITEMS, isDashboard } from './nav/navItems';
import { OPEN_DATA_EVENT, navigateDashboard, resolveDashboard, type NavigateDetail } from './nav/navigation';
import { onRevealRequest, revealField } from './reveal';
import { OverviewContent } from './overview/OverviewContent';
import { UndoHistory, UndoHistoryPanel } from './common/UndoHistory';
import { Dialog } from './common/Dialog';
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

interface HashTarget { dashboard: string; fieldId?: string; openData?: boolean }

/**
 * Reads the hash: one of the four destinations, an older page's hash (redirected to its new home with
 * the matching field revealed) or #data (opens the data dialog on the current page). Legacy hashes are
 * rewritten in place so Back does not bounce through them.
 */
function readHash(current: string): HashTarget {
  let id = '';
  try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { /* malformed escape → default */ }
  const fallback = isDashboard(current) ? current : 'overview';
  const resolved = id ? resolveDashboard(id) : undefined;
  if (!resolved) return { dashboard: fallback };
  const dashboard = resolved.openData ? fallback : resolved.dashboard;
  if (dashboard !== id) window.history.replaceState(null, '', `#${dashboard}`);
  return { ...resolved, dashboard };
}

function PlannerLayout({ account, workbook, devicePlanPrompt }: Omit<PlannerAppProps, 'store'>) {
  const { store, plan, readiness } = usePlanner();
  const [initial] = useState(() => readHash(''));
  const [activeDashboard, setActiveDashboard] = useState(initial.dashboard);
  const [requestedFieldId, setRequestedFieldId] = useState<string | undefined>(initial.fieldId);
  const [navigationVersion, setNavigationVersion] = useState(0);
  const [dialog, setDialog] = useState<'data' | 'history' | null>(initial.openData ? 'data' : null);
  // Where a readiness action was followed from (`from`) and where it led (`to`). Navigation to another
  // dashboard clears it; the follow-up reveal navigation to the same dashboard keeps it.
  const [returnTo, setReturnTo] = useState<{ from: string; to: string }>();
  useEffect(() => { if (initial.fieldId) revealField(initial.fieldId); }, [initial]);
  useEffect(() => {
    let current = initial.dashboard;
    const historyChanged = () => {
      if (window.location.hash === '#main') return;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const next = readHash(current);
      current = next.dashboard;
      if (next.openData) setDialog('data');
      setRequestedFieldId(next.fieldId);
      setReturnTo(undefined);
      setActiveDashboard(next.dashboard);
      setNavigationVersion(version => version + 1);
      if (next.fieldId) revealField(next.fieldId);
    };
    const navigation = (event: Event) => {
      const { dashboard, fieldId, returnTo: from } = (event as CustomEvent<NavigateDetail>).detail;
      if (!isDashboard(dashboard)) return;
      current = dashboard;
      setRequestedFieldId(fieldId);
      setReturnTo(previous => from && isDashboard(from) ? { from, to: dashboard }
        : previous?.to === dashboard ? previous : undefined);
      setActiveDashboard(dashboard);
      setNavigationVersion(version => version + 1);
    };
    const openData = () => setDialog('data');
    window.addEventListener('hashchange', historyChanged);
    window.addEventListener('popstate', historyChanged);
    window.addEventListener('debt-nav:navigate', navigation);
    window.addEventListener(OPEN_DATA_EVENT, openData);
    return () => {
      window.removeEventListener('hashchange', historyChanged);
      window.removeEventListener('popstate', historyChanged);
      window.removeEventListener('debt-nav:navigate', navigation);
      window.removeEventListener(OPEN_DATA_EVENT, openData);
    };
  }, [initial]);
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
          <h1>DebtNav</h1>
          <div className="app-header__status">
            <SaveStatusBadge />
            <UndoHistory store={store} />
            <AccountMenu
              email={account?.email}
              signedIn={Boolean(account)}
              onOpenData={() => setDialog('data')}
              onOpenHistory={() => setDialog('history')}
              onOpenDisclaimer={() => setDisclaimerReopened(true)}
              onSignOut={account ? () => { void account.onSignOut(); } : undefined}
            />
          </div>
        </header>
      )}
      banner={showDisclaimer ? (
        <Disclaimer
          focusOnOpen={disclaimerReopened}
          onDismiss={() => {
            store.dismissDisclaimer();
            setDisclaimerReopened(false);
            if (disclaimerReopened) requestAnimationFrame(() => document.getElementById('disclaimer-open')?.focus());
          }}
        />
      ) : undefined}
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
        {activeDashboard === 'overview' && <Introduction />}
        {activeDashboard === 'school' && <SchoolYearsSection requestedFieldId={requestedFieldId} onLoanCreated={id => { setFocusLoanId(id); navigateDashboard('loans', `loans.${id}.name`); }} />}
        {activeDashboard === 'loans' && <LoansSection focusLoanId={focusLoanId} onFocused={clearLoanFocus} />}
        {activeDashboard === 'results' && <ResultsSection />}
      </div>
      {dialog === 'data' && (
        <Dialog title="Your data" onClose={() => setDialog(null)}>
          <DataTools workbook={workbook} signedIn={Boolean(account)} />
        </Dialog>
      )}
      {dialog === 'history' && (
        <Dialog title="Undo history" onClose={() => setDialog(null)}>
          <UndoHistoryPanel store={store} />
        </Dialog>
      )}
    </AppShell>
  );
}

/** Introduction: the two questions, one status line and a Continue action. No results figures. */
function Introduction() {
  const { readiness } = usePlanner();
  const next = readiness.items.find(item => item.severity === 'missing' || item.severity === 'invalid');
  const destination = (next && resolveDashboard(next.target.dashboard)?.dashboard) || 'results';
  const label = NAV_ITEMS.find(item => item.id === destination)?.label ?? 'Results';
  return (
    <section id="overview" className="panel overview" aria-labelledby="overview-heading">
      <OverviewContent headingId="overview-heading" heading="Plan your student loans">
        <div className="overview-continue">
          <a href={`#${destination}`} className="button-like button-primary"
            onClick={event => { event.preventDefault(); navigateDashboard(destination); }}>
            Continue to {label}
          </a>
          <p>{readinessStatusText(readiness)}</p>
        </div>
      </OverviewContent>
    </section>
  );
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
