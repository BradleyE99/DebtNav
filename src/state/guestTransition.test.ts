// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createFakeApi } from './fakeApi';
import { createAccountGuard } from './accountGuard';
import { findGuestDraft, isDefaultPlan, markHandled, shouldOffer, useGuestPlanChoice, wasHandled } from './guestTransition';
import { accountCacheKey, guestChoiceKey, GUEST_PLAN_KEY } from './persistence';
import { exportDocument } from '../data/storage';
import { createDefaultPlan } from '../engine/planner';
import type { PlannerDocument } from '../engine/planner-contracts';

const USER = { id: 'user-1', email: 'alice@example.test' };

function guestDoc(salary = '12345.00'): PlannerDocument {
  const plan = createDefaultPlan();
  plan.postGradIncome = { ...plan.postGradIncome, annualSalary: salary };
  return { plan, disclaimerDismissed: true };
}
function accountDoc(): PlannerDocument {
  const plan = createDefaultPlan();
  plan.postGradIncome = { ...plan.postGradIncome, annualSalary: '99999.00' };
  return { plan, disclaimerDismissed: true };
}
const storeGuest = (document: PlannerDocument) => localStorage.setItem(GUEST_PLAN_KEY, exportDocument(document));

beforeEach(() => localStorage.clear());

describe('guest draft detection', () => {
  it('ignores a missing or default plan and finds an edited one (including legacy keys)', () => {
    expect(findGuestDraft(localStorage)).toBeNull();
    storeGuest({ plan: createDefaultPlan(), disclaimerDismissed: true });
    expect(findGuestDraft(localStorage)).toBeNull();
    expect(isDefaultPlan({ plan: createDefaultPlan(), disclaimerDismissed: false })).toBe(true);
    localStorage.clear();
    localStorage.setItem('debtnav.plan.v2', exportDocument(guestDoc()));
    expect(findGuestDraft(localStorage)?.document.plan.postGradIncome.annualSalary).toBe('12345.00');
  });

  it('remembers a choice per user and per exact draft, without storing plan data', () => {
    storeGuest(guestDoc());
    const draft = findGuestDraft(localStorage)!;
    markHandled('user-1', draft, localStorage);
    expect(wasHandled('user-1', draft, localStorage)).toBe(true);
    expect(wasHandled('user-2', draft, localStorage)).toBe(false);
    expect(localStorage.getItem(guestChoiceKey('user-1'))).not.toContain('12345');
    storeGuest(guestDoc('22222.00'));
    expect(shouldOffer('user-1', localStorage)).not.toBeNull();
  });

  it('unsynced account edits restored from this browser take priority over the offer', () => {
    storeGuest(guestDoc());
    localStorage.setItem(accountCacheKey('user-1'), JSON.stringify({ document: accountDoc(), baseRevision: 1, at: 'x' }));
    expect(shouldOffer('user-1', localStorage)).toBeNull();
    expect(shouldOffer('user-2', localStorage)).not.toBeNull();
  });
});

