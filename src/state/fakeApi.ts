/**
 * In-memory ApiClient for component and store tests (no network). Mirrors the server's revision
 * rules (baseRevision null = create; mismatch → conflict) and validates like the server. Test
 * controls: `offline`, `failWith`, `user`, `configured`, `external()` (a save from another device),
 * and `calls` (every request, in order). `api.forUser(id)` returns a client pinned to that account:
 * its requests answer kind 'accountChanged' when `server.user?.id !== id` (like the server's 409).
 */
import type { PlannerDocument } from '../engine/planner-contracts';
import { validateDocument } from '../data/validation';
import type { ApiClient, ApiFailure, ApiUser, SavePlanResult } from './api';

export interface FakeServer {
  document: PlannerDocument | null;
  revision: number | null;
  updatedAt: string | null;
  user: ApiUser | null;
  configured: boolean;
  offline: boolean;
  /** Next save fails with this kind (then resets), e.g. 'server' or 'unauthorized'. */
  failWith: ApiFailure['kind'] | null;
  /** When set, savePlan waits for this promise before answering (to observe 'saving'). */
  gate: Promise<void> | null;
  calls: string[];
  deleted: boolean;
  /** Simulate another device saving `document`. */
  external(document: PlannerDocument): void;
}

export function createFakeApi(initial: Partial<Pick<FakeServer, 'document' | 'user' | 'configured'>> = {}): { api: ApiClient; server: FakeServer } {
  const listeners = new Set<(document: PlannerDocument, revision: number) => void>();
  let clock = Date.parse('2026-10-16T12:00:00.000Z');
  const tick = () => new Date((clock += 1000)).toISOString();
  const server: FakeServer = {
    document: initial.document ?? null,
    revision: initial.document ? 1 : null,
    updatedAt: initial.document ? tick() : null,
    user: initial.user === undefined ? { id: 'user-1', email: 'alice@example.test' } : initial.user,
    configured: initial.configured ?? true,
    offline: false,
    failWith: null,
    gate: null,
    calls: [],
    deleted: false,
    external(document) {
      server.document = document;
      server.revision = (server.revision ?? 0) + 1;
      server.updatedAt = tick();
    },
  };
  const offline: ApiFailure = { ok: false, kind: 'offline', message: 'You appear to be offline. DebtNav will keep trying to save.' };
  const takeFailure = (): ApiFailure | null => {
    if (server.offline) return offline;
    if (!server.failWith) return null;
    const kind = server.failWith;
    server.failWith = null;
    return { ok: false, kind, message: kind === 'unauthorized' ? 'Your sign-in has ended.' : 'The server could not save right now.' };
  };

  const accountChanged: ApiFailure = { ok: false, kind: 'accountChanged', message: 'You signed out or switched accounts in another tab or window.' };
  const build = (pinned: string | null): ApiClient => {
  const mismatch = (): ApiFailure | null => (pinned !== null && server.user?.id !== pinned ? accountChanged : null);
  const api: ApiClient = {
    async authConfig() { server.calls.push('authConfig'); return server.offline ? offline : { ok: true, configured: server.configured }; },
    async me() { server.calls.push('me'); return server.offline ? offline : mismatch() ?? { ok: true, user: server.user }; },
    loginUrl: (returnTo = '/') => `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
    async logout() { server.calls.push('logout'); server.user = null; return { ok: true }; },
    async loadPlan() {
      server.calls.push('loadPlan');
      const failure = takeFailure() ?? mismatch();
      if (failure) return failure;
      return { ok: true, document: server.document && structuredClone(server.document), revision: server.revision, updatedAt: server.updatedAt };
    },
    async savePlan(document, baseRevision): Promise<SavePlanResult> {
      server.calls.push(`savePlan:${baseRevision}`);
      if (server.gate) await server.gate;
      const failure = takeFailure() ?? mismatch();
      if (failure) return failure;
      const checked = validateDocument(structuredClone(document));
      if (!checked.ok) return { ok: false, kind: 'invalid', message: 'invalid', errors: checked.errors };
      if (baseRevision !== server.revision) return { ok: false, kind: 'conflict', serverRevision: server.revision, message: 'conflict' };
      server.document = checked.value;
      server.revision = (server.revision ?? 0) + 1;
      server.updatedAt = tick();
      return { ok: true, revision: server.revision, savedAt: server.updatedAt };
    },
    async deleteAccountData() {
      server.calls.push('deleteAccountData');
      const failure = takeFailure() ?? mismatch();
      if (failure) return failure;
      server.document = null;
      server.revision = null;
      server.user = null;
      server.deleted = true;
      return { ok: true };
    },
    templateUrl: (years, loans) => `/api/workbook/template?years=${years}&loans=${loans}`,
    exportUrl: () => '/api/workbook/export',
    async importPreview() { return { ok: true, preview: { previewId: 'preview-1', counts: {}, errors: [] } }; },
    async importCommit(_previewId, baseRevision) {
      server.calls.push(`importCommit:${baseRevision}`);
      if (mismatch()) return { ok: false, kind: 'server', message: 'You signed out or switched accounts in another tab or window. Nothing was imported.' };
      if (baseRevision !== server.revision) return { ok: false, kind: 'conflict', message: 'conflict' };
      const document = structuredClone(server.document!);
      server.revision = (server.revision ?? 0) + 1;
      for (const listener of listeners) listener(document, server.revision);
      return { ok: true, document, revision: server.revision };
    },
    onPlanReplaced(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    forUser: userId => build(userId),
  };
  return api;
  };
  return { api: build(null), server };
}
