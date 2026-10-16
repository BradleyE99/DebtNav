import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDefaultPlan } from '../engine/planner';
import type { PlannerDocument, PlannerPlan, StorageLike } from '../engine/planner-contracts';
import {
  ALL_STORAGE_KEYS,
  LEGACY_STORAGE_KEYS,
  PROBE_STORAGE_KEY,
  STORAGE_KEY,
  deleteDocument,
  exportDocument,
  importDocument,
  importDocumentDetailed,
  loadDocument,
  probeStorage,
  saveDocument,
} from './storage';

function memory(seed: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
  };
}

function richPlan(): PlannerPlan {
  const plan = createDefaultPlan();
  const year = plan.schoolYears[0];
  year.bufferPercent = '5';
  year.costItems.push({ id: 'tuition', category: 'tuition', label: 'Tuition — "Fall" & Spring', amount: '12000.00', semester: 'fall' });
  year.resources.push({ id: 'job', type: 'job', label: 'Café ☕', amount: '0.00', incomeMode: 'hourly', hourlyWage: '15.00', hoursPerWeek: '15', weeksWorked: '30', unavailablePercent: '40' });
  plan.loans.push({
    id: 'loan-a', name: 'Direct Unsub', type: 'unsubsidized', principal: '5500.00', annualRate: '0.0653', disbursementDate: year.startDate,
    termMonths: 120, schoolYearId: year.id, academicYear: '2026-2027', gapAtCreation: '5500.00', capitalizeInterest: false, monthlyPayment: '75.00', payInterestWhileInSchool: true,
  });
  plan.loans.push({ id: 'loan-b', name: 'Private', type: 'private', principal: '2000.00', annualRate: '0.09', disbursementDate: year.startDate, termMonths: 120, accruesInterestInSchool: false, academicYear: '2024-2025' });
  plan.repayment = { ...plan.repayment, strategyId: 'custom', customOrder: ['loan-b', 'loan-a'], mode: 'federal', federalPlan: 'ibr', familySize: 3, maxMonths: 480 };
  plan.lifeEvents.push({ id: 'bonus', name: 'Bonus', date: '2031-06-01', type: 'windfall', amount: '1000.00', allocationPercent: '50', recurrence: 'yearly', recurrenceEndDate: '2035-06-01' });
  plan.scenarios.push({ id: 's1', name: 'Higher salary', overrides: { 'postGradIncome.annualSalary': '70000.00', 'settings.graceMonths': 0 } });
  plan.borrower = { dependency: 'independent', level: 'graduate', priorFederalDebt: '1200.50' };
  return plan;
}

describe('export → import round trip (US-1002)', () => {
  it('yields an identical document for a plan using every feature', () => {
    const document: PlannerDocument = { plan: richPlan(), disclaimerDismissed: true };
    const text = exportDocument(document);
    expect(importDocument(text)).toEqual({ ok: true, value: document });
    // And again: export of the import is the same JSON apart from the timestamp.
    const again = importDocument(text);
    if (!again.ok) throw new Error('import failed');
    const strip = (json: string) => ({ ...JSON.parse(json), savedAt: null });
    expect(strip(exportDocument(again.value))).toEqual(strip(text));
  });

  it('exports a versioned envelope with an app identifier and only plan inputs', () => {
    const plan = richPlan() as PlannerPlan & Record<string, unknown>;
    plan.projection = { debtFreeDate: '2040-01-01' };
    (plan.loans[0] as unknown as Record<string, unknown>).balanceAtRepaymentStart = '6000.00';
    const envelope = JSON.parse(exportDocument({ plan, disclaimerDismissed: false }));
    expect(Object.keys(envelope).sort()).toEqual(['app', 'document', 'savedAt', 'schemaVersion']);
    expect(envelope).toMatchObject({ app: 'debtnav', schemaVersion: 3 });
    expect(Object.keys(envelope.document).sort()).toEqual(['disclaimerDismissed', 'plan']);
    expect(Object.keys(envelope.document.plan).sort()).toEqual(
      ['borrower', 'lifeEvents', 'loans', 'postGradIncome', 'repayment', 'scenarios', 'schoolYears', 'settings'],
    );
    expect(envelope.document.plan.loans[0]).not.toHaveProperty('balanceAtRepaymentStart');
    expect(JSON.stringify(envelope)).not.toMatch(/amortization|debtFreeDate|totalInterest/);
  });

  it('round-trips arbitrary valid money, rates and text', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 100_000_000_000 }),
      fc.integer({ min: 0, max: 3000 }),
      fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim() !== ''),
      (cents, basisPoints, name) => {
        const plan = richPlan();
        plan.loans[0].principal = (cents / 100).toFixed(2);
        plan.loans[0].annualRate = (basisPoints / 10000).toString();
        plan.loans[0].name = name;
        const document = { plan, disclaimerDismissed: false };
        expect(importDocument(exportDocument(document))).toEqual({ ok: true, value: document });
      },
    ), { numRuns: 100 });
  });
});

