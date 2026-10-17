/** GET/PUT /api/plan and DELETE /api/account/data. The owner is always the session user. */
import { Hono } from 'hono';
import { z } from 'zod';
import { type Env, clearSessionCookie, json, requireUser } from '../http';
import { checkEnvelope } from '../planDocument';
import { deleteAccount, loadPlan, savePlan } from '../plans';

export const revisionSchema = z.number().int().min(1).max(2_000_000_000).nullable();
const putSchema = z.object({ baseRevision: revisionSchema, envelope: z.unknown() });

export async function readJson(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

export function planRoutes() {
  const routes = new Hono<Env>();
  routes.use('*', requireUser);

  routes.get('/', async c => {
    const loaded = await loadPlan(c.var.ctx.deps.db, c.var.user.id);
    c.header('Cache-Control', 'no-store');
    return json(c, 200, loaded);
  });

  routes.put('/', async c => {
    const body = putSchema.safeParse(await readJson(c));
    if (!body.success) return json(c, 400, { error: 'badRequest', message: 'Expected {baseRevision, envelope}.' });
    const checked = checkEnvelope(body.data.envelope);
    if (!checked.ok) return json(c, 422, { error: 'invalid', errors: checked.errors });
    const outcome = await savePlan(c.var.ctx.deps.db, c.var.user.id, checked.document, body.data.baseRevision);
    if (!outcome.ok) return json(c, 409, { error: 'conflict', serverRevision: outcome.serverRevision });
    return json(c, 200, {
      revision: outcome.revision,
      updatedAt: outcome.updatedAt,
      ...(checked.repairs.length ? { repairs: checked.repairs, document: checked.document } : {}),
    });
  });

  return routes;
}

export function accountRoutes() {
  const routes = new Hono<Env>();
  routes.use('*', requireUser);
  routes.delete('/data', async c => {
    const { deps } = c.var.ctx;
    await deps.db.tx(q => deleteAccount(q, c.var.user.id));
    deps.previews.dropUser(c.var.user.id);
    clearSessionCookie(c);
    return c.body(null, 204);
  });
  return routes;
}
