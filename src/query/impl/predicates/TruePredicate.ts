import type { Predicate } from '../../Predicate';
import type { QueryableEntry } from '../QueryableEntry';

/**
 * Predicate that always returns true.
 * Equivalent to Java's TruePredicate / Predicates.alwaysTrue().
 */
export class TruePredicate<K = unknown, V = unknown> implements Predicate<K, V> {
  static readonly INSTANCE = new TruePredicate();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  apply(_entry: QueryableEntry<K, V>): boolean {
    return true;
  }

  toString(): string {
    return 'TruePredicate{}';
  }
}

export function truePredicate<K = unknown, V = unknown>(): Predicate<K, V> {
  return TruePredicate.INSTANCE as TruePredicate<K, V>;
}
