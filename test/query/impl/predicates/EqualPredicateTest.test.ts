import { EqualPredicate } from '@zenystx/helios-core/query/impl/predicates/EqualPredicate';
import { NotEqualPredicate } from '@zenystx/helios-core/query/impl/predicates/NotEqualPredicate';
import { describe, expect, test } from 'bun:test';
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

  test('apply_multipleCallsWithSameType_doesNotMutateOriginalValue', () => {
    // Predicate created with string value '42'; all entries are strings (homogeneous)
    // convert() returns the value unchanged when types already match
    const p = new EqualPredicate('this', '42');
    expect(p.apply(entry('42'))).toBe(true);
    expect(p.apply(entry('99'))).toBe(false);
    expect(p.apply(entry('42'))).toBe(true);
    // The key invariant: this.value must NOT have been overwritten — it stays '42' (string)
    expect((p as { value: unknown }).value).toBe('42');
  });

  test('apply_repeatedCalls_cacheConvertedValueStably', () => {
    // Entry holds number 5; predicate holds string '5'
    // convert() should coerce '5'→5 once and cache it
    const p = new EqualPredicate('this', '5');
    const e = entry(5);
    for (let i = 0; i < 5; i++) {
      expect(p.apply(e)).toBe(true);
    }
    // Original value stays '5'
    expect((p as { value: unknown }).value).toBe('5');
  });

  test('apply_nullValue_returnsTrueForNullEntry', () => {
    const p = new EqualPredicate('this', null);
    expect(p.apply(entry(null))).toBe(true);
    expect(p.apply(entry(undefined))).toBe(true);
    expect(p.apply(entry(0))).toBe(false);
  });
});
