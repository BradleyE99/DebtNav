/**
 * Browser client for the DebtNav API (same origin, cookie session). Every non-GET request carries
 * the CSRF header. Functions never throw: failures come back as typed results so the stores can show
 * accurate offline/error/conflict states. Plan contents are sent only to this backend (NFR-5).
 */
import { SCHEMA_VERSION } from '../engine/planner-contracts';
import type { FieldError, PlannerDocument } from '../engine/planner-contracts';
import type { WorkbookApi, WorkbookCommitFailure, WorkbookPreview } from '../ui/sections/dataExchange';

export const CSRF_HEADERS = { 'X-Requested-With': 'debtnav' } as const;
/** Pins a request to the account it was made for; the server answers 409 accountChanged when the session user differs. */
export const ACCOUNT_HEADER = 'X-DebtNav-User';

export interface ApiUser { id: string; email: string | null }
export type ApiFailureKind = 'offline' | 'unauthorized' | 'invalid' | 'server' | 'notConfigured' | 'accountChanged';
export interface ApiFailure { ok: false; kind: ApiFailureKind; message: string; errors?: FieldError[] }

export type LoadPlanResult =
  | { ok: true; document: PlannerDocument | null; revision: number | null; updatedAt: string | null; unreadable?: boolean }
  | ApiFailure;

export type SavePlanResult =
  | { ok: true; revision: number; savedAt: string; document?: PlannerDocument; repairs?: string[] }
  | { ok: false; kind: 'conflict'; serverRevision: number | null; message: string }
  | ApiFailure;

export type MeResult = { ok: true; user: ApiUser | null } | ApiFailure;

export interface ApiClient extends WorkbookApi {
  authConfig(): Promise<{ ok: true; configured: boolean } | ApiFailure>;
  me(): Promise<MeResult>;
  /** URL that starts Google sign-in (full-page navigation). */
  loginUrl(returnTo?: string): string;
  logout(): Promise<{ ok: boolean }>;
  loadPlan(): Promise<LoadPlanResult>;
  savePlan(document: PlannerDocument, baseRevision: number | null, options?: { keepalive?: boolean }): Promise<SavePlanResult>;
  deleteAccountData(): Promise<{ ok: true } | ApiFailure>;
  /** Called after a successful Excel import commit (the server already saved `document` at `revision`). */
  onPlanReplaced(listener: (document: PlannerDocument, revision: number) => void): () => void;
  /**
   * A client whose every request names `userId` (X-DebtNav-User). If this browser's session now belongs
   * to someone else (signed out or switched account in another tab), the server refuses with
   * kind 'accountChanged' instead of reading or writing the other account's plan.
   */
  forUser(userId: string): ApiClient;
}

const OFFLINE: ApiFailure = { ok: false, kind: 'offline', message: 'You appear to be offline. DebtNav will keep trying to save.' };
const UNAUTHORIZED: ApiFailure = { ok: false, kind: 'unauthorized', message: 'Your sign-in has ended. Sign in again to keep saving.' };
const ACCOUNT_CHANGED: ApiFailure = { ok: false, kind: 'accountChanged', message: 'You signed out or switched accounts in another tab or window, so changes here are not being saved. Your edits are kept on this page.' };
const serverFailure = (status: number): ApiFailure => ({
  ok: false, kind: 'server',
  message: status === 429 ? 'Too many requests. DebtNav will try again shortly.' : status === 413 ? 'The plan is larger than the 5 MB limit.' : 'The server could not save right now. DebtNav will try again.',
});