describe('useGuestPlanChoice', () => {
  function setup(serverDocument: PlannerDocument | null = null) {
    const { api, server } = createFakeApi({ document: serverDocument ?? undefined });
    const guard = createAccountGuard(USER.id, 1);
    const onUnauthorized = vi.fn();
    const hook = renderHook(() => useGuestPlanChoice({ client: api, user: USER, guard, onUnauthorized, storage: localStorage }));
    return { api, server, guard, onUnauthorized, hook };
  }

  it('resolves immediately with no request when there is nothing to offer', () => {
    const { hook, server } = setup();
    expect(hook.result.current.status).toBe('resolved');
    expect(server.calls).toEqual([]);
  });

  it('account without a plan: nothing is uploaded until "Save this plan to my account"', async () => {
    storeGuest(guestDoc());
    const { hook, server } = setup();
    await waitFor(() => expect(hook.result.current.status).toBe('offer'));
    expect(hook.result.current.status === 'offer' && hook.result.current.account).toBeNull();
    expect(server.calls).toEqual(['loadPlan']);
    act(() => hook.result.current.saveToAccount());
    await waitFor(() => expect(hook.result.current.status).toBe('resolved'));
    expect(server.calls).toEqual(['loadPlan', 'savePlan:null']);
    expect(server.document?.plan.postGradIncome.annualSalary).toBe('12345.00');
    expect(localStorage.getItem(GUEST_PLAN_KEY)).toBeNull();
  });

  it('"Not now" keeps the guest draft, uploads nothing and is remembered', async () => {
    storeGuest(guestDoc());
    const { hook, server } = setup();
    await waitFor(() => expect(hook.result.current.status).toBe('offer'));
    act(() => hook.result.current.keepSeparate());
    expect(hook.result.current.status).toBe('resolved');
    expect(server.calls).toEqual(['loadPlan']);
    expect(localStorage.getItem(GUEST_PLAN_KEY)).not.toBeNull();
    expect(shouldOffer(USER.id, localStorage)).toBeNull();
  });

  it('account with a plan: "Open my account plan" changes neither plan', async () => {
    storeGuest(guestDoc());
    const { hook, server } = setup(accountDoc());
    await waitFor(() => expect(hook.result.current.status).toBe('offer'));
    const state = hook.result.current;
    expect(state.status === 'offer' && state.account?.revision).toBe(1);
    act(() => hook.result.current.saveToAccount()); // not allowed when the account has a plan
    act(() => hook.result.current.keepSeparate());
    expect(server.calls).toEqual(['loadPlan']);
    expect(server.document?.plan.postGradIncome.annualSalary).toBe('99999.00');
    expect(localStorage.getItem(GUEST_PLAN_KEY)).not.toBeNull();
  });

  it('replace saves against the revision shown; a plan changed meanwhile is a conflict, never overwritten', async () => {
    storeGuest(guestDoc());
    const { hook, server } = setup(accountDoc());
    await waitFor(() => expect(hook.result.current.status).toBe('offer'));
    server.external(accountDoc()); // another device saved: revision 2
    act(() => hook.result.current.replaceAccountPlan());
    await waitFor(() => expect(hook.result.current.status === 'offer' && hook.result.current.error).toMatch(/nothing was replaced/i));
    expect(server.document?.plan.postGradIncome.annualSalary).toBe('99999.00');
    expect(hook.result.current.status === 'offer' && hook.result.current.account?.revision).toBe(2);
    act(() => hook.result.current.replaceAccountPlan());
    await waitFor(() => expect(hook.result.current.status).toBe('resolved'));
    expect(server.calls).toEqual(['loadPlan', 'savePlan:1', 'loadPlan', 'savePlan:2']);
    expect(server.document?.plan.postGradIncome.annualSalary).toBe('12345.00');
    expect(localStorage.getItem(GUEST_PLAN_KEY)).toBeNull();
  });

  it('a failed save keeps both plans and shows the error', async () => {
    storeGuest(guestDoc());
    const { hook, server } = setup();
    await waitFor(() => expect(hook.result.current.status).toBe('offer'));
    server.offline = true;
    act(() => hook.result.current.saveToAccount());
    await waitFor(() => expect(hook.result.current.status === 'offer' && hook.result.current.error).toMatch(/offline/i));
    expect(server.document).toBeNull();
    expect(localStorage.getItem(GUEST_PLAN_KEY)).not.toBeNull();
  });

  it('a response arriving after sign-out (guard revoked) changes nothing', async () => {
    storeGuest(guestDoc());
    const { hook, server, guard } = setup();
    await waitFor(() => expect(hook.result.current.status).toBe('offer'));
    let release!: () => void;
    server.gate = new Promise(resolve => { release = resolve; });
    act(() => hook.result.current.saveToAccount());
    guard.revoke();
    await act(async () => { release(); await Promise.resolve(); });
    await waitFor(() => expect(server.calls).toContain('savePlan:null'));
    expect(hook.result.current.status).toBe('offer');
    expect(localStorage.getItem(GUEST_PLAN_KEY)).not.toBeNull();
    expect(localStorage.getItem(guestChoiceKey(USER.id))).toBeNull();
  });

  it('requests are pinned to the user: another account in the cookie yields accountChanged, not a write', async () => {
    storeGuest(guestDoc());
    const { hook, server, onUnauthorized } = setup();
    await waitFor(() => expect(hook.result.current.status).toBe('offer'));
    server.user = { id: 'user-2', email: 'bob@example.test' };
    act(() => hook.result.current.saveToAccount());
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledWith('accountChanged'));
    expect(server.document).toBeNull();
    expect(localStorage.getItem(GUEST_PLAN_KEY)).not.toBeNull();
  });

  it('load failure offers retry or continuing without copying', async () => {
    storeGuest(guestDoc());
    const { api, server } = createFakeApi();
    server.offline = true;
    const guard = createAccountGuard(USER.id, 1);
    const hook = renderHook(() => useGuestPlanChoice({ client: api, user: USER, guard, onUnauthorized: () => {}, storage: localStorage }));
    await waitFor(() => expect(hook.result.current.status).toBe('loadError'));
    server.offline = false;
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.status).toBe('offer'));
  });
});
