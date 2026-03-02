import type { Predicate } from '../../Predicate';
import type { IndexRegistry } from '../IndexRegistry';
import type { Visitor } from './Visitor';

/**
 * Interface for predicates that support the visitor pattern.
 * Predicates implementing this are treated as effectively immutable.
 */
export interface VisitablePredicate<K = unknown, V = unknown> extends Predicate<K, V> {
  accept(visitor: Visitor, indexes: IndexRegistry): Predicate<K, V>;
}
