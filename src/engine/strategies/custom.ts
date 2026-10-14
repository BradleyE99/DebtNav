import type { PayoffStrategy } from '../contracts';

/** US-603: the user's explicit order; loans missing from the order follow in input order. */
export function customStrategy(order: readonly string[]): PayoffStrategy {
  const rank = new Map(order.map((id, index) => [id, index]));
  const rankOf = (id: string) => rank.get(id) ?? order.length;
  return {
    id: 'custom',
    name: 'Custom order (your ranking)',
    orderLoans: loans => [...loans].sort((a, b) => rankOf(a.id) - rankOf(b.id)),
  };
}
