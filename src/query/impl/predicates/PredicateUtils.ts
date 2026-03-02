/** Sentinel null-like value used by indexes (mirrors Java's AbstractIndex.NULL). */
export const NULL_VALUE: unique symbol = Symbol('NULL');

/**
 * Returns true if the value is considered null-like by predicates and indexes.
 */
export function isNull(value: unknown): boolean {
  return value === null || value === undefined || (value as symbol) === NULL_VALUE;
}
