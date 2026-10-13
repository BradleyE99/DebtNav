import type { PayoffStrategy } from '../contracts';
export const inputOrder: PayoffStrategy = {
  id: 'input-order', name: 'Input order', orderLoans: loans => [...loans],
};
