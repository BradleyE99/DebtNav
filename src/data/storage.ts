/**
 * Device persistence (US-1001/1002/1003). All functions are total: they report failures through
 * results/notices and never throw, so the app keeps working when storage is unavailable.
 */
import { SCHEMA_VERSION } from '../engine/planner-contracts';
import type { LoadResult, PlannerDocument, Result, SavedEnvelope, SaveResult, StorageLike } from '../engine/planner-contracts';
import { pruneDanglingReferences } from '../engine/paths';
import type { PlannerPlan } from '../engine/planner-contracts';
import { applyScenario, assignLegacyAcademicYears } from '../engine/planner';
import { isDisbursementError, isPlainObject, repaymentStartDate, validateDocument } from './validation';

export const STORAGE_KEY = 'debtnav.plan';
/** Keys used by earlier builds. Read for migration, removed on delete, never written. */
export const LEGACY_STORAGE_KEYS = ['debtnav.plan.v2'] as const;
/** Written and removed immediately by probeStorage to detect storage that reads but cannot write. */
export const PROBE_STORAGE_KEY = 'debtnav.probe';
/** Every key DebtNav may have written on this device; deleteDocument removes exactly these. */
export const ALL_STORAGE_KEYS = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS, PROBE_STORAGE_KEY] as const;
/** 5 MB limit on stored and imported JSON text. */
export const MAX_JSON_LENGTH = 5_000_000;

export const UNAVAILABLE_NOTICE = 'Browser storage is unavailable (for example in private browsing). DebtNav still works, but your changes will not be saved on this device. Export a backup to keep them.';

type ImportFailure = { ok: false; errors: [{ path: 'import'; code: 'OUT_OF_RANGE'; message: string }] };
const importError = (message: string): ImportFailure => ({ ok: false, errors: [{ path: 'import', code: 'OUT_OF_RANGE', message }] });

function browserStorage(): StorageLike {
  if (typeof window === 'undefined' || !window.localStorage) throw new Error('Browser storage unavailable');
  return window.localStorage;
}

/** Resolve storage lazily; accessing window.localStorage itself can throw a SecurityError. */
function resolveStorage(storage?: StorageLike): StorageLike | null {
  try {
    return storage ?? browserStorage();
  } catch {
    return null;
  }
}

/**
 * Schema history (what could exist in a user's browser):
 * - No committed build before schema 3 wrote browser storage (HEAD's M1 preview kept state in memory).
 * - Schema 2 was written by pre-release development builds under 'debtnav.plan.v2' or 'debtnav.plan';
 *   it also persisted unfinished field drafts and allowed the 'input-order' strategy and scenario
 *   overrides that pointed at removed records.
 * - Schema 1 / unversioned data never existed in storage; it is reported as an unsupported format.
 *
 * v2 document → v3 document shape (before validation): drops drafts, maps the retired
 * 'input-order' strategy to 'avalanche', fills defaults for fields added since v2, and removes
 * references to records that no longer exist (v2 ignored them; v3 rejects them).
 */
function migrateV2Document(document: unknown): unknown {
  if (!isPlainObject(document) || !isPlainObject(document.plan)) return document;
  const plan = document.plan;
  const repayment = isPlainObject(plan.repayment) ? plan.repayment : {};
  const migratedRepayment = {
    customOrder: [],
    mode: 'standard',
    federalPlan: 'rap',
    familySize: 1,
    annualAGI: '0.00',
    ...repayment,
    strategyId: repayment.strategyId === 'input-order' || repayment.strategyId === undefined ? 'avalanche' : repayment.strategyId,
  };
  const migratedPlan = {
    lifeEvents: [],
    scenarios: [],
    postGradIncome: { annualSalary: '0.00', monthlyDebtBudget: '0.00', raiseAllocationPercent: '0' },
    borrower: { dependency: 'dependent', level: 'undergraduate', priorFederalDebt: '0.00' },
    ...plan,
    repayment: migratedRepayment,
  };
  let prunedPlan: unknown = migratedPlan;
  try {
    prunedPlan = pruneDanglingReferences(migratedPlan as unknown as PlannerPlan);
  } catch {
    // Malformed v2 data: leave it for validation to report.
  }
  return {
    plan: prunedPlan,
    disclaimerDismissed: typeof document.disclaimerDismissed === 'boolean' ? document.disclaimerDismissed : false,
  };
}

/**
 * Earlier development builds accepted loans disbursed after repayment starts, which the engine
 * cannot project. Move each such base loan's disbursement to the repayment start date, and in
 * scenarios drop the override that causes it (the loan's own date override if there is one,
 * otherwise the grace override, then the graduation override). Returns a description per change.
 * Only called when every validation error is of this kind; never throws.
 */
