import type { PayoffStrategy } from '../contracts';
import { D } from '../money';

/** US-601: highest annual rate first; ties go to the smaller balance, then loan id. */
export const avalanche: PayoffStrategy = {
  id: 'avalanche',
  name: 'Avalanche (highest rate first)',
  // Sort keys are parsed once per loan (not once per comparison); the order is unchanged.
  orderLoans: loans => loans
    .map(loan => ({ loan, rate: new D(loan.annualRate), balance: new D(loan.balance) }))
    .sort((a, b) => b.rate.cmp(a.rate) || a.balance.cmp(b.balance) || a.loan.id.localeCompare(b.loan.id))
    .map(entry => entry.loan),
};
