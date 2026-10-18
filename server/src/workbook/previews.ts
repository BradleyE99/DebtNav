/**
 * Parsed Excel imports waiting for the user's confirmation. Held in memory for 15 minutes and bound
 * to the uploading user; a preview can be committed once (removed on success), only by its owner.
 */
import { randomUUID } from 'node:crypto';
import type { PlannerDocument } from '../../../src/engine/planner-contracts';

export const PREVIEW_TTL_MS = 15 * 60_000;
const MAX_PER_USER = 3;

interface Entry { id: string; userId: string; document: PlannerDocument; createdAt: number }

export interface PreviewStore {
  put(userId: string, document: PlannerDocument, now: number): string;
  /** The preview when it exists, is unexpired and belongs to `userId`; else null. */
  get(userId: string, previewId: string, now: number): PlannerDocument | null;
  remove(previewId: string): void;
  dropUser(userId: string): void;
}

export function createPreviewStore(): PreviewStore {
  const entries = new Map<string, Entry>();
  const sweep = (now: number) => { for (const [id, entry] of entries) if (now - entry.createdAt > PREVIEW_TTL_MS) entries.delete(id); };
  return {
    put(userId, document, now) {
      sweep(now);
      const mine = [...entries.values()].filter(entry => entry.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
      for (const old of mine.slice(0, Math.max(0, mine.length - MAX_PER_USER + 1))) entries.delete(old.id);
      const id = randomUUID();
      entries.set(id, { id, userId, document, createdAt: now });
      return id;
    },
    get(userId, previewId, now) {
      sweep(now);
      const entry = entries.get(previewId);
      return entry && entry.userId === userId ? entry.document : null;
    },
    remove(previewId) {
      entries.delete(previewId);
    },
    dropUser(userId) {
      for (const [id, entry] of entries) if (entry.userId === userId) entries.delete(id);
    },
  };
}
