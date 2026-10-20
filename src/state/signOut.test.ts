// @vitest-environment jsdom
import { cleanup, render, renderHook } from '@testing-library/react';
import { StrictMode, createElement, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StorageLike } from '../engine/planner-contracts';
import { createAccountGuard, type AccountGuard } from './accountGuard';
import { GUEST_PLAN_KEY, accountCacheKey, guestChoiceKey } from './persistence';
import { endAccountSession, hasUnsavedAccountChanges, signOutFlow, useAccountGuard, type SignOutFlowOptions } from './signOut';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function memory(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string>; writes: string[] } {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    data,
    writes,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); data.set(key, value); },
    removeItem: key => { data.delete(key); },
  };
}

const GUEST_DRAFT = '{"guest":"draft"}';

function setup(overrides: Partial<SignOutFlowOptions> & { dirty?: boolean } = {}) {
  const storage = memory({
    [GUEST_PLAN_KEY]: GUEST_DRAFT,
    [accountCacheKey('user-a')]: '{"account":"A unsaved"}',
    [accountCacheKey('user-b')]: '{"account":"B unsaved"}',
    [guestChoiceKey('user-a')]: 'handled',
  });
  const guard = createAccountGuard('user-a', 1);
  const order: string[] = [];
  guard.onRevoke(() => order.push('revoke'));
  let dirty = overrides.dirty ?? false;
  const session = {
    signOut: vi.fn(async () => {
      order.push(storage.data.has(accountCacheKey('user-a')) ? 'logout(cache present)' : 'logout(cache cleared)');
      return { loggedOut: true };
    }),
  };
  const { dirty: _ignored, ...rest } = overrides;
  void _ignored;
  const options: SignOutFlowOptions = {
    guard,
    userId: 'user-a',
    session,
    storage,
    flush: vi.fn(async () => { order.push('flush'); }),
    isDirty: () => dirty,
    confirmUnsaved: vi.fn(async () => 'signOutAnyway' as const),
    ...rest,
  };
  return { storage, guard, order, session, options, setDirty: (value: boolean) => { dirty = value; } };
}