describe('import never corrupts (US-1002)', () => {
  const current = exportDocument({ plan: richPlan(), disclaimerDismissed: true });

  it.each([
    ['future version', JSON.stringify({ app: 'debtnav', schemaVersion: 4, savedAt: '', document: { plan: richPlan(), disclaimerDismissed: true } }), /newer version/],
    ['fractional version', '{"app":"debtnav","schemaVersion":2.5,"document":{}}', /schema version/],
    ['string version', '{"app":"debtnav","schemaVersion":"3","document":{}}', /schema version/],
    ['an array', '[1,2,3]', /not a DebtNav/],
    ['null', 'null', /not a DebtNav/],
    ['a projection instead of a plan', JSON.stringify({ app: 'debtnav', schemaVersion: 3, document: { plan: { status: 'paidOff' }, disclaimerDismissed: false } }), /not valid/],
    ['a plan with a bad field', current.replace('"12000.00"', '"-12000.00"'), /costItems\.tuition\.amount/],
    ['a plan with a dangling override', current.replace('"postGradIncome.annualSalary"', '"loans.gone.principal"'), /no longer exists/],
    ['a prototype-pollution attempt', current.replace('"settings": {', '"settings": { "__proto__": { "polluted": true },'), /unsafe/],
  ])('rejects %s with a clear message and leaves stored data unchanged', (_name, text, message) => {
    const storage = memory({ [STORAGE_KEY]: current });
    const result = importDocument(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].path).toBe('import');
      expect(result.errors[0].message).toMatch(message);
    }
    expect(storage.getItem(STORAGE_KEY)).toBe(current);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('migrates an older (v2) export with dangling references instead of rejecting it', () => {
    const plan = richPlan() as unknown as Record<string, any>;
    plan.repayment.strategyId = 'input-order';
    plan.repayment.customOrder = ['loan-b', 'removed', 'loan-a'];
    plan.scenarios[0].overrides['loans.removed.principal'] = '1.00';
    const text = JSON.stringify({ schemaVersion: 2, savedAt: '2026-01-01T00:00:00.000Z', document: { plan, drafts: { 'loans.loan-a.principal': '55' }, disclaimerDismissed: true } });
    const result = importDocument(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan.repayment.strategyId).toBe('avalanche');
    expect(result.value.plan.repayment.customOrder).toEqual(['loan-b', 'loan-a']);
    expect(result.value.plan.scenarios[0].overrides).toEqual({ 'postGradIncome.annualSalary': '70000.00', 'settings.graceMonths': 0 });
    expect(result.value).not.toHaveProperty('drafts');
  });
});

