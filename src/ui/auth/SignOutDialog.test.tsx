// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '../../engine/contracts';
import type { SignOutDecision } from '../../state/signOut';
import { SIGN_OUT_UNSAVED_TITLE, useSignOutConfirm } from './SignOutDialog';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Harness({ exportJson, onDecision }: { exportJson(): Result<string>; onDecision(d: SignOutDecision): void }) {
  const { confirmUnsaved, dialog } = useSignOutConfirm({ exportJson });
  return (
    <>
      <button type="button" onClick={() => { void confirmUnsaved().then(onDecision); }}>Sign out</button>
      {dialog}
    </>
  );
}

describe('SignOutDialog / useSignOutConfirm', () => {
  it('shows the unsaved-changes question with three choices; Sign out anyway resolves signOutAnyway', async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn();
    render(<Harness exportJson={() => ({ ok: true, value: '{}' })} onDecision={onDecision} />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    const dialog = screen.getByRole('alertdialog', { name: SIGN_OUT_UNSAVED_TITLE });
    expect(dialog).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export a copy' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stay signed in' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Sign out anyway' }));
    expect(onDecision).toHaveBeenCalledWith('signOutAnyway');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Stay signed in and Escape resolve stay', async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn();
    render(<Harness exportJson={() => ({ ok: true, value: '{}' })} onDecision={onDecision} />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    // Focus starts on the safe choice.
    expect(document.activeElement?.textContent).toBe('Stay signed in');
    await user.click(screen.getByRole('button', { name: 'Stay signed in' }));
    expect(onDecision).toHaveBeenLastCalledWith('stay');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.keyboard('{Escape}');
    expect(onDecision).toHaveBeenLastCalledWith('stay');
    expect(onDecision).toHaveBeenCalledTimes(2);
  });

  it('Export a copy downloads the plan JSON and keeps the dialog open', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => 'blob:plan');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const exportJson = vi.fn(() => ({ ok: true as const, value: '{"plan":1}' }));
    render(<Harness exportJson={exportJson} onDecision={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.click(screen.getByRole('button', { name: 'Export a copy' }));
    expect(exportJson).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText(/Plan exported as a JSON file/)).toBeTruthy();
  });

  it('a failed export is reported truthfully', async () => {
    const user = userEvent.setup();
    render(<Harness exportJson={() => ({ ok: false, errors: [{ path: '', code: 'REQUIRED', message: 'Nothing to export.' }] })} onDecision={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.click(screen.getByRole('button', { name: 'Export a copy' }));
    expect(screen.getByText('Export failed. Nothing to export.')).toBeTruthy();
  });

  it('a second request supersedes an unanswered one (the first resolves stay)', async () => {
    const { result } = renderHook(() => useSignOutConfirm({ exportJson: () => ({ ok: true, value: '{}' }) }));
    let first: Promise<SignOutDecision> | undefined;
    act(() => { first = result.current.confirmUnsaved(); });
    act(() => { void result.current.confirmUnsaved(); });
    await expect(first).resolves.toBe('stay');
  });
});
