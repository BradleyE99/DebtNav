/** Small immutable helpers for editing one record of a plan by id. */
import type {
  CostItem, LifeEvent, PlannerLoan, PlannerPlan, PlannerYear, Resource, Scenario,
} from '../engine/planner-contracts';

export function updateYear(plan: PlannerPlan, yearId: string, edit: (year: PlannerYear) => PlannerYear): PlannerPlan {
  return { ...plan, schoolYears: plan.schoolYears.map(year => (year.id === yearId ? edit(year) : year)) };
}

export function updateCost(plan: PlannerPlan, yearId: string, itemId: string, patch: Partial<CostItem>): PlannerPlan {
  return updateYear(plan, yearId, year => ({
    ...year, costItems: year.costItems.map(item => (item.id === itemId ? { ...item, ...patch } : item)),
  }));
}

export function updateResource(plan: PlannerPlan, yearId: string, resourceId: string, patch: Partial<Resource>): PlannerPlan {
  return updateYear(plan, yearId, year => ({
    ...year, resources: year.resources.map(item => (item.id === resourceId ? { ...item, ...patch } : item)),
  }));
}

export function updateLoan(plan: PlannerPlan, loanId: string, patch: Partial<PlannerLoan>): PlannerPlan {
  return {
    ...plan,
    loans: plan.loans.map(loan => {
      if (loan.id !== loanId) return loan;
      const next = { ...loan, ...patch };
      // Optional fields set to undefined are removed so the stored document stays clean.
      for (const key of Object.keys(patch) as (keyof PlannerLoan)[]) if (patch[key] === undefined) delete next[key];
      return next;
    }),
  };
}

export function updateEvent(plan: PlannerPlan, eventId: string, patch: Partial<LifeEvent>): PlannerPlan {
  return {
    ...plan,
    lifeEvents: plan.lifeEvents.map(event => {
      if (event.id !== eventId) return event;
      const next = { ...event, ...patch };
      for (const key of Object.keys(patch) as (keyof LifeEvent)[]) if (patch[key] === undefined) delete next[key];
      return next;
    }),
  };
}

export function updateScenario(plan: PlannerPlan, scenarioId: string, patch: Partial<Scenario>): PlannerPlan {
  return { ...plan, scenarios: plan.scenarios.map(s => (s.id === scenarioId ? { ...s, ...patch } : s)) };
}

/** Loans in the effective custom payoff order: saved order first, then any loans not yet listed. */
export function effectiveCustomOrder(plan: PlannerPlan): string[] {
  const known = new Set(plan.loans.map(loan => loan.id));
  const saved = plan.repayment.customOrder.filter(id => known.has(id));
  return [...saved, ...plan.loans.map(loan => loan.id).filter(id => !saved.includes(id))];
}

export function moveInCustomOrder(plan: PlannerPlan, loanId: string, toIndex: number): PlannerPlan {
  const order = effectiveCustomOrder(plan);
  const from = order.indexOf(loanId);
  if (from < 0) return plan;
  order.splice(from, 1);
  order.splice(Math.max(0, Math.min(toIndex, order.length)), 0, loanId);
  return { ...plan, repayment: { ...plan.repayment, customOrder: order } };
}

/** True when a year holds user data that would be lost if the year were removed. */
export function yearHasData(plan: PlannerPlan, year: PlannerYear): boolean {
  return year.costItems.length > 0 || year.resources.length > 0
    || plan.loans.some(loan => loan.schoolYearId === year.id)
    || plan.lifeEvents.some(event => event.schoolYearId === year.id);
}