describe('stored data (US-1001)', () => {
  it('preserves a future-version save as unreadable instead of discarding it', () => {
    const future = JSON.stringify({ app: 'debtnav', schemaVersion: 9, document: {} });
    const storage = memory({ [STORAGE_KEY]: future });
    const loaded = loadDocument(storage);
    expect(loaded).toMatchObject({ document: null, preservedUnreadable: true });
    expect(loaded.notice).toMatch(/newer version/);
    expect(loaded.notice).toMatch(/will not be saved/);
    expect(storage.getItem(STORAGE_KEY)).toBe(future);
  });

  it('prefers the current key over a legacy copy', () => {
    const current = exportDocument({ plan: richPlan(), disclaimerDismissed: true });
    const storage = memory({ [STORAGE_KEY]: current, [LEGACY_STORAGE_KEYS[0]]: 'garbage' });
    expect(loadDocument(storage)).toMatchObject({ preservedUnreadable: false, document: { disclaimerDismissed: true } });
  });

  it('treats a throwing window.localStorage getter (SecurityError) as unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: Object.defineProperty({}, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }),
    });
    try {
      expect(loadDocument()).toMatchObject({ document: null, preservedUnreadable: false });
      expect(saveDocument({ plan: createDefaultPlan(), disclaimerDismissed: false }).ok).toBe(false);
      expect(probeStorage()).toBe(false);
      expect(deleteDocument().ok).toBe(false);
    } finally {
      if (original) Object.defineProperty(globalThis, 'window', original);
      else delete (globalThis as Record<string, unknown>).window;
    }
  });

  it('reports QuotaExceededError without changing the previous save', () => {
    const storage = memory();
    saveDocument({ plan: createDefaultPlan(), disclaimerDismissed: false }, storage);
    const before = storage.getItem(STORAGE_KEY);
    storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
    const result = saveDocument({ plan: richPlan(), disclaimerDismissed: false }, storage);
    expect(result.ok).toBe(false);
    expect(result.notice).toMatch(/could not be saved/);
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
  });
});

describe('probeStorage', () => {
  it('detects writable storage and leaves no probe key behind', () => {
    const storage = memory();
    expect(probeStorage(storage)).toBe(true);
    expect(storage.data.size).toBe(0);
  });

  it('detects storage that reads but cannot write', () => {
    const storage = memory();
    storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
    expect(probeStorage(storage)).toBe(false);
  });
});

describe('deleting (US-1003)', () => {
  it('removes every DebtNav key and nothing else', () => {
    const others = { 'other-app.plan': 'keep', 'debtnavigator': 'keep', 'theme': 'dark' };
    const storage = memory({ ...others, [STORAGE_KEY]: 'x', [LEGACY_STORAGE_KEYS[0]]: 'y', [PROBE_STORAGE_KEY]: '1' });
    expect(deleteDocument(storage)).toEqual({ ok: true, notice: null });
    expect(Object.fromEntries(storage.data)).toEqual(others);
    expect(ALL_STORAGE_KEYS).toEqual(expect.arrayContaining([STORAGE_KEY, ...LEGACY_STORAGE_KEYS, PROBE_STORAGE_KEY]));
  });

  it('reports failure when a key cannot be removed, after trying all of them', () => {
    const storage = memory({ [STORAGE_KEY]: 'x', [LEGACY_STORAGE_KEYS[0]]: 'y' });
    const remove = storage.removeItem;
    storage.removeItem = key => { if (key === STORAGE_KEY) throw new DOMException('denied', 'SecurityError'); remove(key); };
    expect(deleteDocument(storage).ok).toBe(false);
    expect(storage.getItem(LEGACY_STORAGE_KEYS[0])).toBeNull();
  });
});

