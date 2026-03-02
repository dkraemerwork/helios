import type { Predicate } from '../../Predicate';
import type { QueryableEntry } from '../QueryableEntry';

/**
 * Predicate that always returns false.
 * Equivalent to Java's FalsePredicate / Predicates.alwaysFalse().
 */
export class FalsePredicate<K = unknown, V = unknown> implements Predicate<K, V> {
  static readonly INSTANCE = new FalsePredicate();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  apply(_entry: QueryableEntry<K, V>): boolean {
    return false;
  }

  toString(): string {
    return 'FalsePredicate{}';
  }
}

export function falsePredicate<K = unknown, V = unknown>(): Predicate<K, V> {
  return FalsePredicate.INSTANCE as FalsePredicate<K, V>;
}
