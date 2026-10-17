/**
 * Excel template/export/import. Import is two-step: preview parses and validates the upload
 * (nothing is saved), commit atomically replaces the owner's plan after explicit confirmation.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { type Env, json, requireUser } from '../http';
import { loadPlan, savePlan } from '../plans';
import { readWorkbook, writeTemplate, writeWorkbook, TEMPLATE_LIMITS } from '../workbook';
import { readJson, revisionSchema } from './plan';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const commitSchema = z.object({ previewId: z.string().min(1).max(100), baseRevision: revisionSchema });

const attachment = (body: Uint8Array, filename: string) => new Response(body as BodyInit, {
  status: 200,
  headers: {
    'Content-Type': XLSX_TYPE,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
});

const clampInt = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export function workbookRoutes() {
  const routes = new Hono<Env>();
  routes.use('*', requireUser);

  routes.get('/template', async c => {
    const years = clampInt(c.req.query('years'), 4, TEMPLATE_LIMITS.years.min, TEMPLATE_LIMITS.years.max);
    const loans = clampInt(c.req.query('loans'), 4, TEMPLATE_LIMITS.loans.min, TEMPLATE_LIMITS.loans.max);
    return attachment(await writeTemplate({ years, loans }), 'debtnav-template.xlsx');
  });

  routes.get('/export', async c => {
    const loaded = await loadPlan(c.var.ctx.deps.db, c.var.user.id);
    if (!loaded.document) return json(c, 404, { error: 'notFound', message: 'There is no saved plan to export yet.' });
    const date = c.var.ctx.deps.now().toISOString().slice(0, 10);
    return attachment(await writeWorkbook(loaded.document, { exportedAt: c.var.ctx.deps.now() }), `debtnav-plan-${date}.xlsx`);
  });

  routes.post('/import/preview', async c => {
    let file: unknown;
    try {
      file = (await c.req.parseBody())['file'];
    } catch {
      return json(c, 400, { error: 'badRequest', message: 'Upload the workbook as multipart form field "file".' });
    }
    if (!(file instanceof File)) return json(c, 400, { error: 'badRequest', message: 'Upload the workbook as multipart form field "file".' });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await readWorkbook(bytes, file.name);
    if (!result.ok) return json(c, 200, { previewId: '', counts: result.counts, errors: result.errors });
    const previewId = c.var.ctx.deps.previews.put(c.var.user.id, result.document, c.var.ctx.deps.now().getTime());
    return json(c, 200, { previewId, counts: result.counts, errors: [] });
  });

  routes.post('/import/commit', async c => {
    const body = commitSchema.safeParse(await readJson(c));
    if (!body.success) return json(c, 400, { error: 'badRequest', message: 'Expected {previewId, baseRevision}.' });
    const { deps } = c.var.ctx;
    const document = deps.previews.get(c.var.user.id, body.data.previewId, deps.now().getTime());
    if (!document) return json(c, 410, { error: 'expired', message: 'This import preview has expired. Upload the workbook again.' });
    const outcome = await savePlan(deps.db, c.var.user.id, document, body.data.baseRevision);
    if (!outcome.ok) return json(c, 409, { error: 'conflict', serverRevision: outcome.serverRevision });
    deps.previews.remove(body.data.previewId);
    return json(c, 200, { revision: outcome.revision, updatedAt: outcome.updatedAt, document });
  });

  return routes;
}