async function body(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed = await response.json();
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export interface ApiClientOptions {
  fetch?: typeof fetch;
  base?: string;
  /** Account this client is pinned to (see ApiClient.forUser). */
  userId?: string;
  /** @internal shared Excel-import listeners between a client and its pinned copies. */
  listeners?: Set<(document: PlannerDocument, revision: number) => void>;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const base = options.base ?? '';
  const doFetch = (input: string, init?: RequestInit) => (options.fetch ?? globalThis.fetch)(input, { credentials: 'same-origin', ...init });
  const listeners = options.listeners ?? new Set<(document: PlannerDocument, revision: number) => void>();

  async function request(path: string, init?: RequestInit): Promise<Response | null> {
    try {
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = new Headers(init?.headers);
      if (method !== 'GET' && method !== 'HEAD') for (const [key, value] of Object.entries(CSRF_HEADERS)) headers.set(key, value);
      if (options.userId !== undefined) headers.set(ACCOUNT_HEADER, options.userId);
      return await doFetch(`${base}${path}`, { ...init, headers });
    } catch {
      return null;
    }
  }

  function failure(response: Response | null, data: Record<string, unknown> = {}): ApiFailure {
    if (!response) return OFFLINE;
    if (response.status === 401) return UNAUTHORIZED;
    if (response.status === 409 && data.error === 'accountChanged') return ACCOUNT_CHANGED;
    if (response.status === 422) return { ok: false, kind: 'invalid', message: 'The server rejected the plan as invalid.', errors: Array.isArray(data.errors) ? data.errors as FieldError[] : [] };
    if (response.status === 503 && data.error === 'notConfigured') return { ok: false, kind: 'notConfigured', message: String(data.message ?? 'Sign-in is not configured.') };
    return serverFailure(response.status);
  }

  const client: ApiClient = {
    async authConfig() {
      const response = await request('/api/auth/config');
      if (!response?.ok) return failure(response);
      return { ok: true, configured: (await body(response)).configured === true };
    },
    async me() {
      const response = await request('/api/me');
      if (response?.status === 401) return { ok: true, user: null };
      if (!response?.ok) return failure(response, response ? await body(response) : {});
      const user = (await body(response)).user as ApiUser | undefined;
      return { ok: true, user: user ? { id: String(user.id), email: user.email ?? null } : null };
    },
    loginUrl(returnTo = '/') {
      return `${base}/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
    },
    async logout() {
      const response = await request('/api/auth/logout', { method: 'POST' });
      return { ok: Boolean(response && (response.ok || response.status === 401)) };
    },
    async loadPlan() {
      const response = await request('/api/plan', { cache: 'no-store' });
      if (!response?.ok) return failure(response, response ? await body(response) : {});
      const data = await body(response);
      return {
        ok: true,
        document: (data.document ?? null) as PlannerDocument | null,
        revision: typeof data.revision === 'number' ? data.revision : null,
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
        ...(data.unreadable ? { unreadable: true } : {}),
      };
    },
    async savePlan(document, baseRevision, saveOptions = {}) {
      const envelope = { app: 'debtnav', schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), document };
      const text = JSON.stringify({ baseRevision, envelope });
      const response = await request('/api/plan', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text,
        // keepalive lets a save started while the page unloads finish (browsers cap it at 64 KB).
        keepalive: saveOptions.keepalive === true && text.length < 60_000,
      });
      const data = response ? await body(response) : {};
      if (response?.status === 409 && data.error !== 'accountChanged') {
        return { ok: false, kind: 'conflict', serverRevision: typeof data.serverRevision === 'number' ? data.serverRevision : null, message: 'This plan was changed on another device or tab.' };
      }
      if (!response?.ok) return failure(response, data);
      return {
        ok: true, revision: Number(data.revision), savedAt: String(data.updatedAt ?? new Date().toISOString()),
        ...(data.document ? { document: data.document as PlannerDocument, repairs: (data.repairs as string[]) ?? [] } : {}),
      };
    },
    async deleteAccountData() {
      const response = await request('/api/account/data', { method: 'DELETE' });
      if (response && (response.ok || response.status === 204)) return { ok: true };
      return failure(response, response ? await body(response) : {});
    },

    // ---- Excel (WorkbookApi, consumed by the Your data dashboard)
    templateUrl(years, loans) {
      return `${base}/api/workbook/template?years=${encodeURIComponent(String(years))}&loans=${encodeURIComponent(String(loans))}`;
    },
    exportUrl() {
      return `${base}/api/workbook/export`;
    },
    async importPreview(file) {
      const form = new FormData();
      form.append('file', file, file.name);
      const response = await request('/api/workbook/import/preview', { method: 'POST', body: form });
      if (!response?.ok) {
        if (response?.status === 413) return { ok: false, message: 'The file is larger than the 5 MB import limit.' };
        return { ok: false, message: failure(response, response ? await body(response) : {}).message };
      }
      const data = await body(response);
      const preview: WorkbookPreview = {
        previewId: String(data.previewId ?? ''),
        counts: (data.counts ?? {}) as Record<string, number>,
        errors: Array.isArray(data.errors) ? data.errors as WorkbookPreview['errors'] : [],
      };
      return { ok: true, preview };
    },
    async importCommit(previewId, baseRevision) {
      const response = await request('/api/workbook/import/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ previewId, baseRevision }),
      });
      const data = response ? await body(response) : {};
      const fail = (kind: WorkbookCommitFailure['kind'], message: string): WorkbookCommitFailure => ({ ok: false, kind, message });
      if (!response) return fail('offline', OFFLINE.message.replace(' DebtNav will keep trying to save.', ' Nothing was imported.'));
      if (response.status === 409 && data.error === 'accountChanged') return fail('server', 'You signed out or switched accounts in another tab or window. Nothing was imported.');
      if (response.status === 409) return fail('conflict', 'Your plan changed (on another device, tab or by a recent edit) since this preview. Nothing was imported; wait for "Saved" and import again.');
      if (response.status === 410) return fail('expired', 'This preview has expired. Upload the workbook again.');
      if (response.status === 422 || response.status === 400) return fail('invalid', 'The workbook could not be imported. Nothing was changed.');
      if (!response.ok) return fail('server', response.status === 401 ? UNAUTHORIZED.message : 'The server could not import the workbook. Nothing was changed.');
      const document = data.document as PlannerDocument;
      const revision = Number(data.revision);
      for (const listener of listeners) listener(document, revision);
      return { ok: true, document, revision };
    },
    onPlanReplaced(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    forUser(userId) {
      return createApiClient({ ...options, userId, listeners });
    },
  };
  return client;
}

/** The app's shared client. */
export const api = createApiClient();
