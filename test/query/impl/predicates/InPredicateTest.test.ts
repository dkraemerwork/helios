import { describe, test, expect } from 'bun:test';
import { InPredicate } from '@zenystx/helios-core/query/impl/predicates/InPredicate';
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

  test('in_stringValues_basicMatch', () => {
    const p = new InPredicate('this', 'alice', 'bob', 'charlie');
    expect(p.apply(entry('alice'))).toBe(true);
    expect(p.apply(entry('bob'))).toBe(true);
    expect(p.apply(entry('dave'))).toBe(false);
  });

  test('in_numericValues_basicMatch', () => {
    const p = new InPredicate('this', 1, 2, 3, 100, 200);
    expect(p.apply(entry(1))).toBe(true);
    expect(p.apply(entry(100))).toBe(true);
    expect(p.apply(entry(4))).toBe(false);
  });

  test('in_withNull_nullEntryMatches', () => {
    const p = new InPredicate('this', 1, null, 3);
    expect(p.apply(entry(null))).toBe(true);
    expect(p.apply(entry(undefined))).toBe(true);
    expect(p.apply(entry(2))).toBe(false);
  });

  test('in_withoutNull_nullEntryDoesNotMatch', () => {
    const p = new InPredicate('this', 1, 2, 3);
    expect(p.apply(entry(null))).toBe(false);
  });

  test('in_negativeZeroDistinctFromZero', () => {
    // -0 IN (0) → false (Object.is semantics)
    expect(new InPredicate('this', 0).apply(entry(-0))).toBe(false);
    // 0 IN (-0) → false
    expect(new InPredicate('this', -0).apply(entry(0))).toBe(false);
    // -0 IN (-0) → true
    expect(new InPredicate('this', -0).apply(entry(-0))).toBe(true);
    // 0 IN (0) → true
    expect(new InPredicate('this', 0).apply(entry(0))).toBe(true);
  });

  test('in_NaN_matchesNaN', () => {
    expect(new InPredicate('this', NaN).apply(entry(NaN))).toBe(true);
    expect(new InPredicate('this', NaN).apply(entry(-NaN))).toBe(true);
    expect(new InPredicate('this', 1, 2, NaN).apply(entry(NaN))).toBe(true);
    expect(new InPredicate('this', 1, 2, 3).apply(entry(NaN))).toBe(false);
  });

  test('in_largeValueSet_O1Lookup', () => {
    const values = Array.from({ length: 1000 }, (_, i) => i);
    const p = new InPredicate('this', ...values);
    expect(p.apply(entry(500))).toBe(true);
    expect(p.apply(entry(999))).toBe(true);
    expect(p.apply(entry(1000))).toBe(false);
    for (let i = 0; i < 100; i++) {
      expect(p.apply(entry(i))).toBe(true);
    }
  });

  test('in_repeatedApply_lookupBuiltOnce', () => {
    const p = new InPredicate('this', 'x', 'y', 'z');
    for (let i = 0; i < 20; i++) {
      expect(p.apply(entry('x'))).toBe(true);
      expect(p.apply(entry('w'))).toBe(false);
    }
  });
});
