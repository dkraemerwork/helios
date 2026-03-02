import { describe, test, expect } from 'bun:test';
import { InPredicate } from '@helios/query/impl/predicates/InPredicate';
import { entry } from './PredicateTestUtils';

describe('InPredicate', () => {

  // Java issue #6188: -0.0 IN (0.0) should be FALSE
  test('equal_zeroMinusZero', () => {
    expect(new InPredicate('this', 0.0).apply(entry(-0.0))).toBe(false);
    expect(new InPredicate('this', 0.0).apply(entry(-0.0))).toBe(false);
    expect(new InPredicate('this', 0.0).apply(entry(-0.0))).toBe(false);
    expect(new InPredicate('this', 0.0).apply(entry(-0.0))).toBe(false);

    // In JS, 0.0 === -0.0
  });

  // Java issue #6188: NaN IN (NaN) should be TRUE
  test('equal_NaN', () => {
    expect(new InPredicate('this', NaN).apply(entry(NaN))).toBe(true);
    expect(new InPredicate('this', NaN).apply(entry(NaN))).toBe(true);
    expect(new InPredicate('this', NaN).apply(entry(-NaN))).toBe(true);
    expect(new InPredicate('this', NaN).apply(entry(-NaN))).toBe(true);
    expect(new InPredicate('this', NaN).apply(entry(-NaN))).toBe(true);
    expect(new InPredicate('this', NaN).apply(entry(-NaN))).toBe(true);

    // In JS: NaN !== NaN
  });
});