describe('repairing loans disbursed after repayment start (older dev builds)', () => {
  /** A v3 envelope written without validation, as an earlier build could have. */
  const legacyEnvelope = (mutate: (plan: PlannerPlan) => void, version = 3): string => {
    const plan = createDefaultPlan();
    plan.loans.push({ id: 'spring', name: 'Spring loan', type: 'private', principal: '1000.00', annualRate: '0.05', disbursementDate: '2031-01-10', termMonths: 120 });
    mutate(plan);
    return JSON.stringify({ app: 'debtnav', schemaVersion: version, savedAt: '2026-01-01T00:00:00.000Z', document: { plan, disclaimerDismissed: true } });
  };
  const MOVED = 'Loan "Spring loan" disbursement moved from 2031-01-10 to 2030-11-20 so it can be projected.';

  it('load: moves the loan to the repayment start, explains it, and leaves the stored text alone', () => {
    const raw = legacyEnvelope(() => {});
    const storage = memory({ [STORAGE_KEY]: raw });
    const loaded = loadDocument(storage);
    expect(loaded.preservedUnreadable).toBe(false);
    expect(loaded.repairs).toEqual([MOVED]);
    expect(loaded.notice).toContain(MOVED);
    expect(loaded.document!.plan.loans[0].disbursementDate).toBe('2030-11-20');
    expect(storage.getItem(STORAGE_KEY)).toBe(raw);
  });

  it('load: any other validation failure still preserves and pauses', () => {
    const raw = legacyEnvelope(plan => { plan.loans[0].principal = '-1.00'; });
    const loaded = loadDocument(memory({ [STORAGE_KEY]: raw }));
    expect(loaded).toMatchObject({ document: null, preservedUnreadable: true, repairs: [] });
  });

  it('import: repairs base loans and reports each change', () => {
    const { result, repairs } = importDocumentDetailed(legacyEnvelope(plan => {
      plan.loans.push({ id: 'late2', name: 'Summer loan', type: 'private', principal: '50.00', annualRate: '0.05', disbursementDate: '2032-06-01', termMonths: 60 });
    }));
    expect(result.ok).toBe(true);
    expect(repairs).toEqual([MOVED, 'Loan "Summer loan" disbursement moved from 2032-06-01 to 2030-11-20 so it can be projected.']);
  });

  it('import: drops the scenario override that makes a loan late, keeping the rest of the scenario', () => {
    const { result, repairs } = importDocumentDetailed(legacyEnvelope(plan => {
      plan.loans[0].disbursementDate = '2030-08-01';
      plan.scenarios.push({ id: 's1', name: 'No grace', overrides: { 'settings.graceMonths': 0, 'postGradIncome.annualSalary': '60000.00' } });
      plan.scenarios.push({ id: 's2', name: 'Late loan', overrides: { 'loans.spring.disbursementDate': '2031-03-01' } });
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan.loans[0].disbursementDate).toBe('2030-08-01');
    expect(result.value.plan.scenarios.map(s => s.overrides)).toEqual([{ 'postGradIncome.annualSalary': '60000.00' }, {}]);
    expect(repairs).toEqual([
      'Scenario "No grace": removed the change to the grace period (0) so loan "Spring loan" can be projected.',
      'Scenario "Late loan": removed the change to loan "Spring loan" disbursement date (2031-03-01) so loan "Spring loan" can be projected.',
    ]);
  });

  it('import: a repaired base plan whose scenario is also affected is fully repaired', () => {
    const { result, repairs } = importDocumentDetailed(legacyEnvelope(plan => {
      plan.scenarios.push({ id: 's1', name: 'Short', overrides: { 'settings.graduationDate': '2029-05-20' } });
    }));
    expect(result.ok).toBe(true);
    expect(repairs).toHaveLength(2);
    expect(repairs[1]).toMatch(/Scenario "Short": removed the change to the graduation date/);
  });

  it('import: v2 files are migrated and repaired', () => {
    const { result, repairs } = importDocumentDetailed(legacyEnvelope(() => {}, 2));
    expect(result.ok).toBe(true);
    expect(repairs).toEqual([MOVED]);
  });

  it('import: other errors are still rejected (nothing is repaired)', () => {
    const { result, repairs } = importDocumentDetailed(legacyEnvelope(plan => { plan.settings.graceMonths = 13; }));
    expect(result.ok).toBe(false);
    expect(repairs).toEqual([]);
  });
});
