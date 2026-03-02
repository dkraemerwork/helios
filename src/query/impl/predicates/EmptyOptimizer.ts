import type { Predicate } from '../../Predicate';
import type { IndexRegistry } from '../IndexRegistry';
import type { QueryOptimizer } from './QueryOptimizer';

/**
 * Optimizer that returns the original predicate unchanged.
 * Used when the optimizer is disabled.
 * Equivalent to Java's EmptyOptimizer.
 */
export class EmptyOptimizer implements QueryOptimizer {
  optimize<K, V>(predicate: Predicate<K, V>, _indexes: IndexRegistry): Predicate<K, V> {
    return predicate;
  }
}
