import { describe, test, expect } from 'bun:test';
import { NotEqualPredicate } from '@zenystx/helios-core/query/impl/predicates/NotEqualPredicate';
import { EqualPredicate } from '@zenystx/helios-core/query/impl/predicates/EqualPredicate';
import type { QueryableEntry } from '@zenystx/helios-core/query/impl/QueryableEntry';
import { entry } from './PredicateTestUtils';

/** Simple mock entry returning a specific attribute value. */
function mockEntry(attributeValue: unknown): QueryableEntry {
  return {
    getKey: () => 'key',
    getValue: () => attributeValue,
    getAttributeValue: (_attr: string) => attributeValue,
  };
}

describe('NotEqualPredicate', () => {

  test('negate_thenReturnEqualPredicate', () => {
    const predicate = new NotEqualPredicate('foo', 1);
    const negate = predicate.negate() as EqualPredicate;

    expect(negate).toBeInstanceOf(EqualPredicate);
    expect(negate.attributeName).toBe('foo');
    expect(negate.value).toBe(1);
  });

  test('hasDefaultConstructor', () => {
    // Required for serialization — must not throw
    const p = new NotEqualPredicate();
    expect(p).toBeInstanceOf(NotEqualPredicate);
  });

  test('apply_givenAttributeValueIsNull_whenEntryHasTheAttributeNull_thenReturnFalse', () => {
    const predicate = new NotEqualPredicate('name', null);
    const result = predicate.apply(mockEntry(null));
    expect(result).toBe(false);
  });

  test('apply_givenAttributeValueIsNull_whenEntryHasTheAttributeIsNotNull_thenReturnTrue', () => {
    const predicate = new NotEqualPredicate('name', null);
    const result = predicate.apply(mockEntry('foo'));
    expect(result).toBe(true);
  });

  test('apply_givenAttributeValueIsFoo_whenEntryHasEqualAttribute_thenReturnFalse', () => {
    const predicate = new NotEqualPredicate('name', 'foo');
    const result = predicate.apply(mockEntry('foo'));
    expect(result).toBe(false);
  });

  test('toString_containsAttributeName', () => {
    const fieldName = 'name';
    const predicate = new NotEqualPredicate(fieldName, 'foo');
    expect(predicate.toString()).toContain(fieldName);
  });

  test('getId_isConstant', () => {
    const predicate = new NotEqualPredicate('bar', 'foo');
    expect(predicate.getClassId()).toBe(9);
  });

  test('apply_multipleCallsWithSameType_doesNotMutateOriginalValue', () => {
    // Predicate created with string value '42'; all entries are strings (homogeneous)
    // convert() returns the value unchanged when types already match
    const p = new NotEqualPredicate('this', '42');
    expect(p.apply(entry('42'))).toBe(false);  // equal → not unequal
    expect(p.apply(entry('99'))).toBe(true);   // not equal → unequal
    expect(p.apply(entry('42'))).toBe(false);  // equal again
    // The key invariant: this.value must NOT have been overwritten — it stays '42' (string)
    expect((p as { value: unknown }).value).toBe('42');
  });

  test('apply_repeatedCalls_cacheConvertedValueStably', () => {
    const p = new NotEqualPredicate('this', '5');
    const e = entry(10);
    for (let i = 0; i < 5; i++) {
      expect(p.apply(e)).toBe(true);
    }
    expect((p as { value: unknown }).value).toBe('5');
  });

  test('apply_nullValue_notEqualToNonNull', () => {
    const p = new NotEqualPredicate('this', null);
    expect(p.apply(entry(0))).toBe(true);
    expect(p.apply(entry(''))).toBe(true);
    expect(p.apply(entry(null))).toBe(false);
  });
});
