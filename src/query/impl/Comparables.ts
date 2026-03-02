/**
 * Utilities for comparing values with the same semantics as Java's
 * Comparables + Numbers utility classes.
 *
 * Key invariants (matching Java's Double.compare / Double.equals):
 *   - NaN equals NaN (Object.is(NaN, NaN) === true)
 *   - -0 does NOT equal 0 (Object.is(-0, 0) === false)
 *   - NaN is greater than any other number (including Infinity)
 *   - -0 is less than 0
 */
export class Comparables {

  /**
   * Checks two values for equality using Java's Comparable equality semantics.
   * - For numbers: uses Object.is (NaN==NaN, -0!==0).
   * - For other types: uses strict equality.
   */
  static equal(lhs: unknown, rhs: unknown): boolean {
    if (rhs === null || rhs === undefined) return false;
    if (typeof lhs === 'number' && typeof rhs === 'number') {
      return Object.is(lhs, rhs);
    }
    return lhs === rhs;
  }

  /**
   * Compares two values with Java's Comparable ordering semantics.
   * - For numbers: NaN is greatest; -0 is less than 0.
   * - For strings: lexicographic order.
   * Returns negative, zero, or positive.
   */
  static compare(lhs: unknown, rhs: unknown): number {
    if (typeof lhs === 'number' && typeof rhs === 'number') {
      return Comparables._compareNumbers(lhs, rhs);
    }
    if (typeof lhs === 'string' && typeof rhs === 'string') {
      return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
    }
    // Fallback: attempt generic ordering
    if ((lhs as number) < (rhs as number)) return -1;
    if ((lhs as number) > (rhs as number)) return 1;
    return 0;
  }

  private static _compareNumbers(a: number, b: number): number {
    if (Object.is(a, b)) return 0;
    if (isNaN(a)) return 1;   // NaN is greatest
    if (isNaN(b)) return -1;  // b is NaN → a is less
    if (Object.is(a, -0)) return -1;  // -0 < 0
    if (Object.is(b, -0)) return 1;   // 0 > -0
    return a < b ? -1 : 1;
  }

  /**
   * Canonicalizes a value for hash-based lookup.
   * For numbers, this is a no-op because our lookup uses Object.is directly.
   * Returns the value unchanged.
   */
  static canonicalizeForHashLookup(value: unknown): unknown {
    return value;
  }
}