function repairDisbursements(document: unknown): { document: unknown; repairs: string[] } | null {
  try {
    if (!isPlainObject(document) || !isPlainObject(document.plan)) return null;
    const plan = structuredClone(document.plan) as unknown as PlannerPlan;
    const repairs: string[] = [];
    const start = repaymentStartDate(plan.settings);
    for (const loan of plan.loans) {
      if (loan.disbursementDate > start) {
        repairs.push(`Loan "${loan.name}" disbursement moved from ${loan.disbursementDate} to ${start} so it can be projected.`);
        loan.disbursementDate = start;
      }
    }
    for (const scenario of plan.scenarios) {
      for (let guard = 0; guard < plan.loans.length + 2; guard++) {
        const effective = applyScenario({ ...plan, scenarios: [] }, scenario);
        const effectiveStart = repaymentStartDate(effective.settings);
        const late = effective.loans.find(loan => loan.disbursementDate > effectiveStart);
        if (!late) break;
        const own = `loans.${late.id}.disbursementDate`;
        const key = [own, 'settings.graceMonths', 'settings.graduationDate'].find(candidate => Object.hasOwn(scenario.overrides, candidate));
        if (!key) return null;
        const { [key]: removed, ...rest } = scenario.overrides;
        scenario.overrides = rest;
        repairs.push(`Scenario "${scenario.name}": removed the change to ${key === own ? `loan "${late.name}" disbursement date` : key === 'settings.graceMonths' ? 'the grace period' : 'the graduation date'} (${String(removed)}) so loan "${late.name}" can be projected.`);
      }
    }
    return repairs.length ? { document: { ...document, plan }, repairs } : null;
  } catch {
    return null;
  }
}

/** Validate, repairing only the disbursement-after-repayment-start rule (see repairDisbursements). */
function validateWithRepairs(document: unknown): { result: Result<PlannerDocument>; repairs: string[] } {
  const first = validateDocument(document);
  let result = first;
  let current = document;
  const repairs: string[] = [];
  // Base errors hide scenario checks, so a repaired base can reveal scenario problems: retry a few times.
  for (let round = 0; round < 3 && !result.ok && result.errors.every(isDisbursementError); round++) {
    const repaired = repairDisbursements(current);
    if (!repaired) break;
    current = repaired.document;
    repairs.push(...repaired.repairs);
    result = validateDocument(current);
  }
  return result.ok ? { result, repairs } : { result: first, repairs: [] };
}

export interface DetailedImport { result: Result<PlannerDocument>; /** Changes made so an older plan can be projected; empty when none. */ repairs: string[] }

/** Parse exported or stored JSON text into a validated v3 document, migrating v2. */
export function importDocument(text: string): Result<PlannerDocument> {
  return importDocumentDetailed(text).result;
}

/** importDocument plus the list of automatic repairs (shown to the user as a notice). */
export function importDocumentDetailed(text: string): DetailedImport {
  const detailed = parseImport(text);
  return 'result' in detailed ? detailed : { result: detailed, repairs: [] };
}

function parseImport(text: string): Result<PlannerDocument> | DetailedImport {
  try {
    if (typeof text !== 'string') return importError('The file could not be read.');
    if (text.length > MAX_JSON_LENGTH) return importError('The file is larger than the 5 MB import limit.');
    let envelope: unknown;
    try {
      envelope = JSON.parse(text);
    } catch {
      return importError('This file is not valid JSON. Choose a DebtNav export file.');
    }
    if (!isPlainObject(envelope)) return importError('This file is not a DebtNav plan export.');
    if (envelope.app !== undefined && envelope.app !== 'debtnav') return importError('This file was not created by DebtNav.');
    const version = envelope.schemaVersion;
    if (typeof version !== 'number' || !Number.isInteger(version)) return importError('This file is not a DebtNav plan export (no schema version).');
    if (version > SCHEMA_VERSION) return importError(`This file was saved by a newer version of DebtNav (schema ${version}). Update DebtNav to open it.`);
    if (version < 2) return importError(`This file uses an old format (schema ${version}) that cannot be imported.`);
    if (version === SCHEMA_VERSION && envelope.app !== 'debtnav') return importError('This file was not created by DebtNav.');
    if (!('document' in envelope)) return importError('The file does not contain a plan.');

    const document = version === 2 ? migrateV2Document(envelope.document) : envelope.document;
    const { result, repairs } = validateWithRepairs(document);
    if (!result.ok) {
      const first = result.errors[0];
      return importError(`The plan in this file is not valid (${first.path}: ${first.message}) Your current plan was not changed.`);
    }
    // Loans saved before academic years existed keep the school year they already counted toward.
    const plan = assignLegacyAcademicYears(result.value.plan);
    return { result: plan === result.value.plan ? result : { ok: true, value: { ...result.value, plan } }, repairs };
  } catch {
    return importError('The file could not be read. Your current plan was not changed.');
  }
}

