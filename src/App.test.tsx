// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import App from './App';
afterEach(cleanup);
function dates(start: string, end: string) {
  fireEvent.change(screen.getByLabelText('School start date'), {target:{value:start}});
  fireEvent.change(screen.getByLabelText('Expected graduation date'), {target:{value:end}});
}
it('creates, extends and shortens a plan using the form', async () => {
  const user = userEvent.setup(); render(<App />);
  dates('2026-08-24','2030-05-15');
  await user.click(screen.getByRole('button',{name:'Create plan'}));
  expect(screen.getAllByRole('listitem')).toHaveLength(4);
  dates('2026-08-24','2031-05-15');
  await user.click(screen.getByRole('button',{name:'Save changes'}));
  expect(screen.getAllByRole('listitem')).toHaveLength(5);
  dates('2026-08-24','2027-05-15');
  await user.click(screen.getByRole('button',{name:'Save changes'}));
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
});
it('shows field errors and preserves the saved plan after an invalid edit', async () => {
  const user = userEvent.setup(); render(<App />);
  dates('2026-08-24','2025-05-15');
  await user.click(screen.getByRole('button',{name:'Create plan'}));
  expect(screen.getByRole('alert').textContent).toContain('Graduation must');
  expect(screen.queryByRole('list')).toBeNull();
  dates('2026-08-24','2030-05-15');
  await user.click(screen.getByRole('button',{name:'Create plan'}));
  dates('2026-08-24','2025-05-15');
  await user.click(screen.getByRole('button',{name:'Save changes'}));
  expect(screen.getAllByRole('listitem')).toHaveLength(4);
  expect(screen.getByLabelText('Expected graduation date').getAttribute('aria-invalid')).toBe('true');
});
it('has no detectable accessibility violations for initial, error and saved states', async () => {
  render(<App />);
  const check = async () => expect((await axe.run(document.body,{rules:{'color-contrast':{enabled:false}}})).violations).toEqual([]);
  await check();
  fireEvent.click(screen.getByRole('button',{name:'Create plan'}));
  await check();
  dates('2026-08-24','2030-05-15');
  fireEvent.click(screen.getByRole('button',{name:'Create plan'}));
  await check();
});
