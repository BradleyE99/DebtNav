/**
 * Independent tester: server-side account pinning (optional sign-in contract D). A client that pins requests
 * to a user id with X-DebtNav-User must never read or write another account's plan when the session cookie
 * belongs to someone else (e.g. another tab switched accounts). Private routes stay private for guests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, signInAs, api } from './support';
import { createDefaultPlan } from '../../src/engine/planner';

type Ctx = Awaited<ReturnType<typeof createTestContext>>;
const USER_HEADER = 'X-DebtNav-User';
const envelope = (document: unknown) => ({ app: 'debtnav', schemaVersion: 4, savedAt: '2026-10-19T00:00:00.000Z', document });
const docWithBudget = (budget: string) => {
  const plan = createDefaultPlan();
  return { plan: { ...plan, postGradIncome: { ...plan.postGradIncome, monthlyDebtBudget: budget } }, disclaimerDismissed: true };
};

let ctx: Ctx;
let alice: { cookie: string; userId: string };
let bob: { cookie: string; userId: string };

beforeEach(async () => {
  ctx = await createTestContext();
  alice = await signInAs(ctx, 'e2e|alice-guard', 'alice-guard@example.test');
  bob = await signInAs(ctx, 'e2e|bob-guard', 'bob-guard@example.test');
  expect((await api(ctx, 'PUT', '/api/plan', { cookie: alice.cookie, body: { baseRevision: null, envelope: envelope(docWithBudget('111.11')) } })).status).toBe(200);
  expect((await api(ctx, 'PUT', '/api/plan', { cookie: bob.cookie, body: { baseRevision: null, envelope: envelope(docWithBudget('222.22')) } })).status).toBe(200);
});
afterEach(async () => { await ctx.close(); });

const planOf = async (cookie: string) => (await api(ctx, 'GET', '/api/plan', { cookie })).json();

describe('X-DebtNav-User pinning', () => {
  it('a PUT pinned to alice but sent with bob\'s session is refused with 409 accountChanged and writes nothing', async () => {
    const response = await api(ctx, 'PUT', '/api/plan', {
      cookie: bob.cookie, headers: { [USER_HEADER]: alice.userId },
      body: { baseRevision: 1, envelope: envelope(docWithBudget('999.99')) },
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('accountChanged');
    const bobs = await planOf(bob.cookie);
    const alices = await planOf(alice.cookie);
    expect(bobs.revision).toBe(1);
    expect(bobs.document.plan.postGradIncome.monthlyDebtBudget).toBe('222.22');
    expect(alices.revision).toBe(1);
    expect(alices.document.plan.postGradIncome.monthlyDebtBudget).toBe('111.11');
  });

  it('a GET pinned to alice with bob\'s session never returns bob\'s plan', async () => {
    const response = await api(ctx, 'GET', '/api/plan', { cookie: bob.cookie, headers: { [USER_HEADER]: alice.userId } });
    expect(response.status).toBe(409);
    const text = await response.text();
    expect(text).not.toContain('222.22');
    expect(text).not.toContain('111.11');
  });

  it('a DELETE of account data pinned to another user deletes nothing', async () => {
    const response = await api(ctx, 'DELETE', '/api/account/data', { cookie: bob.cookie, headers: { [USER_HEADER]: alice.userId } });
    expect(response.status).toBe(409);
    expect((await planOf(bob.cookie)).document.plan.postGradIncome.monthlyDebtBudget).toBe('222.22');
  });

  it('a matching pin works like no pin', async () => {
    const get = await api(ctx, 'GET', '/api/plan', { cookie: alice.cookie, headers: { [USER_HEADER]: alice.userId } });
    expect(get.status).toBe(200);
    const put = await api(ctx, 'PUT', '/api/plan', {
      cookie: alice.cookie, headers: { [USER_HEADER]: alice.userId },
      body: { baseRevision: 1, envelope: envelope(docWithBudget('333.33')) },
    });
    expect(put.status).toBe(200);
    expect((await put.json()).revision).toBe(2);
    expect((await planOf(alice.cookie)).document.plan.postGradIncome.monthlyDebtBudget).toBe('333.33');
  });

  it('requests without the header behave as before (stale revision is still a plain conflict)', async () => {
    expect((await api(ctx, 'PUT', '/api/plan', { cookie: alice.cookie, body: { baseRevision: 1, envelope: envelope(docWithBudget('333.33')) } })).status).toBe(200);
    const stale = await api(ctx, 'PUT', '/api/plan', { cookie: alice.cookie, body: { baseRevision: 1, envelope: envelope(docWithBudget('444.44')) } });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).not.toBe('accountChanged');
    expect((await api(ctx, 'GET', '/api/me', { cookie: alice.cookie })).status).toBe(200);
  });

  it('the header never substitutes for a session: guests still get 401 on every private route', async () => {
    for (const [method, path] of [['GET', '/api/plan'], ['PUT', '/api/plan'], ['GET', '/api/me'], ['DELETE', '/api/account/data'], ['GET', '/api/workbook/export']] as const) {
      const response = await api(ctx, method, path, { headers: { [USER_HEADER]: alice.userId }, body: method === 'GET' ? undefined : {} });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
    expect((await api(ctx, 'GET', '/api/health')).status).toBe(200);
    expect((await api(ctx, 'GET', '/api/auth/config')).status).toBe(200);
  });
});