/** Pretty, versioned JSON for export and storage. Fails (without throwing) for invalid documents. */
export function serializeDocument(document: PlannerDocument): Result<string> {
  const checked = validateDocument(document);
  if (!checked.ok) return checked;
  try {
    const envelope: SavedEnvelope = { app: 'debtnav', schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), document: checked.value };
    return { ok: true, value: JSON.stringify(envelope, null, 2) };
  } catch {
    return importError('The plan could not be converted to a file.');
  }
}

/** Contract signature. Throws only for a document that fails validation (a programming error). */
export function exportDocument(document: PlannerDocument): string {
  const result = serializeDocument(document);
  if (!result.ok) throw new Error(`Cannot export an invalid plan: ${result.errors[0].message}`);
  return result.value;
}

/** LoadResult plus automatic repairs. When repairs is non-empty, `notice` describes them (storage is fine). */
export interface DetailedLoadResult extends LoadResult { repairs: string[] }

export const repairNotice = (repairs: readonly string[], saved: 'next-edit' | 'now'): string =>
  `${repairs.join(' ')} ${saved === 'next-edit' ? 'Your saved data is unchanged until you edit the plan.' : 'The updated plan has been saved.'}`;

export function loadDocument(storage?: StorageLike): DetailedLoadResult {
  const target = resolveStorage(storage);
  if (!target) return { document: null, notice: UNAVAILABLE_NOTICE, preservedUnreadable: false, repairs: [] };
  try {
    let raw = target.getItem(STORAGE_KEY);
    for (const key of LEGACY_STORAGE_KEYS) {
      if (raw !== null) break;
      raw = target.getItem(key);
    }
    if (raw === null) return { document: null, notice: null, preservedUnreadable: false, repairs: [] };
    const { result, repairs } = importDocumentDetailed(raw);
    if (result.ok) {
      return { document: result.value, notice: repairs.length ? repairNotice(repairs, 'next-edit') : null, preservedUnreadable: false, repairs };
    }
    return {
      document: null,
      notice: `Your saved plan could not be read: ${result.errors[0].message} It has been preserved and automatic saving is paused, so changes you make now will not be saved. Import a plan file to replace it, or delete your data to start over.`,
      preservedUnreadable: true,
      repairs: [],
    };
  } catch {
    return { document: null, notice: UNAVAILABLE_NOTICE, preservedUnreadable: false, repairs: [] };
  }
}

/** Why a save failed: 'storage' = browser storage unavailable/full; 'invalid' = plan rejected; 'size' = over 5 MB. */
export type DetailedSaveResult = { ok: true; notice: null } | { ok: false; notice: string; reason: 'storage' | 'invalid' | 'size' };

export function saveDocumentDetailed(document: PlannerDocument, storage?: StorageLike): DetailedSaveResult {
  const exported = serializeDocument(document);
  if (!exported.ok) return { ok: false, reason: 'invalid', notice: `The plan was not saved: ${exported.errors[0].message}` };
  if (exported.value.length > MAX_JSON_LENGTH) {
    return { ok: false, reason: 'size', notice: 'The plan is larger than the 5 MB storage limit and was not saved. Export it as a file instead.' };
  }
  const target = resolveStorage(storage);
  if (!target) return { ok: false, reason: 'storage', notice: UNAVAILABLE_NOTICE };
  try {
    target.setItem(STORAGE_KEY, exported.value);
  } catch {
    return { ok: false, reason: 'storage', notice: 'Your changes could not be saved on this device. Storage may be unavailable or full; export a backup to keep them.' };
  }
  // The plan now lives under the current key; older copies are superseded.
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      target.removeItem(key);
    } catch {
      // A leftover legacy copy is harmless: the current key is read first.
    }
  }
  return { ok: true, notice: null };
}

export function saveDocument(document: PlannerDocument, storage?: StorageLike): SaveResult {
  const result = saveDocumentDetailed(document, storage);
  return { ok: result.ok, notice: result.notice };
}

/**
 * True when storage accepts writes. Some browsers (private modes, disabled storage, full quota)
 * allow reads but throw on write; probing at startup lets the app say up front that changes will
 * not be saved instead of discovering it at the first edit. Never touches the plan key.
 */
export function probeStorage(storage?: StorageLike): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(PROBE_STORAGE_KEY, '1');
    target.removeItem(PROBE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Caller must obtain user confirmation first. Removes only DebtNav's keys (ALL_STORAGE_KEYS). */
export function deleteDocument(storage?: StorageLike): SaveResult {
  const target = resolveStorage(storage);
  if (!target) return { ok: false, notice: 'Your saved plan could not be deleted because browser storage is unavailable.' };
  let failed = false;
  for (const key of ALL_STORAGE_KEYS) {
    try {
      target.removeItem(key);
    } catch {
      failed = true;
    }
  }
  try {
    if (!failed && ALL_STORAGE_KEYS.every(key => target.getItem(key) === null)) return { ok: true, notice: null };
  } catch {
    // Fall through: deletion could not be confirmed.
  }
  return { ok: false, notice: 'Your saved plan could not be deleted because browser storage is unavailable.' };
}
