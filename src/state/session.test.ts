// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiClient, MeResult } from './api';
import { createFakeApi } from './fakeApi';
import { AUTH_SIGNAL_KEY, SIGN_OUT_INCOMPLETE_DETAIL, useSession } from './session';

const alice = { id: 'user-a', email: 'alice@example.test' };
const bob = { id: 'user-b', email: 'bob@example.test' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => { window.localStorage.clear(); window.history.replaceState(null, '', '/'); });
afterEach(() => { cleanup(); window.localStorage.clear(); });

async function signedIn(client: ApiClient) {
  const hook = renderHook(() => useSession(client));
  await waitFor(() => expect(hook.result.current.status).toBe('signedIn'));
  return hook;
}

describe('useSession epoch', () => {
  it('starts at 0 for a guest and moves when a user is resolved', async () => {
    const guest = renderHook(() => useSession(createFakeApi({ user: null }).api));
    await waitFor(() => expect(guest.result.current.status).toBe('signedOut'));
    expect(guest.result.current.epoch).toBe(0);

    const { result } = await signedIn(createFakeApi({ user: alice }).api);
    expect(result.current.user?.id).toBe('user-a');
    expect(result.current.epoch).toBe(1);
  });

  it('signOut ends the server session, switches to guest mode, bumps the epoch and signals other tabs', async () => {
    const { api, server } = createFakeApi({ user: alice });
    const { result } = await signedIn(api);
    const before = result.current.epoch;
    let outcome: { loggedOut: boolean } | undefined;
    await act(async () => { outcome = await result.current.signOut(); });
    expect(outcome).toEqual({ loggedOut: true });
    expect(server.calls).toContain('logout');
    expect(result.current.status).toBe('signedOut');
    expect(result.current.user).toBeNull();
    expect(result.current.epoch).toBe(before + 1);
    expect(result.current.authNotice).toBe('signedOut');
    expect(result.current.authNoticeDetail).toBeNull();
    expect(window.localStorage.getItem(AUTH_SIGNAL_KEY)).toMatch(/^\d+$/);
  });

  it('a failed server logout still clears local state and says so', async () => {
    const { api } = createFakeApi({ user: alice });
    const client: ApiClient = { ...api, logout: async () => ({ ok: false }) };
    const { result } = await signedIn(client);
    let outcome: { loggedOut: boolean } | undefined;
    await act(async () => { outcome = await result.current.signOut(); });
    expect(outcome).toEqual({ loggedOut: false });
    expect(result.current.status).toBe('signedOut');
    expect(result.current.user).toBeNull();
    expect(result.current.authNotice).toBe('signedOut');
    expect(result.current.authNoticeDetail).toBe(SIGN_OUT_INCOMPLETE_DETAIL);
  });

  it('markSignedOut (expired session) bumps the epoch and shows the notice', async () => {
    const { result } = await signedIn(createFakeApi({ user: alice }).api);
    const before = result.current.epoch;
    act(() => result.current.markSignedOut('expired'));
    expect(result.current.status).toBe('signedOut');
    expect(result.current.epoch).toBe(before + 1);
    expect(result.current.authNotice).toBe('expired');
  });

  it('a late /api/me answer started before sign-out cannot restore the signed-in user', async () => {
    const { api } = createFakeApi({ user: alice });
    const gate = deferred<MeResult>();
    const client: ApiClient = { ...api, me: () => gate.promise };
    const { result } = renderHook(() => useSession(client));
    await waitFor(() => expect(result.current.status).toBe('loading'));
    act(() => result.current.markSignedOut('expired'));
    expect(result.current.status).toBe('signedOut');
    await act(async () => { gate.resolve({ ok: true, user: alice }); await gate.promise; });
    expect(result.current.status).toBe('signedOut');
    expect(result.current.user).toBeNull();
  });

  it('a late /api/me recheck started before sign-out cannot restore the user', async () => {
    const { api } = createFakeApi({ user: alice });
    const gate = deferred<MeResult>();
    let hold = false;
    const client: ApiClient = { ...api, me: () => (hold ? gate.promise : api.me()) };
    const { result } = await signedIn(client);
    hold = true;
    act(() => result.current.recheck());
    await act(async () => { await result.current.signOut(); });
    await act(async () => { gate.resolve({ ok: true, user: bob }); await gate.promise; });
    expect(result.current.status).toBe('signedOut');
    expect(result.current.user).toBeNull();
  });

  it('another tab signing out (storage signal) moves this tab to guest mode', async () => {
    const { api, server } = createFakeApi({ user: alice });
    const { result } = await signedIn(api);
    const before = result.current.epoch;
    server.user = null;
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: AUTH_SIGNAL_KEY, newValue: '1' })); });
    await waitFor(() => expect(result.current.status).toBe('signedOut'));
    expect(result.current.epoch).toBe(before + 1);
    expect(result.current.authNotice).toBe('signedOut');
  });

  it('another tab switching accounts moves this tab to the new account with a new epoch', async () => {
    const { api, server } = createFakeApi({ user: alice });
    const { result } = await signedIn(api);
    const before = result.current.epoch;
    server.user = bob;
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: AUTH_SIGNAL_KEY, newValue: '2' })); });
    await waitFor(() => expect(result.current.user?.id).toBe('user-b'));
    expect(result.current.epoch).toBe(before + 1);
  });

  it('the signal does nothing when the user is unchanged, and other keys are ignored', async () => {
    const { api, server } = createFakeApi({ user: null });
    const { result } = renderHook(() => useSession(api));
    await waitFor(() => expect(result.current.status).toBe('signedOut'));
    const calls = server.calls.length;
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'debtnav.plan', newValue: 'x' })); });
    expect(server.calls.length).toBe(calls);
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: AUTH_SIGNAL_KEY, newValue: '3' })); });
    await waitFor(() => expect(server.calls.length).toBe(calls + 1));
    expect(result.current.epoch).toBe(0);
    expect(result.current.authNotice).toBeNull();
  });

  it('retry keeps the epoch for the same user and bumps it for a different one', async () => {
    const { api, server } = createFakeApi({ user: alice });
    const { result } = await signedIn(api);
    const before = result.current.epoch;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('signedIn'));
    expect(result.current.epoch).toBe(before);
    server.user = bob;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.user?.id).toBe('user-b'));
    expect(result.current.epoch).toBe(before + 1);
  });
});
