import type { Plan } from '../engine/contracts';
export const standardSample: Plan = {
  settings: { startDate: '2026-01-01', graduationDate: '2026-07-01', graceMonths: 6, currency: 'USD' },
  schoolYears: [],
  loans: [{ id: 'standard', name: 'Standard repayment example', type: 'unsubsidized', principal: '30000.00', annualRate: '0.065', disbursementDate: '2027-01-01', termMonths: 120, monthlyPayment: '340.64' }],
  repayment: { strategyId: 'input-order', extraMonthlyPayment: '0.00' },
};
export const accrualSample: Plan = {
  ...standardSample,
  loans: [{ id: 'accrual', name: 'In-school interest example', type: 'unsubsidized', principal: '5000.00', annualRate: '0.06', disbursementDate: '2026-01-01', termMonths: 120 }],
};
export const underpaymentSample: Plan = {
  ...standardSample,
  loans: [{ ...standardSample.loans[0], monthlyPayment: '100.00' }],
};
export const interestPaidSample: Plan = {
  ...accrualSample,
  loans: [{ ...accrualSample.loans[0], payInterestWhileInSchool: true }],
};
