// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from './AppShell';
import { NAV_ITEMS } from './navItems';
import { navigateDashboard } from './navigation';
import { renderPlanner, samplePlan } from '../testing/renderPlanner';

function Shell({ badges }: { badges?: Partial<Record<string, number>> }) {
  const readDashboard = () => {
    try {
      const id = decodeURIComponent(window.location.hash.slice(1));
      return NAV_ITEMS.some(item => item.id === id) ? id : 'overview';
    } catch { return 'overview'; }
  };
  const [active, setActive] = useState(readDashboard);
  useEffect(() => {
    const sync = () => setActive(readDashboard());
    window.addEventListener('debt-nav:navigate', sync);
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('debt-nav:navigate', sync);
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);
  useEffect(() => { document.getElementById(active + '-heading')?.focus(); }, [active]);
  const item = NAV_ITEMS.find(entry => entry.id === active)!;
  return (
    <AppShell items={NAV_ITEMS} activeDashboard={active} onDashboardChange={navigateDashboard} badges={badges}
      header={<header><h1>DebtNav</h1></header>} footer={<footer>Footer</footer>}>
      <section id={item.id} aria-labelledby={item.id + '-heading'}>
        <h2 id={item.id + '-heading'} tabIndex={-1}>{item.label} dashboard</h2>
      </section>
    </AppShell>
  );
}

const nav = () => screen.getByRole('navigation', { name: 'Planner sections' });
const link = (name: string) => within(nav()).getByRole('link', { name });

beforeEach(() => { localStorage.clear(); window.history.replaceState(null, '', '/'); });
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

describe('destination tabs', () => {
  it('renders the four destinations as links, with the skip link first', () => {
    render(<Shell />);
    expect(within(nav()).getAllByRole('link').map(a => [a.querySelector('.tab-label:not(.tab-label--short)')?.textContent, a.getAttribute('href')])).toEqual([
      ['Introduction', '#overview'], ['College Costs', '#school'], ['Loan Amounts', '#loans'], ['Results', '#results'],
    ]);
    const firstLink = document.querySelector('a');
    expect(firstLink?.textContent).toBe('Skip to your plan');
    expect(document.querySelector('main#main')).toBeTruthy();
  });

  it('marks the active tab with aria-current="page" and moves it on click (focus goes to the heading)', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    expect(link('Introduction').getAttribute('aria-current')).toBe('page');
    expect(nav().querySelectorAll('[aria-current]')).toHaveLength(1);
    await user.click(link('Loan Amounts'));
    expect(link('Loan Amounts').getAttribute('aria-current')).toBe('page');
    expect(link('Introduction').hasAttribute('aria-current')).toBe(false);
    expect(window.location.hash).toBe('#loans');
    expect(document.activeElement?.id).toBe('loans-heading');
  });

  it('leaves modified clicks (new tab) to the browser', () => {
    render(<Shell />);
    const event = fireEvent.click(link('Results'), { ctrlKey: true });
    expect(event).toBe(true);
    expect(link('Introduction').getAttribute('aria-current')).toBe('page');
  });

  it('shows a needed-items badge as a description that keeps the link name', () => {
    render(<Shell badges={{ loans: 2 }} />);
    const loans = link('Loan Amounts');
    expect(loans.querySelector('.tab-badge')?.textContent).toBe('2');
    expect(document.getElementById(loans.getAttribute('aria-describedby')!)?.textContent).toBe('2 items needed');
    expect(link('Results').hasAttribute('aria-describedby')).toBe(false);
  });

  it('restores the initial hash and follows hash changes and browser history', () => {
    window.history.replaceState(null, '', '/#loans');
    render(<Shell />);
    expect(link('Loan Amounts').getAttribute('aria-current')).toBe('page');
    act(() => {
      window.history.pushState(null, '', '#results');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(link('Results').getAttribute('aria-current')).toBe('page');
    act(() => {
      window.history.replaceState(null, '', '#school');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(link('College Costs').getAttribute('aria-current')).toBe('page');
    expect(nav().querySelectorAll('[aria-current]')).toHaveLength(1);
  });

  it('ignores malformed hash escapes on initial load', () => {
    window.history.replaceState(null, '', '/#%E0%A4%A');
    render(<Shell />);
    expect(link('Introduction').getAttribute('aria-current')).toBe('page');
  });
});

describe('old bookmarks redirect to the new homes (planner)', () => {
  const cases: [string, string, string | null][] = [
    ['setup', 'school', 'settings.startDate'],
    ['income', 'school', 'income-add-earnings'],
    ['repayment', 'results', 'postGradIncome.monthlyDebtBudget'],
    ['events', 'results', 'lifeEvents-add-income'],
    ['scenarios', 'results', null],
    ['federal', 'results', null],
  ];
  for (const [legacy, dashboard, fieldId] of cases) {
    it(`#${legacy} → #${dashboard}`, async () => {
      window.history.replaceState(null, '', `/#${legacy}`);
      renderPlanner({ plan: samplePlan() });
      expect(document.querySelector('.dashboard')?.getAttribute('data-dashboard')).toBe(dashboard);
      expect(window.location.hash).toBe(`#${dashboard}`);
      if (fieldId) await waitFor(() => expect(document.activeElement?.id).toBe(fieldId));
    });
  }

  it('#data opens the Your data dialog on the current page; a later #repayment hash change redirects too', async () => {
    window.history.replaceState(null, '', '/#data');
    renderPlanner({ plan: samplePlan() });
    expect(screen.getByRole('dialog', { name: 'Your data' })).toBeTruthy();
    expect(document.querySelector('.dashboard')?.getAttribute('data-dashboard')).toBe('overview');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => {
      window.history.pushState(null, '', '#repayment');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(document.querySelector('.dashboard')?.getAttribute('data-dashboard')).toBe('results');
    expect(window.location.hash).toBe('#results');
  });

  it('navigateDashboard() with an old id lands on the new home', () => {
    renderPlanner({ plan: samplePlan() });
    act(() => navigateDashboard('setup'));
    expect(document.querySelector('.dashboard')?.getAttribute('data-dashboard')).toBe('school');
  });
});
