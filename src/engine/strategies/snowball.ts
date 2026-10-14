import type { PayoffStrategy } from '../contracts';
import { D } from '../money';

/** US-602: smallest balance first; ties go to the higher annual rate, then loan id. */
export const snowball: PayoffStrategy = {
  id: 'snowball',
  name: 'Snowball (smallest balance first)',
  // Sort keys are parsed once per loan (not once per comparison); the order is unchanged.
  orderLoans: loans => loans
    .map(loan => ({ loan, rate: new D(loan.annualRate), balance: new D(loan.balance) }))
    .sort((a, b) => a.balance.cmp(b.balance) || b.rate.cmp(a.rate) || a.loan.id.localeCompare(b.loan.id))
    .map(entry => entry.loan),
};
