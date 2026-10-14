import { useCallback, useState } from 'react';
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
import './planner.css';

const NAV = [
  ['setup', 'Timeline'], ['school', 'Costs'], ['loans', 'Loans'], ['repayment', 'Repayment'], ['events', 'Life events'],
  ['scenarios', 'Scenarios'], ['federal', 'Federal'], ['results', 'Results'], ['data', 'Your data'],
] as const;

export default function PlannerApp({ store }: { store: PlannerStore }) {
  return (
    <PlannerProvider store={store}>
      <PlannerLayout />
    </PlannerProvider>
  );
}

function PlannerLayout() {
  const { store } = usePlanner();
  const [disclaimerReopened, setDisclaimerReopened] = useState(false);
  const [focusLoanId, setFocusLoanId] = useState<string | null>(null);
  const clearLoanFocus = useCallback(() => setFocusLoanId(null), []);
  const showDisclaimer = !store.document.disclaimerDismissed || disclaimerReopened;

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to your plan</a>
      <header className="app-header">
        <div>
          <p className="eyebrow">From your first school year to your debt-free day</p>
          <h1>DebtNav</h1>
          <p className="tagline">A living student-debt plan. Edit anything; every result updates.</p>
        </div>
        <SaveStatusBadge />
      </header>
      <nav className="section-nav" aria-label="Planner sections">
        <ul>{NAV.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}</ul>
      </nav>
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
      <main id="main">
        <div className="layout">
          <div className="inputs">
            <SetupSection />
            <SchoolYearsSection onLoanCreated={setFocusLoanId} />
            <LoansSection focusLoanId={focusLoanId} onFocused={clearLoanFocus} />
            <RepaymentSection />
            <EventsSection />
            <ScenariosSection />
            <FederalSection />
          </div>
          <aside className="key-figures-rail" aria-label="Key results">
            <KeyFigures />
          </aside>
        </div>
        <div className="outputs">
          <ResultsSection />
          <DataSection />
        </div>
      </main>
      <footer className="app-footer">
        <button type="button" id="disclaimer-open" className="link-button" onClick={() => setDisclaimerReopened(true)}>
          About these estimates (disclaimer)
        </button>
        <p>DebtNav · Estimates for your own planning, not financial advice. Your data stays on this device.</p>
      </footer>
    </div>
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
