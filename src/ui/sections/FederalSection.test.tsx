// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderPlanner, samplePlan } from '../testing/renderPlanner';

beforeEach(() => { window.history.replaceState(null, '', '/#federal'); });
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); });

// US-905 replaced the federal limits, repayment-plan comparison and College Scorecard tools with a placeholder.
it('shows only "Coming soon": no federal controls, tables or Scorecard lookup', () => {
  const view = renderPlanner({ plan: samplePlan() });
  const section = screen.getByRole('region', { name: 'Federal' });
  expect(section.textContent).toBe('FederalComing soon');
  expect(section.querySelectorAll('input, select, button, table, details')).toHaveLength(0);
  expect(screen.queryByText(/Scorecard/)).toBeNull();
  expect(screen.queryByRole('region', { name: 'Federal repayment plan comparison' })).toBeNull();
  // The dashboard has no summary metrics either.
  expect(document.querySelector('.dashboard-metrics')).toBeNull();
  // Federal loans and stored federal settings are untouched.
  expect(view.plan().loans.map(loan => loan.type)).toEqual(['unsubsidized', 'private']);
  expect(view.plan().repayment.federalPlan).toBe(samplePlan().repayment.federalPlan);
});
