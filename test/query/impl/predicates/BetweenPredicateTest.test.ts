import { describe, test, expect } from 'bun:test';
import { BetweenPredicate } from '@helios/query/impl/predicates/BetweenPredicate';
import type { QueryableEntry } from '@helios/query/impl/QueryableEntry';
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

  test('apply_undefinedAttributeValue_treatedAsNull', () => {
    // When getAttributeValue() returns undefined, it should be treated the same as null
    // BetweenPredicate returns false for null attribute values
    const e: QueryableEntry<unknown, unknown> = {
      getKey: () => 'k',
      getValue: () => ({}),
      getAttributeValue: (_attr: string) => undefined,
    };
    const p = new BetweenPredicate('anyAttr', 1, 10);
    expect(p.apply(e)).toBe(false);
  });

  test('apply_nullAttributeValue_returnsFalse', () => {
    const e: QueryableEntry<unknown, unknown> = {
      getKey: () => 'k',
      getValue: () => ({}),
      getAttributeValue: (_attr: string) => null,
    };
    const p = new BetweenPredicate('anyAttr', 1, 10);
    expect(p.apply(e)).toBe(false);
  });

  test('apply_validAttributeValue_matchesBetweenRange', () => {
    // Ensure the inline path works correctly for normal values
    const e: QueryableEntry<unknown, unknown> = {
      getKey: () => 'k',
      getValue: () => ({}),
      getAttributeValue: (_attr: string) => 5,
    };
    expect(new BetweenPredicate('anyAttr', 1, 10).apply(e)).toBe(true);
    expect(new BetweenPredicate('anyAttr', 6, 10).apply(e)).toBe(false);
  });
});
