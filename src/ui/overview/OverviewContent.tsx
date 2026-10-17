import type { ReactNode } from 'react';
import './overview.css';

/**
 * US-903: DebtNav introduction + navigation hub. Shared by the signed-in Overview dashboard and the
 * public signed-out page, so it needs no PlannerStore. It never repeats Results charts or tables.
 */
export interface OverviewDestination {
  /** Dashboard id (matches NAV_ITEMS). */
  id: 'loans' | 'income' | 'repayment' | 'results' | 'school';
  title: string;
  description: string;
  action: string;
}

export const OVERVIEW_DESTINATIONS: readonly OverviewDestination[] = [
  { id: 'school', title: 'Costs', action: 'Open Costs',
    description: 'Tuition, housing and other costs for each school year, with grants, savings and family help. Shows each year\'s funding gap.' },
  { id: 'income', title: 'How much I make', action: 'Open How much I make',
    description: 'Income & Earnings: what you earn from work while in school, counted toward each school year\'s resources. After-graduation earnings are in Repayment Plan.' },
  { id: 'loans', title: 'Loans', action: 'Open Loans',
    description: 'Each loan you have or plan to take: amount, rate, academic year and when required payments start.' },
  { id: 'repayment', title: 'Repayment Plan', action: 'Open Repayment Plan',
    description: 'After-graduation salary, take-home pay and expenses, your monthly debt budget or a payoff target, and payoff strategy.' },
  { id: 'results', title: 'Results', action: 'Open Results',
    description: 'Debt-free date, total interest, school-year borrowing, payment dates and the full payment schedule.' },
];

export interface OverviewContentProps {
  /** Heading level-2 text and id prefix. */
  headingId: string;
  heading: ReactNode;
  /** Opens a dashboard; omitted on the public page (cards are descriptive only). */
  onOpen?(id: OverviewDestination['id']): void;
  /** Extra content under the introduction (status line, sign-in button…). */
  children?: ReactNode;
  /** Short line about each destination card's state (signed-in only), keyed by dashboard id. */
  status?: Partial<Record<OverviewDestination['id'], ReactNode>>;
}

export function OverviewContent({ headingId, heading, onOpen, children, status }: OverviewContentProps) {
  return (
    <>
      <h2 id={headingId}>{heading}</h2>
      <p className="section-intro">
        DebtNav helps you plan student loans in two parts, and you can use either part on its own:
      </p>
      <div className="overview-tasks">
        <section className="overview-task" aria-labelledby={`${headingId}-borrowing`}>
          <h3 id={`${headingId}-borrowing`}>1. Plan each year's borrowing</h3>
          <p>Enter school costs and the money you have for each academic year. DebtNav shows the funding gap, the loans already assigned to that year, and what is still unfunded.</p>
        </section>
        <section className="overview-task" aria-labelledby={`${headingId}-repayment`}>
          <h3 id={`${headingId}-repayment`}>2. Plan repayment</h3>
          <p>Enter your loans and what you can pay each month after graduation, or a date you want to be debt-free by. DebtNav projects your debt-free date, total interest, and when required payments start.</p>
        </section>
      </div>
      {children}
      <h3 className="overview-cards-title">{onOpen ? 'Go to' : 'What you can do after signing in'}</h3>
      <ul className="overview-cards">
        {OVERVIEW_DESTINATIONS.map(destination => (
          <li key={destination.id} className="overview-card">
            <h4 id={`${headingId}-card-${destination.id}`}>{destination.title}</h4>
            <p>{destination.description}</p>
            {status?.[destination.id] && <p className="overview-card__status">{status[destination.id]}</p>}
            {onOpen && (
              <a href={`#${destination.id}`} className="button-like overview-card__link"
                aria-describedby={`${headingId}-card-${destination.id}`}
                onClick={event => { event.preventDefault(); onOpen(destination.id); }}>
                {destination.action}
              </a>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
