import { describe, test, expect } from 'bun:test';
import { BetweenPredicate } from '@helios/query/impl/predicates/BetweenPredicate';
import { entry } from './PredicateTestUtils';

describe('BetweenPredicate', () => {

  // Java issue #6188: -0.0 is NOT in range [0.0, 0.0]
  test('equal_zeroMinusZero', () => {
    expect(new BetweenPredicate('this', 0.0, 0.0).apply(entry(-0.0))).toBe(false);
    expect(new BetweenPredicate('this', 0.0, 0.0).apply(entry(-0.0))).toBe(false);
    expect(new BetweenPredicate('this', 0.0, 0.0).apply(entry(-0.0))).toBe(false);
    expect(new BetweenPredicate('this', 0.0, 0.0).apply(entry(-0.0))).toBe(false);

    // In JS, 0.0 === -0.0
  });

  // Java issue #6188: NaN BETWEEN NaN AND NaN should be TRUE
  test('equal_NaN', () => {
    expect(new BetweenPredicate('this', NaN, NaN).apply(entry(NaN))).toBe(true);
    expect(new BetweenPredicate('this', NaN, NaN).apply(entry(NaN))).toBe(true);
    expect(new BetweenPredicate('this', NaN, NaN).apply(entry(-NaN))).toBe(true);
    expect(new BetweenPredicate('this', NaN, NaN).apply(entry(-NaN))).toBe(true);
    expect(new BetweenPredicate('this', NaN, NaN).apply(entry(-NaN))).toBe(true);
    expect(new BetweenPredicate('this', NaN, NaN).apply(entry(-NaN))).toBe(true);

    // In JS: NaN !== NaN
  });
});
