import { describe, test, expect } from 'bun:test';
import { NotEqualPredicate } from '@helios/query/impl/predicates/NotEqualPredicate';
import { EqualPredicate } from '@helios/query/impl/predicates/EqualPredicate';
import type { QueryableEntry } from '@helios/query/impl/QueryableEntry';

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
});
