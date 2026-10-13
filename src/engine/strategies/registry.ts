import type { PayoffStrategy } from '../contracts';
import { inputOrder } from './input-order';
const strategies: readonly PayoffStrategy[] = [inputOrder];
export function getStrategy(id: string): PayoffStrategy | undefined {
  return strategies.find(strategy => strategy.id === id);
}
