/**
 * Cookie sessions. The browser holds a random 256-bit token in an httpOnly cookie; the database
 * stores only its SHA-256 hash, so a database leak does not reveal usable session tokens.
 * Sessions slide: each use more than an hour after the last one extends expiry by the TTL.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Queryable } from '../db';

export interface SessionUser { id: string; email: string | null }

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
export const newToken = (): string => randomBytes(32).toString('base64url');

const DAY_MS = 86_400_000;
const SLIDE_AFTER_MS = 3_600_000;

export async function upsertUser(db: Queryable, identity: { issuer: string; subject: string; email: string | null }): Promise<SessionUser> {
  const { rows } = await db.query<{ id: string; email: string | null }>(
    `INSERT INTO users (issuer, subject, email) VALUES ($1, $2, $3)
     ON CONFLICT (issuer, subject) DO UPDATE SET email = EXCLUDED.email, last_login_at = now()
     RETURNING id, email`,
    [identity.issuer, identity.subject, identity.email],
  );
  return rows[0];
}

export async function createSession(db: Queryable, userId: string, ttlDays: number, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + ttlDays * DAY_MS);
  await db.query('INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at) VALUES ($1, $2, $3, $4, $3)',
    [hashToken(token), userId, now, expiresAt]);
  return { token, expiresAt };
}

/** The signed-in user for a token, or null when unknown/expired (expired rows are removed). */
export async function resolveSession(db: Queryable, token: string | undefined, ttlDays: number, now = new Date()): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const idHash = hashToken(token);
  const { rows } = await db.query<{ user_id: string; email: string | null; expires_at: Date; last_seen_at: Date }>(
    `SELECT s.user_id, u.email, s.expires_at, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = $1`,
    [idHash],
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    await db.query('DELETE FROM sessions WHERE id_hash = $1', [idHash]);
    return null;
  }
  if (now.getTime() - new Date(row.last_seen_at).getTime() > SLIDE_AFTER_MS) {
    await db.query('UPDATE sessions SET last_seen_at = $2, expires_at = $3 WHERE id_hash = $1',
      [idHash, now, new Date(now.getTime() + ttlDays * DAY_MS)]);
  }
  return { id: row.user_id, email: row.email };
}

export async function deleteSession(db: Queryable, token: string | undefined): Promise<void> {
  if (token) await db.query('DELETE FROM sessions WHERE id_hash = $1', [hashToken(token)]);
}

/** Housekeeping: drop expired sessions and stale login flows. */
export async function purgeExpired(db: Queryable, now = new Date()): Promise<void> {
  await db.query('DELETE FROM sessions WHERE expires_at <= $1', [now]);
  await db.query('DELETE FROM oidc_flows WHERE created_at <= $1', [new Date(now.getTime() - 10 * 60_000)]);
}
