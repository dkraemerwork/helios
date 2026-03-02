import type { Predicate } from '../../Predicate';

/**
 * Interface for predicates operating on an array of sub-predicates.
 * Implementations must include a no-args constructor.
 */
export interface CompoundPredicate<K = unknown, V = unknown> {
  getPredicates(): Predicate<K, V>[];
  /**
   * Set sub-predicates. Throws IllegalStateException if already set
   * (for VisitablePredicate implementations).
   */
  setPredicates(predicates: Predicate<K, V>[]): void;
}