describe('signOutFlow', () => {
  it('with everything saved: revokes the guard, clears only this account cache, then logs out', async () => {
    const { storage, guard, order, options } = setup();
    const outcome = await signOutFlow(options);
    expect(outcome).toEqual({ kind: 'signedOut', discardedUnsavedChanges: false, serverLogout: true, cacheCleared: true });
    expect(order).toEqual(['revoke', 'logout(cache cleared)']);
    expect(guard.active()).toBe(false);
    expect(options.confirmUnsaved).not.toHaveBeenCalled();
    expect(storage.data.has(accountCacheKey('user-a'))).toBe(false);
    // Guest draft and other accounts are untouched; nothing is written anywhere (no copy into guest storage).
    expect(storage.data.get(GUEST_PLAN_KEY)).toBe(GUEST_DRAFT);
    expect(storage.data.get(accountCacheKey('user-b'))).toBe('{"account":"B unsaved"}');
    expect(storage.data.get(guestChoiceKey('user-a'))).toBe('handled');
    expect(storage.writes).toEqual([]);
  });

  it('dirty edits that save during the flush sign out without asking', async () => {
    const ctx = setup({ dirty: true });
    ctx.options.flush = vi.fn(async () => { ctx.order.push('flush'); ctx.setDirty(false); });
    const outcome = await signOutFlow(ctx.options);
    expect(outcome.kind).toBe('signedOut');
    expect(ctx.options.confirmUnsaved).not.toHaveBeenCalled();
    expect(ctx.order).toEqual(['flush', 'revoke', 'logout(cache cleared)']);
  });

  it('unsaved edits that cannot be saved ask first; "Stay signed in" changes nothing', async () => {
    const { storage, guard, session, options } = setup({ dirty: true, confirmUnsaved: vi.fn(async () => 'stay' as const) });
    const outcome = await signOutFlow(options);
    expect(outcome).toEqual({ kind: 'stayed' });
    expect(options.flush).toHaveBeenCalledTimes(1);
    expect(guard.active()).toBe(true);
    expect(session.signOut).not.toHaveBeenCalled();
    expect(storage.data.has(accountCacheKey('user-a'))).toBe(true);
  });

  it('"Sign out anyway" discards the unsaved account edits (not copied to guest storage)', async () => {
    const { storage, guard, options } = setup({ dirty: true });
    const outcome = await signOutFlow(options);
    expect(outcome).toEqual({ kind: 'signedOut', discardedUnsavedChanges: true, serverLogout: true, cacheCleared: true });
    expect(guard.active()).toBe(false);
    expect(storage.data.has(accountCacheKey('user-a'))).toBe(false);
    expect(storage.data.get(GUEST_PLAN_KEY)).toBe(GUEST_DRAFT);
    expect(storage.writes).toEqual([]);
  });

  it('a flush that never finishes (offline) is bounded, then the user is asked', async () => {
    vi.useFakeTimers();
    const { options } = setup({ dirty: true, flush: () => new Promise<void>(() => {}), flushTimeoutMs: 1000 });
    const running = signOutFlow(options);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(running).resolves.toMatchObject({ kind: 'signedOut', discardedUnsavedChanges: true });
    expect(options.confirmUnsaved).toHaveBeenCalledTimes(1);
  });

  it('a failing flush is treated like unsaved changes', async () => {
    const { options } = setup({ dirty: true, flush: async () => { throw new Error('boom'); } });
    await expect(signOutFlow(options)).resolves.toMatchObject({ kind: 'signedOut', discardedUnsavedChanges: true });
    expect(options.confirmUnsaved).toHaveBeenCalledTimes(1);
  });

  it('a failed server logout is reported; local state is still cleared', async () => {
    const { storage, guard, options } = setup({ session: { signOut: async () => ({ loggedOut: false }) } });
    const outcome = await signOutFlow(options);
    expect(outcome).toMatchObject({ kind: 'signedOut', serverLogout: false });
    expect(guard.active()).toBe(false);
    expect(storage.data.has(accountCacheKey('user-a'))).toBe(false);
  });

  it('storage that throws does not block sign-out', async () => {
    const broken: StorageLike = { getItem: () => null, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    const { guard, session, options } = setup({ storage: broken });
    await expect(signOutFlow(options)).resolves.toMatchObject({ kind: 'signedOut', cacheCleared: false });
    expect(guard.active()).toBe(false);
    expect(session.signOut).toHaveBeenCalledTimes(1);
  });

  it('does nothing if the session already ended (guard revoked), even while the dialog was open', async () => {
    const first = setup();
    first.guard.revoke();
    await expect(signOutFlow(first.options)).resolves.toEqual({ kind: 'alreadyEnded' });
    expect(first.session.signOut).not.toHaveBeenCalled();

    const second = setup({ dirty: true });
    second.options.confirmUnsaved = async () => { second.guard.revoke(); return 'signOutAnyway'; };
    await expect(signOutFlow(second.options)).resolves.toEqual({ kind: 'alreadyEnded' });
    expect(second.session.signOut).not.toHaveBeenCalled();
  });
});

describe('hasUnsavedAccountChanges', () => {
  it.each([
    ['saved', false], ['paused', false], ['unavailable', false],
    ['pending', true], ['saving', true], ['offline', true], ['error', true], ['conflict', true],
  ] as const)('%s → %s', (state, expected) => {
    expect(hasUnsavedAccountChanges({ state })).toBe(expected);
  });
});

describe('endAccountSession', () => {
  const session = () => ({ markSignedOut: vi.fn(), retry: vi.fn() });

  it('expired: revokes the guard first and keeps the unsaved cache for the same user', () => {
    const storage = memory({ [accountCacheKey('user-a')]: 'A' });
    const guard = createAccountGuard('user-a', 1);
    const s = session();
    let activeWhenMarked: boolean | null = null;
    s.markSignedOut.mockImplementation(() => { activeWhenMarked = guard.active(); });
    endAccountSession({ guard, session: s, notice: 'expired', userId: 'user-a', storage });
    expect(activeWhenMarked).toBe(false);
    expect(s.markSignedOut).toHaveBeenCalledWith('expired');
    expect(storage.data.get(accountCacheKey('user-a'))).toBe('A');
  });

  it('deleted: clears that account cache only', () => {
    const storage = memory({ [accountCacheKey('user-a')]: 'A', [GUEST_PLAN_KEY]: GUEST_DRAFT });
    endAccountSession({ guard: createAccountGuard('user-a', 1), session: session(), notice: 'deleted', userId: 'user-a', storage });
    expect(storage.data.has(accountCacheKey('user-a'))).toBe(false);
    expect(storage.data.get(GUEST_PLAN_KEY)).toBe(GUEST_DRAFT);
  });

  it('accountChanged: re-checks who is signed in', () => {
    const s = session();
    const guard = createAccountGuard('user-a', 1);
    endAccountSession({ guard, session: s, notice: 'accountChanged' });
    expect(guard.active()).toBe(false);
    expect(s.retry).toHaveBeenCalledTimes(1);
    expect(s.markSignedOut).not.toHaveBeenCalled();
  });

  it('runs once: a second (late) call after revoke is ignored', () => {
    const s = session();
    const guard = createAccountGuard('user-a', 1);
    endAccountSession({ guard, session: s, notice: 'expired' });
    endAccountSession({ guard, session: s, notice: 'deleted' });
    expect(s.markSignedOut).toHaveBeenCalledTimes(1);
  });
});

describe('useAccountGuard', () => {
  it('keeps one guard per mount', () => {
    const { result, rerender } = renderHook(({ id, epoch }) => useAccountGuard(id, epoch), { initialProps: { id: 'user-a', epoch: 1 } });
    const first = result.current;
    rerender({ id: 'user-a', epoch: 1 });
    expect(result.current).toBe(first);
    expect(first).toMatchObject({ userId: 'user-a', epoch: 1 });
  });

  it('is revoked before child unmount effects run (so an unmount flush sees it inactive)', () => {
    const seen: boolean[] = [];
    function Child({ guard }: { guard: AccountGuard }) {
      useEffect(() => () => { seen.push(guard.active()); }, [guard]);
      return null;
    }
    function Shell() {
      const guard = useAccountGuard('user-a', 1);
      return createElement(Child, { guard });
    }
    const view = render(createElement(Shell));
    view.unmount();
    expect(seen).toEqual([false]);
  });

  it('under StrictMode ends with a live guard, and a guard revoked while mounted stays revoked', () => {
    const { result, rerender } = renderHook(() => useAccountGuard('user-a', 1), { wrapper: StrictMode });
    expect(result.current.active()).toBe(true);
    const live = result.current;
    live.revoke();
    rerender();
    expect(result.current).toBe(live);
    expect(result.current.active()).toBe(false);
  });

  it('under StrictMode is still revoked on a real unmount', () => {
    const { result, unmount } = renderHook(() => useAccountGuard('user-a', 1), { wrapper: StrictMode });
    const guard = result.current;
    unmount();
    expect(guard.active()).toBe(false);
  });
});
