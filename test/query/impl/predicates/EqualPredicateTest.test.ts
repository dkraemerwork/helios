import { describe, test, expect } from 'bun:test';
import { EqualPredicate } from '@helios/query/impl/predicates/EqualPredicate';
import { NotEqualPredicate } from '@helios/query/impl/predicates/NotEqualPredicate';
import { entry } from './PredicateTestUtils';

describe('EqualPredicate', () => {

  test('negate_thenReturnNotEqualPredicate', () => {
    const equalPredicate = new EqualPredicate('foo', 1);
    const negate = equalPredicate.negate() as NotEqualPredicate;

    expect(negate).toBeInstanceOf(NotEqualPredicate);
    expect(negate.attributeName).toBe('foo');
    expect(negate.value).toBe(1);
  });

  // Java issue #6188: 0.0 and -0.0 are treated as DIFFERENT by EqualPredicate
  // (uses Java's Double.compare semantics: compare(0.0, -0.0) != 0)
  test('equal_zeroMinusZero', () => {
    expect(new EqualPredicate('this', 0.0).apply(entry(-0.0))).toBe(false);
    expect(new EqualPredicate('this', 0.0).apply(entry(-0.0))).toBe(false);
    expect(new EqualPredicate('this', 0.0).apply(entry(-0.0))).toBe(false);
    expect(new EqualPredicate('this', 0.0).apply(entry(-0.0))).toBe(false);

    // In JS, 0.0 === -0.0 (unlike Java's Comparable-based check used by the predicate)
  });

  // Java issue #6188: NaN is treated as EQUAL to NaN in EqualPredicate
  // (uses Object.is / Double.compare semantics: compare(NaN, NaN) == 0)
  test('equal_NaN', () => {
    expect(new EqualPredicate('this', NaN).apply(entry(NaN))).toBe(true);
    expect(new EqualPredicate('this', NaN).apply(entry(NaN))).toBe(true);
    // -NaN === NaN in JS (and in Java, NaN bit patterns are normalized)
    expect(new EqualPredicate('this', NaN).apply(entry(-NaN))).toBe(true);
    expect(new EqualPredicate('this', NaN).apply(entry(-NaN))).toBe(true);
    expect(new EqualPredicate('this', NaN).apply(entry(-NaN))).toBe(true);
    expect(new EqualPredicate('this', NaN).apply(entry(-NaN))).toBe(true);

    // In JS NaN !== NaN (same as Java ==)
  });
});
