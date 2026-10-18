/**
 * Plan persistence with optimistic concurrency. Every query is scoped by owner_id, which callers
 * take from the session — never from a request body or URL.
 */
import type { PlannerDocument } from '../../src/engine/planner-contracts';
import type { Queryable } from './db';
import { SCHEMA_VERSION, checkEnvelope } from './planDocument';

export interface StoredPlan { document: PlannerDocument; revision: number; updatedAt: string }
export type LoadedPlan = StoredPlan | { document: null; revision: number | null; updatedAt: string | null; unreadable?: true };

interface Row { document: unknown; schema_version: number; revision: number; updated_at: Date }

const iso = (value: Date | string): string => new Date(value).toISOString();

export async function loadPlan(db: Queryable, ownerId: string): Promise<LoadedPlan> {
  const { rows } = await db.query<Row>('SELECT document, schema_version, revision, updated_at FROM plans WHERE owner_id = $1', [ownerId]);
  const row = rows[0];
  if (!row) return { document: null, revision: null, updatedAt: null };
  const stored = typeof row.document === 'string' ? JSON.parse(row.document) : row.document;
  // Plans saved by an older schema are migrated on read; the migrated form is written on the next save.
  const checked = checkEnvelope({ app: 'debtnav', schemaVersion: row.schema_version, savedAt: iso(row.updated_at), document: stored });
  if (!checked.ok) return { document: null, revision: Number(row.revision), updatedAt: iso(row.updated_at), unreadable: true };
  return { document: checked.document, revision: Number(row.revision), updatedAt: iso(row.updated_at) };
}

export async function currentRevision(db: Queryable, ownerId: string): Promise<number | null> {
  const { rows } = await db.query<{ revision: number }>('SELECT revision FROM plans WHERE owner_id = $1', [ownerId]);
  return rows[0] ? Number(rows[0].revision) : null;
}

export type SaveOutcome =
  | { ok: true; revision: number; updatedAt: string }
  | { ok: false; conflict: true; serverRevision: number | null };

/**
 * Write a validated document if the stored revision still equals `baseRevision`
 * (null = "I have no plan yet", which only succeeds when none exists). Atomic: one statement.
 */
export async function savePlan(db: Queryable, ownerId: string, document: PlannerDocument, baseRevision: number | null): Promise<SaveOutcome> {
  const json = JSON.stringify(document);
  const { rows } = baseRevision === null
    ? await db.query<{ revision: number; updated_at: Date }>(
      `INSERT INTO plans (owner_id, schema_version, document, revision) VALUES ($1, $2, $3::jsonb, 1)
       ON CONFLICT (owner_id) DO NOTHING RETURNING revision, updated_at`, [ownerId, SCHEMA_VERSION, json])
    : await db.query<{ revision: number; updated_at: Date }>(
      `UPDATE plans SET document = $3::jsonb, schema_version = $2, revision = revision + 1, updated_at = now()
       WHERE owner_id = $1 AND revision = $4 RETURNING revision, updated_at`, [ownerId, SCHEMA_VERSION, json, baseRevision]);
  if (rows[0]) return { ok: true, revision: Number(rows[0].revision), updatedAt: iso(rows[0].updated_at) };
  return { ok: false, conflict: true, serverRevision: await currentRevision(db, ownerId) };
}

/** Removes the user and (by cascade) their plan and sessions. */
export async function deleteAccount(db: Queryable, userId: string): Promise<void> {
  await db.query('DELETE FROM plans WHERE owner_id = $1', [userId]);
  await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
}
