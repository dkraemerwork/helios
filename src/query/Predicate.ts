import type { QueryableEntry } from './impl/QueryableEntry';

/**
 * Functional predicate interface used to filter map entries.
 * Equivalent to Java's Predicate<K, V>.
 */
export interface Predicate<K = unknown, V = unknown> {
  apply(entry: QueryableEntry<K, V>): boolean;
}
