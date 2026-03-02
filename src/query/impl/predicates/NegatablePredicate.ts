import type { Predicate } from '../../Predicate';

/**
 * Marker interface for predicates that can negate themselves
 * (e.g. EqualPredicate → NotEqualPredicate).
 */
export interface NegatablePredicate<K = unknown, V = unknown> extends Predicate<K, V> {
  negate(): Predicate<K, V>;
}
