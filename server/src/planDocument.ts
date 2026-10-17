/**
 * Server-side plan validation and migration. Reuses the client's pure data layer (src/data), so the
 * server accepts exactly what a JSON import accepts: older schema versions are migrated, invalid
 * plans are rejected with field-path errors, and only persisted input fields are kept.
 */
import { SCHEMA_VERSION } from '../../src/engine/planner-contracts';
import type { FieldError, PlannerDocument, SavedEnvelope } from '../../src/engine/planner-contracts';
import { importDocumentDetailed, migrateToCurrent } from '../../src/data/storage';
import { isPlainObject, validateDocument } from '../../src/data/validation';

export type CheckedDocument =
  | { ok: true; document: PlannerDocument; repairs: string[] }
  | { ok: false; errors: FieldError[] };

/** Validate/migrate an envelope `{app, schemaVersion, document}` received from a client or the DB. */
export function checkEnvelope(envelope: unknown): CheckedDocument {
  let text: string;
  try {
    text = JSON.stringify(envelope);
  } catch {
    return { ok: false, errors: [{ path: 'envelope', code: 'REQUIRED', message: 'Expected a DebtNav plan envelope.' }] };
  }
  if (typeof text !== 'string') return { ok: false, errors: [{ path: 'envelope', code: 'REQUIRED', message: 'Expected a DebtNav plan envelope.' }] };
  const { result, repairs } = importDocumentDetailed(text);
  if (result.ok) return { ok: true, document: result.value, repairs };
  // importDocumentDetailed summarizes failures for people; API clients get every field-path error.
  if (isPlainObject(envelope) && typeof envelope.schemaVersion === 'number' && envelope.schemaVersion >= 2 && envelope.schemaVersion <= SCHEMA_VERSION) {
    const detailed = validateDocument(migrateToCurrent(envelope.document, envelope.schemaVersion));
    if (!detailed.ok) return { ok: false, errors: detailed.errors };
  }
  return { ok: false, errors: result.errors };
}

export const checkDocument = (document: unknown): CheckedDocument =>
  checkEnvelope({ app: 'debtnav', schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), document });

export const envelopeFor = (document: PlannerDocument): SavedEnvelope =>
  ({ app: 'debtnav', schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), document });

export { SCHEMA_VERSION };
