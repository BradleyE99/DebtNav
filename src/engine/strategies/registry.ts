import type { PayoffStrategy } from '../contracts';
import { inputOrder } from './input-order';
import { avalanche } from './avalanche';
import { snowball } from './snowball';
import { customStrategy } from './custom';

/** Plan data a strategy may need when it is built (e.g. the user's custom order). */
export interface StrategyContext { customOrder: readonly string[] }
export interface StrategyRegistration {
  id: string;
  name: string;
  /** Internal strategies are valid for projections but excluded from user-facing comparisons. */
  internal?: boolean;
  create(context: StrategyContext): PayoffStrategy;
}

const fixed = (strategy: PayoffStrategy, internal = false): StrategyRegistration =>
  ({ id: strategy.id, name: strategy.name, internal, create: () => strategy });

/**
 * US-605: adding a strategy = one new file + one entry here. The engine and the comparison
 * code iterate this list; nothing else changes.
 */
const registry: readonly StrategyRegistration[] = [
  fixed(inputOrder, true),
  fixed(avalanche),
  fixed(snowball),
  { id: 'custom', name: 'Custom order (your ranking)', create: context => customStrategy(context.customOrder) },
];

const emptyContext: StrategyContext = { customOrder: [] };

/** M1 lookup; custom resolves with an empty order (input order). */
export function getStrategy(id: string, context: StrategyContext = emptyContext): PayoffStrategy | undefined {
  return registry.find(entry => entry.id === id)?.create(context);
}

/** User-facing strategies in display order. */
export function listStrategies(): readonly StrategyRegistration[] {
  return registry.filter(entry => !entry.internal);
}
