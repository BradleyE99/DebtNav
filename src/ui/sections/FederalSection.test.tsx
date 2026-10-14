// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { renderPlanner, samplePlan } from '../testing/renderPlanner';

afterEach(cleanup);

it('compares Tiered Standard, RAP and IBR (unavailable for loans made on/after July 1, 2026) with sources', () => {
  renderPlanner({ plan: samplePlan() });
  const table = screen.getByRole('region', { name: 'Federal repayment plan comparison' });
  expect(within(table).getByText(/^Tiered Standard \(10-year term\)$/)).toBeTruthy();
  expect(within(table).getByText('Repayment Assistance Plan (RAP)')).toBeTruthy();
  const ibrRow = within(table).getByText('Income-Based Repayment (IBR)').closest('tr') as HTMLElement;
  expect(ibrRow.textContent).toMatch(/Not available:/);
  expect(screen.getByRole('link', { name: 'Tiered Standard rules' })).toBeTruthy();
  expect((screen.getByLabelText('Data year') as HTMLInputElement).value).toBe('latest');
});
