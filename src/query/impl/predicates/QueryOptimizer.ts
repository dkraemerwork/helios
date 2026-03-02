import type { Predicate } from '../../Predicate';
import type { IndexRegistry } from '../IndexRegistry';

/**
 * Optimizes a predicate using available indexes.
 * Equivalent to Java's QueryOptimizer.
 */
export interface QueryOptimizer {
  optimize<K, V>(predicate: Predicate<K, V>, indexes: IndexRegistry): Predicate<K, V>;
}
