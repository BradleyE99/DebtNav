import { describe, expect, it } from 'vitest';
import { createDefaultPlan } from '../engine/planner';
import type { PlannerDocument, StorageLike } from '../engine/planner-contracts';
import {
  LEGACY_STORAGE_KEYS,
  MAX_JSON_LENGTH,
  STORAGE_KEY,
  deleteDocument,
  exportDocument,
  importDocument,
  loadDocument,
  saveDocument,
  serializeDocument,
} from './storage';

const doc = (): PlannerDocument => ({ plan: createDefaultPlan(), disclaimerDismissed: false });

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
  };
}

const throwing: StorageLike = {
  getItem: () => { throw new DOMException('denied', 'SecurityError'); },
  setItem: () => { throw new DOMException('full', 'QuotaExceededError'); },
  removeItem: () => { throw new DOMException('denied', 'SecurityError'); },
};

function v2Envelope(document: PlannerDocument, extra: Record<string, unknown> = {}): string {
  const plan = { ...structuredClone(document.plan), repayment: { ...document.plan.repayment, strategyId: 'input-order' }, ...extra };
  return JSON.stringify({ schemaVersion: 2, savedAt: '2026-01-01T00:00:00.000Z', document: { plan, drafts: { 'loans.x.principal': '12' }, disclaimerDismissed: true } });
}

describe('saving and loading', () => {
  it('saves a v3 envelope and reloads the same document', () => {
    const storage = memory();
    const document = doc();
    expect(saveDocument(document, storage)).toEqual({ ok: true, notice: null });
    const envelope = JSON.parse(storage.data.get(STORAGE_KEY)!);
    expect(envelope).toMatchObject({ app: 'debtnav', schemaVersion: 3 });
    expect(Number.isFinite(Date.parse(envelope.savedAt))).toBe(true);
    expect(loadDocument(storage)).toEqual({ document, notice: null, preservedUnreadable: false, repairs: [] });
  });

  it('returns no document and no notice when nothing is stored', () => {
    expect(loadDocument(memory())).toEqual({ document: null, notice: null, preservedUnreadable: false, repairs: [] });
  });

  it('preserves unreadable stored data and flags it', () => {
    const storage = memory();
    storage.setItem(STORAGE_KEY, '{"schemaVersion":1}');
    const result = loadDocument(storage);
    expect(result.preservedUnreadable).toBe(true);
    expect(result.document).toBeNull();
    expect(result.notice).toMatch(/preserved/);
    expect(storage.getItem(STORAGE_KEY)).toBe('{"schemaVersion":1}');
  });

  it('never overwrites saved data with an invalid plan', () => {
    const storage = memory();
    const document = doc();
    saveDocument(document, storage);
    const before = storage.getItem(STORAGE_KEY);
    document.plan.postGradIncome.monthlyDebtBudget = '';
    expect(saveDocument(document, storage).ok).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });

  it('keeps working without throwing when storage is unavailable', () => {
    expect(loadDocument(throwing)).toMatchObject({ document: null, preservedUnreadable: false });
    expect(loadDocument(throwing).notice).toMatch(/unavailable/);
    const save = saveDocument(doc(), throwing);
    expect(save.ok).toBe(false);
    expect(save.notice).toMatch(/could not be saved/);
    expect(deleteDocument(throwing).ok).toBe(false);
  });

  it('migrates a legacy-key v2 save, then moves it to the current key on save', () => {
    const storage = memory();
    storage.setItem(LEGACY_STORAGE_KEYS[0], v2Envelope(doc()));
    const loaded = loadDocument(storage);
    expect(loaded.preservedUnreadable).toBe(false);
    expect(loaded.document!.plan.repayment.strategyId).toBe('avalanche');
    expect(saveDocument(loaded.document!, storage).ok).toBe(true);
    expect(storage.getItem(LEGACY_STORAGE_KEYS[0])).toBeNull();
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
  });
});

describe('deleting', () => {
  it('removes only DebtNav keys, including legacy ones', () => {
    const storage = memory();
    saveDocument(doc(), storage);
    storage.setItem(LEGACY_STORAGE_KEYS[0], 'old');
    storage.setItem('unrelated', 'keep');
    expect(deleteDocument(storage)).toEqual({ ok: true, notice: null });
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(storage.getItem(LEGACY_STORAGE_KEYS[0])).toBeNull();
    expect(storage.getItem('unrelated')).toBe('keep');
  });
});

describe('export and import', () => {
  it('round-trips pretty versioned JSON', () => {
    const document = doc();
    const text = exportDocument(document);
    expect(text).toContain('\n  "app": "debtnav"');
    expect(importDocument(text)).toEqual({ ok: true, value: document });
  });

  it('serializeDocument reports invalid plans instead of throwing', () => {
    const document = doc();
    document.plan.settings.graceMonths = 99;
    const result = serializeDocument(document);
    expect(result.ok).toBe(false);
    expect(() => exportDocument(document)).toThrow(/invalid/);
  });

  it.each([
    ['invalid JSON', '{', /not valid JSON/],
    ['an empty object', '{}', /schema version/],
    ['schema 1', '{"schemaVersion":1}', /old format/],
    ['a future version', '{"app":"debtnav","schemaVersion":4,"savedAt":"x","document":{}}', /newer version/],
    ['another app', '{"app":"other","schemaVersion":3,"document":{}}', /not created by DebtNav/],
    ['v3 without app', '{"schemaVersion":3,"document":{}}', /not created by DebtNav/],
    ['an oversized file', ' '.repeat(MAX_JSON_LENGTH + 1), /5 MB/],
    ['no document', '{"app":"debtnav","schemaVersion":3}', /does not contain/],
  ])('rejects %s with a clear message', (_name, text, message) => {
    const result = importDocument(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].message).toMatch(message);
  });

  it('migrates v2 envelopes: drops drafts, maps input-order, keeps data', () => {
    const original = doc();
    original.plan.postGradIncome.annualSalary = '61000.00';
    const result = importDocument(v2Envelope(original));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toHaveProperty('drafts');
    expect(result.value.disclaimerDismissed).toBe(true);
    expect(result.value.plan.repayment.strategyId).toBe('avalanche');
    expect(result.value.plan.postGradIncome.annualSalary).toBe('61000.00');
  });

  it('migrates v2 plans missing newer fields by adding defaults', () => {
    const original = doc();
    const plan = structuredClone(original.plan) as unknown as Record<string, unknown>;
    delete plan.lifeEvents;
    delete plan.scenarios;
    delete plan.borrower;
    const repayment = plan.repayment as Record<string, unknown>;
    for (const key of ['customOrder', 'mode', 'federalPlan', 'familySize', 'annualAGI']) delete repayment[key];
    const text = JSON.stringify({ schemaVersion: 2, savedAt: '2026-01-01T00:00:00.000Z', document: { plan, drafts: {}, disclaimerDismissed: false } });
    const result = importDocument(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.plan.lifeEvents).toEqual([]);
      expect(result.value.plan.repayment.mode).toBe('standard');
    }
  });

  it('keeps date-shaped school-year IDs from older saves valid', () => {
    const document = doc();
    expect(document.plan.schoolYears.length).toBeGreaterThan(0);
    const dated = structuredClone(document);
    dated.plan.schoolYears = dated.plan.schoolYears.map(year => ({ ...year, id: year.startDate }));
    expect(importDocument(exportDocument(dated)).ok).toBe(true);
  });

  it('rejects an invalid migrated plan without throwing', () => {
    const result = importDocument(v2Envelope(doc(), { loans: 'nope' }));
    expect(result.ok).toBe(false);
  });
});
