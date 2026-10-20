/**
 * Interfaces between the Your Data dashboard (ui) and the account services wired in by App.tsx
 * (backend: src/state/api.ts implements WorkbookApi). PlannerApp works without them (component
 * tests, guest mode): the Excel controls then explain that Excel files need a signed-in account.
 */
import type { ReactNode } from 'react';
import type { PlannerDocument } from '../../engine/planner-contracts';

/** A workbook problem. sheet '' and row/column null when the problem is about the whole file. */
export interface WorkbookIssue { sheet: string; row: number | null; column: string | null; message: string }

/**
 * Parsed (not yet applied) workbook. errors.length > 0 means nothing can be imported.
 * Count keys: schoolYears, costs, resources, loans, lifeEvents, scenarios, scenarioOverrides, customOrder.
 */
export interface WorkbookPreview { previewId: string; counts: Record<string, number>; errors: WorkbookIssue[] }

export type WorkbookCommitFailure = { ok: false; kind: 'conflict' | 'invalid' | 'expired' | 'offline' | 'server'; message: string };

export interface WorkbookApi {
  /** GET /api/workbook/template?years=&loans= */
  templateUrl(years: number, loans: number): string;
  /** GET /api/workbook/export */
  exportUrl(): string;
  /** `{ok:false}` only for transport problems (offline, unauthorized, server). */
  importPreview(file: File): Promise<{ ok: true; preview: WorkbookPreview } | { ok: false; message: string }>;
  /** Atomic server-side replace. On success the caller passes `document` to store.replaceDocument. */
  importCommit(previewId: string, baseRevision: number | null): Promise<{ ok: true; document: PlannerDocument; revision: number } | WorkbookCommitFailure>;
}

/** Signed-in account shown in the planner header. */
export interface AccountInfo { email: string | null; onSignOut(): void | Promise<void> }

/**
 * Guest mode (no sign-in): the plan is saved in this browser only. `onSignIn` starts Google sign-in
 * ("Sign in with Google to save across devices"); when `signInAvailable` is false the sign-in actions
 * are disabled and `signInUnavailableText` explains why. `notice` renders at the top of the main area.
 */
export interface GuestInfo {
  signInAvailable: boolean;
  onSignIn(): void;
  notice?: ReactNode;
  /** True while the browser is leaving for Google sign-in. */
  signInBusy?: boolean;
  /** Why sign-in can't be used right now (shown when signInAvailable is false). */
  signInUnavailableText?: string;
}
