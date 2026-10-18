import type { ReactNode } from 'react';
import './overview.css';

/**
 * DebtNav introduction: the two questions it answers. Shared by the signed-in Introduction and the
 * public signed-out page, so it needs no PlannerStore. It never repeats Results figures or tables.
 */
export interface OverviewContentProps {
  /** Heading id (level 2). */
  headingId: string;
  heading: ReactNode;
  /** Status line, sign-in button or Continue action under the introduction. */
  children?: ReactNode;
}

export function OverviewContent({ headingId, heading, children }: OverviewContentProps) {
  return (
    <>
      <h2 id={headingId}>{heading}</h2>
      <ul className="overview-tasks">
        <li className="overview-task">
          <h3>How much do I need to borrow?</h3>
          <p>Enter each school year's costs, grants, savings and work. See the funding gap per year.</p>
        </li>
        <li className="overview-task">
          <h3>When will I be debt-free?</h3>
          <p>Enter your loans and monthly payment. See your debt-free date and total interest.</p>
        </li>
      </ul>
      {children}
    </>
  );
}
