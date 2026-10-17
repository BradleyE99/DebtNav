/**
 * Independent v2/v3 → v4 migration checks (tester). The oracle is a snapshot of the PRE-v4 engine (schema 3, HEAD
 * 6884937) taken on 2026-10-16 before the engine changed: migrated plans must keep every stored value and give
 * identical projections (lead decision 4; team/tester-expected.md §6). Do not regenerate these values from the new engine.
 */
import { describe, it, expect } from "vitest";
import { importDocument, serializeDocument, migrateToCurrent } from "../../src/data/storage";
import { validateDocument } from "../../src/data/validation";
import { calculatePlannerOutputs, calculatePlannerComparisons } from "../../src/engine/planner";

type Json = any;
const FIXTURES: Record<string, { envelope: Json; expected: Json }> = {"A_grace6_federal":{"envelope":{"app":"debtnav","schemaVersion":3,"savedAt":"2026-10-16T00:00:00.000Z","document":{"plan":{"settings":{"startDate":"2026-08-24","graduationDate":"2030-05-20","graceMonths":6,"currency":"USD"},"schoolYears":[{"id":"year-1","startDate":"2026-08-24","endDate":"2027-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-2","startDate":"2027-08-24","endDate":"2028-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-3","startDate":"2028-08-24","endDate":"2029-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-4","startDate":"2029-08-24","endDate":"2030-05-20","costItems":[],"resources":[],"bufferPercent":"0"}],"loans":[{"id":"a1","name":"Loan a1","type":"subsidized","principal":"3500.00","annualRate":"0.0653","disbursementDate":"2026-08-24","termMonths":120},{"id":"a2","name":"Loan a2","type":"unsubsidized","principal":"2000.00","annualRate":"0.0653","disbursementDate":"2026-08-24","termMonths":120},{"id":"a3","name":"Loan a3","type":"unsubsidized","principal":"5500.00","annualRate":"0.0653","disbursementDate":"2027-08-24","termMonths":120}],"repayment":{"strategyId":"avalanche","extraMonthlyPayment":"0.00","maxMonths":360,"customOrder":[],"mode":"standard","federalPlan":"rap","familySize":1,"annualAGI":"55000.00"},"postGradIncome":{"annualSalary":"55000.00","monthlyDebtBudget":"400.00","raiseAllocationPercent":"50"},"lifeEvents":[],"scenarios":[],"borrower":{"dependency":"dependent","level":"undergraduate","priorFederalDebt":"0.00"}},"disclaimerDismissed":true}},"expected":{"status":"paidOff","debtFreeDate":"2033-11-20","totalInterestPaid":"3003.79","totalRepaymentPayments":"14003.79","months":36,"firstPaymentDate":"2030-12-20","balanceAtRepaymentStart":"12719.26","minimumTotal":"144.62","scenarios":[]}},"B_grace0_private":{"envelope":{"app":"debtnav","schemaVersion":3,"savedAt":"2026-10-16T00:00:00.000Z","document":{"plan":{"settings":{"startDate":"2026-08-24","graduationDate":"2030-05-20","graceMonths":0,"currency":"USD"},"schoolYears":[{"id":"year-1","startDate":"2026-08-24","endDate":"2027-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-2","startDate":"2027-08-24","endDate":"2028-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-3","startDate":"2028-08-24","endDate":"2029-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-4","startDate":"2029-08-24","endDate":"2030-05-20","costItems":[],"resources":[],"bufferPercent":"0"}],"loans":[{"id":"b1","name":"Loan b1","type":"private","principal":"10000.00","annualRate":"0.089","disbursementDate":"2027-08-24","termMonths":120,"capitalizeInterest":false},{"id":"b2","name":"Loan b2","type":"unsubsidized","principal":"5500.00","annualRate":"0.0653","disbursementDate":"2028-08-24","termMonths":120,"payInterestWhileInSchool":true}],"repayment":{"strategyId":"avalanche","extraMonthlyPayment":"0.00","maxMonths":360,"customOrder":[],"mode":"standard","federalPlan":"rap","familySize":1,"annualAGI":"55000.00"},"postGradIncome":{"annualSalary":"55000.00","monthlyDebtBudget":"350.00","raiseAllocationPercent":"50"},"lifeEvents":[],"scenarios":[],"borrower":{"dependency":"dependent","level":"undergraduate","priorFederalDebt":"0.00"}},"disclaimerDismissed":true}},"expected":{"status":"paidOff","debtFreeDate":"2035-08-20","totalInterestPaid":"6925.49","totalRepaymentPayments":"21801.69","months":63,"firstPaymentDate":"2030-06-20","balanceAtRepaymentStart":"15500.00","minimumTotal":"219.43","scenarios":[]}},"C_grace9_events":{"envelope":{"app":"debtnav","schemaVersion":3,"savedAt":"2026-10-16T00:00:00.000Z","document":{"plan":{"settings":{"startDate":"2026-08-24","graduationDate":"2030-05-20","graceMonths":9,"currency":"USD"},"schoolYears":[{"id":"year-1","startDate":"2026-08-24","endDate":"2027-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-2","startDate":"2027-08-24","endDate":"2028-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-3","startDate":"2028-08-24","endDate":"2029-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-4","startDate":"2029-08-24","endDate":"2030-05-20","costItems":[],"resources":[],"bufferPercent":"0"}],"loans":[{"id":"c1","name":"Loan c1","type":"unsubsidized","principal":"7000.00","annualRate":"0.05","disbursementDate":"2026-08-24","termMonths":120},{"id":"c2","name":"Loan c2","type":"private","principal":"3000.00","annualRate":"0.11","disbursementDate":"2028-08-24","termMonths":120},{"id":"c3","name":"Loan c3","type":"subsidized","principal":"4500.00","annualRate":"0.04","disbursementDate":"2029-08-24","termMonths":120}],"repayment":{"strategyId":"snowball","extraMonthlyPayment":"0.00","maxMonths":360,"customOrder":[],"mode":"standard","federalPlan":"rap","familySize":1,"annualAGI":"55000.00"},"postGradIncome":{"annualSalary":"55000.00","monthlyDebtBudget":"300.00","raiseAllocationPercent":"50"},"lifeEvents":[{"id":"e1","name":"Raise","date":"2032-06-01","type":"income","amount":"70000.00","allocationPercent":"50"},{"id":"e2","name":"Bonus","date":"2033-01-15","type":"windfall","amount":"2000.00","allocationPercent":"100","recurrence":"yearly","recurrenceEndDate":"2036-01-15"}],"scenarios":[{"id":"s1","name":"Short grace","overrides":{"settings.graceMonths":3}}],"borrower":{"dependency":"dependent","level":"undergraduate","priorFederalDebt":"0.00"}},"disclaimerDismissed":true}},"expected":{"status":"paidOff","debtFreeDate":"2033-06-20","totalInterestPaid":"3919.98","totalRepaymentPayments":"18419.98","months":28,"firstPaymentDate":"2031-03-20","balanceAtRepaymentStart":"16896.30","minimumTotal":"189.16","scenarios":[{"id":"s1","debtFreeDate":"2033-04-20","totalInterestPaid":"3765.12"}]}},"D_grace12_custom":{"envelope":{"app":"debtnav","schemaVersion":3,"savedAt":"2026-10-16T00:00:00.000Z","document":{"plan":{"settings":{"startDate":"2026-08-24","graduationDate":"2030-05-20","graceMonths":12,"currency":"USD"},"schoolYears":[{"id":"year-1","startDate":"2026-08-24","endDate":"2027-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-2","startDate":"2027-08-24","endDate":"2028-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-3","startDate":"2028-08-24","endDate":"2029-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-4","startDate":"2029-08-24","endDate":"2030-05-20","costItems":[],"resources":[],"bufferPercent":"0"}],"loans":[{"id":"d1","name":"Loan d1","type":"private","principal":"8000.00","annualRate":"0.07","disbursementDate":"2026-08-24","termMonths":120,"accruesInterestInSchool":false},{"id":"d2","name":"Loan d2","type":"other","principal":"4000.00","annualRate":"0.03","disbursementDate":"2027-08-24","termMonths":120},{"id":"d3","name":"Loan d3","type":"unsubsidized","principal":"6000.00","annualRate":"0.0653","disbursementDate":"2028-08-24","termMonths":120,"capitalizeInterest":false}],"repayment":{"strategyId":"custom","extraMonthlyPayment":"0.00","maxMonths":360,"customOrder":["d2","d3","d1"],"mode":"standard","federalPlan":"rap","familySize":1,"annualAGI":"55000.00"},"postGradIncome":{"annualSalary":"55000.00","monthlyDebtBudget":"500.00","raiseAllocationPercent":"50"},"lifeEvents":[],"scenarios":[],"borrower":{"dependency":"dependent","level":"undergraduate","priorFederalDebt":"0.00"}},"disclaimerDismissed":true}},"expected":{"status":"paidOff","debtFreeDate":"2035-01-20","totalInterestPaid":"3931.20","totalRepaymentPayments":"21931.20","months":44,"firstPaymentDate":"2031-06-20","balanceAtRepaymentStart":"18448.77","minimumTotal":"216.26","scenarios":[]}},"E_not_amortizing":{"envelope":{"app":"debtnav","schemaVersion":3,"savedAt":"2026-10-16T00:00:00.000Z","document":{"plan":{"settings":{"startDate":"2026-08-24","graduationDate":"2030-05-20","graceMonths":6,"currency":"USD"},"schoolYears":[{"id":"year-1","startDate":"2026-08-24","endDate":"2027-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-2","startDate":"2027-08-24","endDate":"2028-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-3","startDate":"2028-08-24","endDate":"2029-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-4","startDate":"2029-08-24","endDate":"2030-05-20","costItems":[],"resources":[],"bufferPercent":"0"}],"loans":[{"id":"n1","name":"Loan n1","type":"unsubsidized","principal":"60000.00","annualRate":"0.08","disbursementDate":"2026-08-24","termMonths":120}],"repayment":{"strategyId":"avalanche","extraMonthlyPayment":"0.00","maxMonths":360,"customOrder":[],"mode":"standard","federalPlan":"rap","familySize":1,"annualAGI":"55000.00"},"postGradIncome":{"annualSalary":"55000.00","monthlyDebtBudget":"100.00","raiseAllocationPercent":"50"},"lifeEvents":[],"scenarios":[],"borrower":{"dependency":"dependent","level":"undergraduate","priorFederalDebt":"0.00"}},"disclaimerDismissed":true}},"expected":{"status":"notAmortizing","debtFreeDate":null,"totalInterestPaid":null,"totalRepaymentPayments":"100.00","months":1,"firstPaymentDate":"2030-12-20","balanceAtRepaymentStart":"80370.41","minimumTotal":"975.11","scenarios":[]}},"V2_file":{"envelope":{"app":"debtnav","schemaVersion":2,"savedAt":"2026-01-01T00:00:00.000Z","document":{"plan":{"settings":{"startDate":"2026-08-24","graduationDate":"2030-05-20","graceMonths":6,"currency":"USD"},"schoolYears":[{"id":"year-1","startDate":"2026-08-24","endDate":"2027-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-2","startDate":"2027-08-24","endDate":"2028-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-3","startDate":"2028-08-24","endDate":"2029-08-24","costItems":[],"resources":[],"bufferPercent":"0"},{"id":"year-4","startDate":"2029-08-24","endDate":"2030-05-20","costItems":[],"resources":[],"bufferPercent":"0"}],"loans":[{"id":"v1","name":"Loan v1","type":"unsubsidized","principal":"5000.00","annualRate":"0.06","disbursementDate":"2027-08-24","termMonths":120},{"id":"v2","name":"Loan v2","type":"subsidized","principal":"3000.00","annualRate":"0.05","disbursementDate":"2028-08-24","termMonths":120}],"repayment":{"strategyId":"input-order","extraMonthlyPayment":"250.00","maxMonths":360}},"disclaimerDismissed":false,"drafts":{"x":"1"}}},"expected":{"status":"paidOff","debtFreeDate":"2034-03-20","totalInterestPaid":"1827.67","months":40,"firstPaymentDate":"2030-12-20","strategyId":"avalanche"}}};

