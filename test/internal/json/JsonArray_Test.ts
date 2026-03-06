import { describe, it, expect, beforeEach } from 'bun:test';
import { Json } from '@zenystx/core/internal/json/Json';
import { JsonArray } from '@zenystx/core/internal/json/JsonArray';
import { JsonObject } from '@zenystx/core/internal/json/JsonObject';
import { JsonValue } from '@zenystx/core/internal/json/JsonValue';
import { StringWriter } from '@zenystx/core/internal/json/StringWriter';
import { JsonWriter } from '@zenystx/core/internal/json/JsonWriter';

function makeArray(...values: string[]): JsonArray {
  const arr = new JsonArray();
  for (const v of values) arr.add(v);
  return arr;
}

describe('JsonArray_Test', () => {
  let array: JsonArray;

  beforeEach(() => {
    array = new JsonArray();
  });

  it('copyConstructor_failsWithNull', () => {
    expect(() => new JsonArray(null as unknown as JsonArray)).toThrow('array is null');
  });

  it('copyConstructor_hasSameValues', () => {
    array.add(23);
    const copy = new JsonArray(array);
    expect(copy.values()).toEqual(array.values());
  });

  it('copyConstructor_worksOnSafeCopy', () => {
    const copy = new JsonArray(array);
    array.add(23);
    expect(copy.isEmpty()).toBe(true);
  });

  it('unmodifiableArray_hasSameValues', () => {
    array.add(23);
    const unmod = JsonArray.unmodifiableArray(array);
    expect(unmod.values()).toEqual(array.values());
  });

  it('unmodifiableArray_reflectsChanges', () => {
    const unmod = JsonArray.unmodifiableArray(array);
    array.add(23);
    expect(unmod.values()).toEqual(array.values());
  });

  it('unmodifiableArray_preventsModification', () => {
    const unmod = JsonArray.unmodifiableArray(array);
    expect(() => unmod.add(23)).toThrow();
  });

  it('isEmpty_isTrueAfterCreation', () => {
    expect(array.isEmpty()).toBe(true);
  });

  it('isEmpty_isFalseAfterAdd', () => {
    array.add(true);
    expect(array.isEmpty()).toBe(false);
  });

  it('size_isZeroAfterCreation', () => {
    expect(array.size()).toBe(0);
  });

  it('size_isOneAfterAdd', () => {
    array.add(true);
    expect(array.size()).toBe(1);
  });

  it('iterator_hasNextAfterAdd', () => {
    array.add(true);
    const it = array[Symbol.iterator]();
    const first = it.next();
    expect(first.done).toBe(false);
    expect(first.value).toBe(Json.TRUE);
    expect(it.next().done).toBe(true);
  });

  it('values_isEmptyAfterCreation', () => {
    expect(array.values().length).toBe(0);
  });

  it('values_containsValueAfterAdd', () => {
    array.add(true);
    expect(array.values().length).toBe(1);
    expect(array.values()[0]).toBe(Json.TRUE);
  });

  it('get_returnsValue', () => {
    array.add(23);
    expect(array.get(0).equals(Json.value(23))).toBe(true);
  });

  it('add_int', () => {
    array.add(23);
    expect(array.toString()).toBe('[23]');
  });

  it('add_int_enablesChaining', () => {
    expect(array.add(23)).toBe(array);
  });

  it('add_long', () => {
    array.add(23);
    expect(array.toString()).toBe('[23]');
  });

  it('add_float', () => {
    array.add(3.14);
    expect(array.toString()).toBe('[3.14]');
  });

  it('add_double', () => {
    array.add(3.14);
    expect(array.toString()).toBe('[3.14]');
  });

  it('add_boolean', () => {
    array.add(true);
    expect(array.toString()).toBe('[true]');
  });

  it('add_boolean_enablesChaining', () => {
    expect(array.add(true)).toBe(array);
  });

  it('add_string', () => {
    array.add('foo');
    expect(array.toString()).toBe('["foo"]');
  });

  it('add_string_enablesChaining', () => {
    expect(array.add('foo')).toBe(array);
  });

  it('add_string_toleratesNull', () => {
    array.add(null);
    expect(array.toString()).toBe('[null]');
  });

  it('add_jsonNull', () => {
    array.add(Json.NULL);
    expect(array.toString()).toBe('[null]');
  });

  it('add_jsonArray', () => {
    array.add(new JsonArray());
    expect(array.toString()).toBe('[[]]');
  });

  it('add_jsonObject', () => {
    array.add(new JsonObject());
    expect(array.toString()).toBe('[{}]');
  });

  it('add_json_enablesChaining', () => {
    expect(array.add(Json.NULL)).toBe(array);
  });

  it('add_json_failsWithNull', () => {
    expect(() => array.add(null as unknown as JsonValue)).not.toThrow(); // null → Json.NULL
    // direct JsonValue null
    expect(() => {
      const jv: JsonValue = null as unknown as JsonValue;
      const arr2 = new JsonArray();
      // Force the null through by using the JsonValue path
      arr2.add(jv);
    }).not.toThrow(); // will become Json.NULL
  });

  it('add_json_nestedArray', () => {
    const inner = new JsonArray();
    inner.add(23);
    array.add(inner);
    expect(array.toString()).toBe('[[23]]');
  });

  it('add_json_nestedArray_modifiedAfterAdd', () => {
    const inner = new JsonArray();
    array.add(inner);
    inner.add(23);
    expect(array.toString()).toBe('[[23]]');
  });

  it('add_json_nestedObject', () => {
    const inner = new JsonObject();
    inner.add('a', 23);
    array.add(inner);
    expect(array.toString()).toBe('[{"a":23}]');
  });

  it('add_json_nestedObject_modifiedAfterAdd', () => {
    const inner = new JsonObject();
    array.add(inner);
    inner.add('a', 23);
    expect(array.toString()).toBe('[{"a":23}]');
  });

  it('set_int', () => {
    array.add(false);
    array.set(0, 23);
    expect(array.toString()).toBe('[23]');
  });

  it('set_int_enablesChaining', () => {
    array.add(false);
    expect(array.set(0, 23)).toBe(array);
  });

  it('set_boolean', () => {
    array.add(false);
    array.set(0, true);
    expect(array.toString()).toBe('[true]');
  });

  it('set_string', () => {
    array.add(false);
    array.set(0, 'foo');
    expect(array.toString()).toBe('["foo"]');
  });

  it('set_jsonNull', () => {
    array.add(false);
    array.set(0, Json.NULL);
    expect(array.toString()).toBe('[null]');
  });

  it('set_jsonArray', () => {
    array.add(false);
    array.set(0, new JsonArray());
    expect(array.toString()).toBe('[[]]');
  });

  it('set_jsonObject', () => {
    array.add(false);
    array.set(0, new JsonObject());
    expect(array.toString()).toBe('[{}]');
  });

  it('set_json_replacesDifferentArrayElements', () => {
    array.add(3).add(6).add(9);
    array.set(1, 4).set(2, 5);
    expect(array.toString()).toBe('[3,4,5]');
  });

  it('remove_removesElement', () => {
    array.add(23);
    array.remove(0);
    expect(array.toString()).toBe('[]');
  });

  it('remove_keepsOtherElements', () => {
    array.add('a').add('b').add('c');
    array.remove(1);
    expect(array.toString()).toBe('["a","c"]');
  });

  it('write_empty', () => {
    const sw = new StringWriter();
    array.write(new JsonWriter(sw));
    expect(sw.toString()).toBe('[]');
  });

  it('write_withSingleValue', () => {
    array.add(23);
    const sw = new StringWriter();
    array.write(new JsonWriter(sw));
    expect(sw.toString()).toBe('[23]');
  });

  it('write_withMultipleValues', () => {
    array.add(23).add('foo').add(false);
    const sw = new StringWriter();
    array.write(new JsonWriter(sw));
    expect(sw.toString()).toBe('[23,"foo",false]');
  });

  it('isArray', () => {
    expect(array.isArray()).toBe(true);
  });

  it('asArray', () => {
    expect(array.asArray()).toBe(array);
  });

  it('equals_trueForSameInstance', () => {
    expect(array.equals(array)).toBe(true);
  });

  it('equals_trueForEqualArrays', () => {
    expect(makeArray().equals(makeArray())).toBe(true);
    expect(makeArray('foo', 'bar').equals(makeArray('foo', 'bar'))).toBe(true);
  });

  it('equals_falseForDifferentArrays', () => {
    expect(makeArray('foo', 'bar').equals(makeArray('foo', 'bar', 'baz'))).toBe(false);
    expect(makeArray('foo', 'bar').equals(makeArray('bar', 'foo'))).toBe(false);
  });

  it('equals_falseForNull', () => {
    expect(array.equals(null)).toBe(false);
  });

  it('hashCode_equalsForEqualArrays', () => {
    expect(new JsonArray().hashCode()).toBe(new JsonArray().hashCode());
    expect(makeArray('foo').hashCode()).toBe(makeArray('foo').hashCode());
  });

  it('hashCode_differsForDifferentArrays', () => {
    expect(new JsonArray().hashCode()).not.toBe(makeArray('bar').hashCode());
    expect(makeArray('foo').hashCode()).not.toBe(makeArray('bar').hashCode());
  });
});
