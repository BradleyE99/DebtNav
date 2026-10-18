/**
 * Cross-user authorization (US-1201): every route that touches plan data must use the session owner only, never
 * an id from the body, params, or query. Tester-owned; uses backend's in-memory test context (server/test/support.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, signInAs, api } from './support';
import { createDefaultPlan } from '../../src/engine/planner';

type Ctx = Awaited<ReturnType<typeof createTestContext>>;
const envelope = (document: unknown) => ({ app: 'debtnav', schemaVersion: 4, savedAt: '2026-10-16T00:00:00.000Z', document });
const docWithBudget = (budget: string) => {
  const plan = createDefaultPlan();
  return { plan: { ...plan, postGradIncome: { ...plan.postGradIncome, monthlyDebtBudget: budget } }, disclaimerDismissed: true };
};

let ctx: Ctx;
let alice: { cookie: string; userId: string };
let bob: { cookie: string; userId: string };

beforeEach(async () => {
  ctx = await createTestContext();
  alice = await signInAs(ctx, 'e2e|alice', 'alice@example.test');
  bob = await signInAs(ctx, 'e2e|bob', 'bob@example.test');
  const put = await api(ctx, 'PUT', '/api/plan', { cookie: alice.cookie, body: { baseRevision: null, envelope: envelope(docWithBudget('111.11')) } });
  expect(put.status).toBe(200);
});
afterEach(async () => { await ctx.close(); });

const alicesBudget = async () => {
  const response = await api(ctx, 'GET', '/api/plan', { cookie: alice.cookie });
  const body = await response.json();
  return { revision: body.revision, budget: body.document.plan.postGradIncome.monthlyDebtBudget };
};

describe('unauthenticated requests are refused on every data route', () => {
  it.each([
    ['GET', '/api/plan'], ['PUT', '/api/plan'], ['GET', '/api/me'], ['DELETE', '/api/account/data'],
    ['GET', '/api/workbook/template?years=1&loans=1'], ['GET', '/api/workbook/export'],
    ['POST', '/api/workbook/import/preview'], ['POST', '/api/workbook/import/commit'],
  ])('%s %s → 401', async (method, path) => {
    const response = await api(ctx, method, path, { body: method === 'GET' ? undefined : {} });
    expect(response.status).toBe(401);
  });
  it('a forged or expired-looking cookie is not a session', async () => {
    const response = await api(ctx, 'GET', '/api/plan', { cookie: 'debtnav_session=' + 'A'.repeat(43) });
    expect(response.status).toBe(401);
  });
  it('public routes stay public', async () => {
    expect((await api(ctx, 'GET', '/api/health')).status).toBe(200);
    expect((await api(ctx, 'GET', '/api/auth/config')).status).toBe(200);
  });
});

describe('a second user can never read or change the first user\'s plan', () => {
  it('bob starts with no plan and never sees alice\'s', async () => {
    const body = await (await api(ctx, 'GET', '/api/plan', { cookie: bob.cookie })).json();
    expect(body.document).toBeNull();
    expect(JSON.stringify(body)).not.toContain('111.11');
  });

  it('owner ids in query, body or headers are ignored', async () => {
    for (const path of [`/api/plan?ownerId=${alice.userId}`, `/api/plan?userId=${alice.userId}`, `/api/plan/${alice.userId}`]) {
      const response = await api(ctx, 'GET', path, { cookie: bob.cookie });
      if (response.status === 200) expect(JSON.stringify(await response.json())).not.toContain('111.11');
      else expect([401, 403, 404]).toContain(response.status);
    }
    const put = await api(ctx, 'PUT', '/api/plan', {
      cookie: bob.cookie, headers: { 'X-User-Id': alice.userId },
      body: { baseRevision: 1, ownerId: alice.userId, userId: alice.userId, envelope: envelope(docWithBudget('999.99')) },
    });
    // bob has no plan at revision 1: a conflict (or a create for bob) is fine, but alice's plan must not change.
    expect([200, 409]).toContain(put.status);
    expect(await alicesBudget()).toEqual({ revision: 1, budget: '111.11' });
  });

  it('bob\'s workbook export contains only bob\'s data', async () => {
    const response = await api(ctx, 'GET', '/api/workbook/export', { cookie: bob.cookie });
    if (response.status === 200) {
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.includes(Buffer.from('111.11'))).toBe(false);
    } else {
      expect([404, 409]).toContain(response.status);
    }
  });

  it('import previews are owned: bob cannot commit alice\'s previewId', async () => {
    const exported = await api(ctx, 'GET', '/api/workbook/export', { cookie: alice.cookie });
    expect(exported.status).toBe(200);
    const form = new FormData();
    form.append('file', new Blob([await exported.arrayBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'alice.xlsx');
    const preview = await ctx.app.request('/api/workbook/import/preview', { method: 'POST', body: form, headers: { cookie: alice.cookie, 'X-Requested-With': 'debtnav' } });
    expect(preview.status).toBe(200);
    const { previewId } = await preview.json();
    const steal = await api(ctx, 'POST', '/api/workbook/import/commit', { cookie: bob.cookie, body: { previewId, baseRevision: null } });
    expect([403, 404, 410]).toContain(steal.status);
    expect((await (await api(ctx, 'GET', '/api/plan', { cookie: bob.cookie })).json()).document).toBeNull();
  });

  it('bob deleting his account leaves alice\'s plan and session intact', async () => {
    expect((await api(ctx, 'DELETE', '/api/account/data', { cookie: bob.cookie })).status).toBe(204);
    expect((await api(ctx, 'GET', '/api/plan', { cookie: bob.cookie })).status).toBe(401);
    expect(await alicesBudget()).toEqual({ revision: 1, budget: '111.11' });
  });

  it('logout ends only that session', async () => {
    expect((await api(ctx, 'POST', '/api/auth/logout', { cookie: bob.cookie })).status).toBe(204);
    expect((await api(ctx, 'GET', '/api/me', { cookie: bob.cookie })).status).toBe(401);
    expect((await api(ctx, 'GET', '/api/me', { cookie: alice.cookie })).status).toBe(200);
  });
});

describe('CSRF and concurrency guards', () => {
  it('non-GET without X-Requested-With is refused and changes nothing', async () => {
    const response = await api(ctx, 'PUT', '/api/plan', { cookie: alice.cookie, csrf: false, body: { baseRevision: 1, envelope: envelope(docWithBudget('222.22')) } });
    expect(response.status).toBe(403);
    expect(await alicesBudget()).toEqual({ revision: 1, budget: '111.11' });
    expect((await api(ctx, 'DELETE', '/api/account/data', { cookie: alice.cookie, csrf: false })).status).toBe(403);
    expect((await api(ctx, 'GET', '/api/me', { cookie: alice.cookie })).status).toBe(200);
  });

  it('a stale revision is a 409 conflict, never a silent overwrite', async () => {
    const first = await api(ctx, 'PUT', '/api/plan', { cookie: alice.cookie, body: { baseRevision: 1, envelope: envelope(docWithBudget('200.00')) } });
    expect(first.status).toBe(200);
    expect((await first.json()).revision).toBe(2);
    const stale = await api(ctx, 'PUT', '/api/plan', { cookie: alice.cookie, body: { baseRevision: 1, envelope: envelope(docWithBudget('300.00')) } });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: 'conflict', serverRevision: 2 });
    expect(await alicesBudget()).toEqual({ revision: 2, budget: '200.00' });
  });

  it('simultaneous saves with the same base revision: exactly one wins', async () => {
    const results = await Promise.all(['301.00', '302.00', '303.00'].map(budget =>
      api(ctx, 'PUT', '/api/plan', { cookie: alice.cookie, body: { baseRevision: 1, envelope: envelope(docWithBudget(budget)) } })));
    expect(results.map(r => r.status).sort()).toEqual([200, 409, 409]);
    expect((await alicesBudget()).revision).toBe(2);
  });

  it('invalid plans are rejected with field errors and leave the plan unchanged', async () => {
    const bad = docWithBudget('-5');
    const response = await api(ctx, 'PUT', '/api/plan', { cookie: alice.cookie, body: { baseRevision: 1, envelope: envelope(bad) } });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.errors.some((e: { path: string }) => e.path === 'postGradIncome.monthlyDebtBudget')).toBe(true);
    expect(await alicesBudget()).toEqual({ revision: 1, budget: '111.11' });
  });

  it('older schema envelopes are migrated server-side on save', async () => {
    const v3plan: Record<string, unknown> = JSON.parse(JSON.stringify(createDefaultPlan()));
    const settings = v3plan.settings as Record<string, unknown>;
    settings.graceMonths = 6;
    const repayment = v3plan.repayment as Record<string, unknown>;
    delete repayment.payoffTarget; delete repayment.voluntaryStart; repayment.maxMonths = 360;
    const response = await api(ctx, 'PUT', '/api/plan', { cookie: alice.cookie, body: { baseRevision: 1, envelope: { ...envelope({ plan: v3plan, disclaimerDismissed: true }), schemaVersion: 3 } } });
    expect(response.status).toBe(200);
    const stored = await (await api(ctx, 'GET', '/api/plan', { cookie: alice.cookie })).json();
    expect(stored.document.plan.settings.graceMonths).toBeUndefined();
    expect(stored.document.plan.repayment.voluntaryStart).toEqual({ kind: 'afterGraduation', months: 6 });
  });
});
