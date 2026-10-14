import { render } from '@testing-library/react';
import type { PlannerDocument, PlannerPlan, PlannerStore, StorageLike } from '../../engine/planner-contracts';
import { createDefaultPlan } from '../../engine/planner';
import { exportDocument } from '../../data/storage';
import { STORAGE_KEY } from '../../data/storage';
import { usePlannerDocument } from '../../state/usePlannerDocument';
import PlannerApp from '../PlannerApp';

export function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
  };
}

/** A plan with one cost, one resource, and two loans so every result is populated. */
export function samplePlan(): PlannerPlan {
  const plan = createDefaultPlan();
  const [first] = plan.schoolYears;
  return {
    ...plan,
    schoolYears: plan.schoolYears.map(year => year.id !== first.id ? year : {
      ...year,
      costItems: [{ id: 'cost-1', category: 'tuition', label: 'Tuition', amount: '10000.00', semester: 'annual' }],
      resources: [{ id: 'res-1', type: 'grant', label: 'Pell grant', amount: '4000.00', incomeMode: 'fixed', hourlyWage: '15.00', hoursPerWeek: '15', weeksWorked: '30', unavailablePercent: '0' }],
    }),
    loans: [
      { id: 'loan-a', name: 'Alpha loan', type: 'unsubsidized', principal: '5000.00', annualRate: '0.05', disbursementDate: first.startDate, termMonths: 120, capitalizeInterest: true },
      { id: 'loan-b', name: 'Beta loan', type: 'private', principal: '20000.00', annualRate: '0.09', disbursementDate: first.startDate, termMonths: 120, capitalizeInterest: true },
    ],
    repayment: { ...plan.repayment, customOrder: ['loan-a', 'loan-b'] },
    postGradIncome: { ...plan.postGradIncome, monthlyDebtBudget: '600.00' },
  };
}

export function storedDocument(plan: PlannerPlan, disclaimerDismissed = true): Record<string, string> {
  const document: PlannerDocument = { plan, disclaimerDismissed };
  return { [STORAGE_KEY]: exportDocument(document) };
}

export function renderPlanner(options: { plan?: PlannerPlan; disclaimerDismissed?: boolean; storage?: StorageLike } = {}) {
  const storage = options.storage ?? memoryStorage(options.plan ? storedDocument(options.plan, options.disclaimerDismissed ?? true) : {});
  const handle: { store: PlannerStore | null } = { store: null };
  function Harness() {
    const store = usePlannerDocument({ storage, debounceMs: 0 });
    handle.store = store;
    return <PlannerApp store={store} />;
  }
  const view = render(<Harness />);
  return { ...view, storage, plan: () => handle.store!.document.plan, store: () => handle.store! };
}