function migrate(envelope: Json) {
  const result = importDocument(JSON.stringify(envelope));
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

describe("v3 → v4 migration keeps projections identical", () => {
  for (const [name, { envelope, expected }] of Object.entries(FIXTURES).filter(([n]) => n !== "V2_file")) {
    it(name, () => {
      const document = migrate(envelope);
      const out = calculatePlannerOutputs(document.plan);
      if (!out.ok || !out.value.repayment) throw new Error(JSON.stringify(out));
      const r = out.value.repayment;
      expect({
        status: r.status, debtFreeDate: r.debtFreeDate, totalInterestPaid: r.totalInterestPaid,
        totalRepaymentPayments: r.totalRepaymentPayments, months: r.amortizationSchedule.length,
        firstPaymentDate: r.firstPaymentDate, balanceAtRepaymentStart: r.balanceAtRepaymentStart,
      }).toEqual({
        status: expected.status, debtFreeDate: expected.debtFreeDate, totalInterestPaid: expected.totalInterestPaid,
        totalRepaymentPayments: expected.totalRepaymentPayments, months: expected.months,
        firstPaymentDate: expected.firstPaymentDate, balanceAtRepaymentStart: expected.balanceAtRepaymentStart,
      });
      expect(out.value.minimumTotal).toBe(expected.minimumTotal);
      expect(out.value.missedObligations).toEqual([]);
      const comparisons = calculatePlannerComparisons(document.plan);
      if (!comparisons.ok) throw new Error(JSON.stringify(comparisons.errors));
      expect(comparisons.value.scenarioComparisons.map(c => ({ id: c.id, debtFreeDate: c.projection.debtFreeDate, totalInterestPaid: c.projection.totalInterestPaid })))
        .toEqual(expected.scenarios);
    });
  }
});

describe("v3 → v4 migration keeps every stored value", () => {
  for (const [name, { envelope, expected }] of Object.entries(FIXTURES).filter(([n]) => n !== "V2_file")) {
    it(name, () => {
      const v3 = envelope.document.plan;
      const { plan } = migrate(envelope);
      const g = v3.settings.graceMonths;
      expect(plan.settings).toEqual({ startDate: v3.settings.startDate, graduationDate: v3.settings.graduationDate, currency: "USD" });
      expect("maxMonths" in plan.repayment).toBe(false);
      expect(plan.repayment.payoffTarget).toEqual({ mode: "budget" });
      expect(plan.repayment.voluntaryStart).toEqual({ kind: "afterGraduation", months: g });
      const { maxMonths: _drop, ...keptRepayment } = v3.repayment;
      expect(plan.repayment).toMatchObject(keptRepayment);
      expect(plan.postGradIncome).toMatchObject(v3.postGradIncome);
      expect(plan.borrower).toEqual(v3.borrower);
      expect(plan.lifeEvents).toEqual(v3.lifeEvents);
      expect(plan.schoolYears).toEqual(v3.schoolYears);
      expect(plan.loans.map(l => l.id)).toEqual(v3.loans.map((l: Json) => l.id));
      for (const old of v3.loans) {
        const now = plan.loans.find(l => l.id === old.id)!;
        expect(now).toMatchObject(old);
        if (old.type === "private" || old.type === "other") expect(now.requiredPayment?.graceMonths).toBe(g);
        // Federal: actual first due date pinned to the old first payment date only when the old grace was not 6.
        else if (g !== 6) expect(now.requiredPayment?.firstDueDate).toBe(expected.firstPaymentDate);
        else expect(now.requiredPayment).toBeUndefined();
      }
      expect(plan.scenarios.map(s => s.id)).toEqual(v3.scenarios.map((s: Json) => s.id));
      for (const s of plan.scenarios) {
        const before = v3.scenarios.find((o: Json) => o.id === s.id).overrides;
        expect(Object.keys(s.overrides)).not.toContain("settings.graceMonths");
        if ("settings.graceMonths" in before) expect(s.overrides["repayment.voluntaryStart.months"]).toBe(before["settings.graceMonths"]);
      }
    });
  }

  it("migrated documents re-export as schema 4 and re-import unchanged (idempotent)", () => {
    for (const { envelope } of Object.values(FIXTURES)) {
      const document = migrate(envelope);
      const text = serializeDocument(document);
      if (!text.ok) throw new Error(JSON.stringify(text.errors));
      expect(JSON.parse(text.value).schemaVersion).toBe(4);
      expect(migrate(JSON.parse(text.value))).toEqual(document);
    }
  });
});

describe("migrateToCurrent (pure) + validateDocument", () => {
  it("migrates every v3 fixture to a valid v4 document without mutating its input", () => {
    for (const { envelope } of Object.values(FIXTURES)) {
      const input = JSON.parse(JSON.stringify(envelope.document));
      const frozen = JSON.stringify(input);
      const migrated = migrateToCurrent(input, envelope.schemaVersion);
      expect(JSON.stringify(input)).toBe(frozen);
      const checked = validateDocument(migrated);
      expect(checked.ok, JSON.stringify(checked)).toBe(true);
    }
  });
});

describe("v2 → v3 → v4 chain", () => {
  it("a schema-2 file migrates (input-order → avalanche, drafts dropped) with the old projection", () => {
    const { envelope, expected } = FIXTURES.V2_file;
    const document = migrate(envelope);
    expect(document.plan.repayment.strategyId).toBe("avalanche");
    expect("drafts" in document).toBe(false);
    const out = calculatePlannerOutputs(document.plan);
    if (!out.ok || !out.value.repayment) throw new Error(JSON.stringify(out));
    expect(out.value.repayment.debtFreeDate).toBe(expected.debtFreeDate);
    expect(out.value.repayment.totalInterestPaid).toBe(expected.totalInterestPaid);
    expect(out.value.repayment.amortizationSchedule).toHaveLength(expected.months);
    expect(out.value.repayment.firstPaymentDate).toBe(expected.firstPaymentDate);
  });

  it("a newer schema (5) is rejected with a clear message", () => {
    const result = importDocument(JSON.stringify({ ...FIXTURES.A_grace6_federal.envelope, schemaVersion: 5 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].message).toMatch(/newer version/);
  });
});

describe("v4 validation (US-102: dates cannot precede disbursement)", () => {
  it("a voluntary start date before the earliest disbursement is a field error", async () => {
    const { createDefaultPlan } = await import("../../src/engine/planner");
    const { validatePlannerPlan } = await import("../../src/data/validation");
    const base = createDefaultPlan();
    const plan = {
      ...base,
      loans: [{ id: "u", name: "Loan u", type: "unsubsidized" as const, principal: "1000.00", annualRate: "0.05", disbursementDate: "2030-09-01", termMonths: 120 }],
      repayment: { ...base.repayment, voluntaryStart: { kind: "date" as const, date: "2030-06-01" } },
    };
    const result = validatePlannerPlan(plan);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some(e => e.path.startsWith("repayment.voluntaryStart"))).toBe(true);
  });
});
