import { describe, it, expect, beforeEach } from 'bun:test';
import { Json } from '@zenystx/core/internal/json/Json';
import { JsonArray } from '@zenystx/core/internal/json/JsonArray';
import { JsonObject } from '@zenystx/core/internal/json/JsonObject';
import { Member, HashIndexTable } from '@zenystx/core/internal/json/JsonObject';
import { JsonWriter } from '@zenystx/core/internal/json/JsonWriter';
import { StringWriter } from '@zenystx/core/internal/json/StringWriter';

function makeObject(...namesAndValues: string[]): JsonObject {
  const obj = new JsonObject();
  for (let i = 0; i < namesAndValues.length; i += 2) {
    obj.add(namesAndValues[i], namesAndValues[i + 1]);
  }
  return obj;
}

describe('JsonObject_Test', () => {
  let object: JsonObject;

  beforeEach(() => {
    object = new JsonObject();
  });

  it('copyConstructor_failsWithNull', () => {
    expect(() => new JsonObject(null as unknown as JsonObject)).toThrow('object is null');
  });

  it('copyConstructor_hasSameValues', () => {
    object.add('foo', 23);
    const copy = new JsonObject(object);
    expect(copy.names()).toEqual(object.names());
    expect(copy.get('foo')).toBe(object.get('foo'));
  });

  it('copyConstructor_worksOnSafeCopy', () => {
    const copy = new JsonObject(object);
    object.add('foo', 23);
    expect(copy.isEmpty()).toBe(true);
  });

  it('unmodifiableObject_hasSameValues', () => {
    object.add('foo', 23);
    const unmod = JsonObject.unmodifiableObject(object);
    expect(unmod.names()).toEqual(object.names());
    expect(unmod.get('foo')).toBe(object.get('foo'));
  });

  it('unmodifiableObject_reflectsChanges', () => {
    const unmod = JsonObject.unmodifiableObject(object);
    object.add('foo', 23);
    expect(unmod.names()).toEqual(object.names());
    expect(unmod.get('foo')).toBe(object.get('foo'));
  });

  it('unmodifiableObject_preventsModification', () => {
    const unmod = JsonObject.unmodifiableObject(object);
    expect(() => unmod.add('foo', 23)).toThrow();
  });

  it('isEmpty_trueAfterCreation', () => {
    expect(object.isEmpty()).toBe(true);
  });

  it('isEmpty_falseAfterAdd', () => {
    object.add('a', true);
    expect(object.isEmpty()).toBe(false);
  });

  it('size_zeroAfterCreation', () => {
    expect(object.size()).toBe(0);
  });

  it('size_oneAfterAdd', () => {
    object.add('a', true);
    expect(object.size()).toBe(1);
  });

  it('keyRepetition_allowsMultipleEntries', () => {
    object.add('a', true);
    object.add('a', 'value');
    expect(object.size()).toBe(2);
  });

  it('keyRepetition_getsLastEntry', () => {
    object.add('a', true);
    object.add('a', 'value');
    expect(object.getString('a', 'missing')).toBe('value');
  });

  it('keyRepetition_equalityConsidersRepetitions', () => {
    object.add('a', true);
    object.add('a', 'value');

    const onlyFirst = new JsonObject().add('a', true);
    expect(object.equals(onlyFirst)).toBe(false);

    const both = new JsonObject().add('a', true).add('a', 'value');
    expect(object.equals(both)).toBe(true);
  });

  it('names_emptyAfterCreation', () => {
    expect(object.names().length).toBe(0);
  });

  it('names_containsNameAfterAdd', () => {
    object.add('foo', true);
    const ns = object.names();
    expect(ns.length).toBe(1);
    expect(ns[0]).toBe('foo');
  });

  // names_reflectsChanges: TypeScript names() returns a snapshot copy, not a live view — skip.
  // names_preventsModification: returned copy is mutable in TypeScript — skip.

  it('iterator_isEmptyAfterCreation', () => {
    expect(object[Symbol.iterator]().next().done).toBe(true);
  });

  it('iterator_hasNextAfterAdd', () => {
    object.add('a', true);
    expect(object[Symbol.iterator]().next().done).toBe(false);
  });

  it('iterator_nextReturnsActualValue', () => {
    object.add('a', true);
    const result = object[Symbol.iterator]().next();
    expect(result.done).toBe(false);
    expect(result.value.getName()).toBe('a');
    expect(result.value.getValue()).toBe(Json.TRUE);
  });

  it('iterator_nextProgressesToNextValue', () => {
    object.add('a', true);
    object.add('b', false);
    const it = object[Symbol.iterator]();
    it.next();
    const result = it.next();
    expect(result.done).toBe(false);
    expect(result.value.getName()).toBe('b');
    expect(result.value.getValue()).toBe(Json.FALSE);
  });

  // iterator_nextFailsAtEnd: TypeScript iterators return {done:true} rather than throwing — skip.
  // iterator_doesNotAllowModification: no iterator.remove() in TypeScript — skip.
  // iterator_detectsConcurrentModification: no ConcurrentModificationException in TypeScript — skip.

  it('get_failsWithNullName', () => {
    expect(() => object.get(null as unknown as string)).toThrow('name is null');
  });

  it('get_returnsNullForNonExistingMember', () => {
    expect(object.get('foo')).toBeNull();
  });

  it('get_returnsValueForName', () => {
    object.add('foo', true);
    expect(object.get('foo')).toBe(Json.TRUE);
  });

  it('get_returnsLastValueForName', () => {
    object.add('foo', false).add('foo', true);
    expect(object.get('foo')).toBe(Json.TRUE);
  });

  it('get_int_returnsValueFromMember', () => {
    object.add('foo', 23);
    expect(object.getInt('foo', 42)).toBe(23);
  });

  it('get_int_returnsDefaultForMissingMember', () => {
    expect(object.getInt('foo', 23)).toBe(23);
  });

  it('get_long_returnsValueFromMember', () => {
    object.add('foo', 23);
    expect(object.getLong('foo', 42)).toBe(23);
  });

  it('get_long_returnsDefaultForMissingMember', () => {
    expect(object.getLong('foo', 23)).toBe(23);
  });

  it('get_float_returnsValueFromMember', () => {
    object.add('foo', 3.14);
    expect(object.getFloat('foo', 1.41)).toBeCloseTo(3.14);
  });

  it('get_float_returnsDefaultForMissingMember', () => {
    expect(object.getFloat('foo', 3.14)).toBeCloseTo(3.14);
  });

  it('get_double_returnsValueFromMember', () => {
    object.add('foo', 3.14);
    expect(object.getDouble('foo', 1.41)).toBeCloseTo(3.14);
  });

  it('get_double_returnsDefaultForMissingMember', () => {
    expect(object.getDouble('foo', 3.14)).toBeCloseTo(3.14);
  });

  it('get_boolean_returnsValueFromMember', () => {
    object.add('foo', true);
    expect(object.getBoolean('foo', false)).toBe(true);
  });

  it('get_boolean_returnsDefaultForMissingMember', () => {
    expect(object.getBoolean('foo', false)).toBe(false);
  });

  it('get_string_returnsValueFromMember', () => {
    object.add('foo', 'bar');
    expect(object.getString('foo', 'default')).toBe('bar');
  });

  it('get_string_returnsDefaultForMissingMember', () => {
    expect(object.getString('foo', 'default')).toBe('default');
  });

  it('add_failsWithNullName', () => {
    expect(() => object.add(null as unknown as string, 23)).toThrow('name is null');
  });

  it('add_int', () => {
    object.add('a', 23);
    expect(object.toString()).toBe('{"a":23}');
  });

  it('add_int_enablesChaining', () => {
    expect(object.add('a', 23)).toBe(object);
  });

  it('add_long', () => {
    object.add('a', 23);
    expect(object.toString()).toBe('{"a":23}');
  });

  it('add_float', () => {
    object.add('a', 3.14);
    expect(object.toString()).toBe('{"a":3.14}');
  });

  it('add_double', () => {
    object.add('a', 3.14);
    expect(object.toString()).toBe('{"a":3.14}');
  });

  it('add_boolean', () => {
    object.add('a', true);
    expect(object.toString()).toBe('{"a":true}');
  });

  it('add_boolean_enablesChaining', () => {
    expect(object.add('a', true)).toBe(object);
  });

  it('add_string', () => {
    object.add('a', 'foo');
    expect(object.toString()).toBe('{"a":"foo"}');
  });

  it('add_string_toleratesNull', () => {
    object.add('a', null as unknown as string);
    expect(object.toString()).toBe('{"a":null}');
  });

  it('add_string_enablesChaining', () => {
    expect(object.add('a', 'foo')).toBe(object);
  });

  it('add_jsonNull', () => {
    object.add('a', Json.NULL);
    expect(object.toString()).toBe('{"a":null}');
  });

  it('add_jsonArray', () => {
    object.add('a', new JsonArray());
    expect(object.toString()).toBe('{"a":[]}');
  });

  it('add_jsonObject', () => {
    object.add('a', new JsonObject());
    expect(object.toString()).toBe('{"a":{}}');
  });

  it('add_json_enablesChaining', () => {
    expect(object.add('a', Json.NULL)).toBe(object);
  });

  it('add_json_nestedArray', () => {
    const inner = new JsonArray();
    inner.add(23);
    object.add('a', inner);
    expect(object.toString()).toBe('{"a":[23]}');
  });

  it('add_json_nestedArray_modifiedAfterAdd', () => {
    const inner = new JsonArray();
    object.add('a', inner);
    inner.add(23);
    expect(object.toString()).toBe('{"a":[23]}');
  });

  it('add_json_nestedObject', () => {
    const inner = new JsonObject();
    inner.add('a', 23);
    object.add('a', inner);
    expect(object.toString()).toBe('{"a":{"a":23}}');
  });

  it('add_json_nestedObject_modifiedAfterAdd', () => {
    const inner = new JsonObject();
    object.add('a', inner);
    inner.add('a', 23);
    expect(object.toString()).toBe('{"a":{"a":23}}');
  });

  it('set_int', () => {
    object.set('a', 23);
    expect(object.toString()).toBe('{"a":23}');
  });

  it('set_int_enablesChaining', () => {
    expect(object.set('a', 23)).toBe(object);
  });

  it('set_long', () => {
    object.set('a', 23);
    expect(object.toString()).toBe('{"a":23}');
  });

  it('set_float', () => {
    object.set('a', 3.14);
    expect(object.toString()).toBe('{"a":3.14}');
  });

  it('set_double', () => {
    object.set('a', 3.14);
    expect(object.toString()).toBe('{"a":3.14}');
  });

  it('set_boolean', () => {
    object.set('a', true);
    expect(object.toString()).toBe('{"a":true}');
  });

  it('set_boolean_enablesChaining', () => {
    expect(object.set('a', true)).toBe(object);
  });

  it('set_string', () => {
    object.set('a', 'foo');
    expect(object.toString()).toBe('{"a":"foo"}');
  });

  it('set_string_enablesChaining', () => {
    expect(object.set('a', 'foo')).toBe(object);
  });

  it('set_jsonNull', () => {
    object.set('a', Json.NULL);
    expect(object.toString()).toBe('{"a":null}');
  });

  it('set_jsonArray', () => {
    object.set('a', new JsonArray());
    expect(object.toString()).toBe('{"a":[]}');
  });

  it('set_jsonObject', () => {
    object.set('a', new JsonObject());
    expect(object.toString()).toBe('{"a":{}}');
  });

  it('set_json_enablesChaining', () => {
    expect(object.set('a', Json.NULL)).toBe(object);
  });

  it('set_addsElementIfMissing', () => {
    object.set('a', Json.TRUE);
    expect(object.toString()).toBe('{"a":true}');
  });

  it('set_modifiesElementIfExisting', () => {
    object.add('a', Json.TRUE);
    object.set('a', Json.FALSE);
    expect(object.toString()).toBe('{"a":false}');
  });

  it('set_modifiesLastElementIfMultipleExisting', () => {
    object.add('a', 1);
    object.add('a', 2);
    object.set('a', Json.TRUE);
    expect(object.toString()).toBe('{"a":1,"a":true}');
  });

  it('remove_failsWithNullName', () => {
    expect(() => object.remove(null as unknown as string)).toThrow('name is null');
  });

  it('remove_removesMatchingMember', () => {
    object.add('a', 23);
    object.remove('a');
    expect(object.toString()).toBe('{}');
  });

  it('remove_removesOnlyMatchingMember', () => {
    object.add('a', 23).add('b', 42).add('c', true);
    object.remove('b');
    expect(object.toString()).toBe('{"a":23,"c":true}');
  });

  it('remove_removesOnlyLastMatchingMember', () => {
    object.add('a', 23).add('a', 42);
    object.remove('a');
    expect(object.toString()).toBe('{"a":23}');
  });

  it('remove_removesOnlyLastMatchingMember_afterRemove', () => {
    object.add('a', 23);
    object.remove('a');
    object.add('a', 42).add('a', 47);
    object.remove('a');
    expect(object.toString()).toBe('{"a":42}');
  });

  it('remove_doesNotModifyObjectWithoutMatchingMember', () => {
    object.add('a', 23);
    object.remove('b');
    expect(object.toString()).toBe('{"a":23}');
  });

  it('merge_failsWithNull', () => {
    expect(() => object.merge(null as unknown as JsonObject)).toThrow('object is null');
  });

  it('merge_appendsMembers', () => {
    object.add('a', 1).add('b', 1);
    object.merge(Json.object().add('c', 2).add('d', 2));
    expect(object.equals(Json.object().add('a', 1).add('b', 1).add('c', 2).add('d', 2))).toBe(true);
  });

  it('merge_replacesMembers', () => {
    object.add('a', 1).add('b', 1).add('c', 1);
    object.merge(Json.object().add('b', 2).add('d', 2));
    expect(object.equals(Json.object().add('a', 1).add('b', 2).add('c', 1).add('d', 2))).toBe(true);
  });

  it('write_empty', () => {
    const sw = new StringWriter();
    object.write(new JsonWriter(sw));
    expect(sw.toString()).toBe('{}');
  });

  it('write_withSingleValue', () => {
    object.add('a', 23);
    const sw = new StringWriter();
    object.write(new JsonWriter(sw));
    expect(sw.toString()).toBe('{"a":23}');
  });

  it('write_withMultipleValues', () => {
    object.add('a', 23).add('b', 3.14).add('c', 'foo').add('d', true).add('e', null as unknown as string);
    const sw = new StringWriter();
    object.write(new JsonWriter(sw));
    expect(sw.toString()).toBe('{"a":23,"b":3.14,"c":"foo","d":true,"e":null}');
  });

  it('isObject', () => {
    expect(object.isObject()).toBe(true);
  });

  it('asObject', () => {
    expect(object.asObject()).toBe(object);
  });

  it('equals_trueForSameInstance', () => {
    expect(object.equals(object)).toBe(true);
  });

  it('equals_trueForEqualObjects', () => {
    expect(makeObject().equals(makeObject())).toBe(true);
    expect(makeObject('a', '1', 'b', '2').equals(makeObject('a', '1', 'b', '2'))).toBe(true);
  });

  it('equals_falseForDifferentObjects', () => {
    expect(makeObject('a', '1').equals(makeObject('a', '2'))).toBe(false);
    expect(makeObject('a', '1').equals(makeObject('b', '1'))).toBe(false);
    expect(makeObject('a', '1', 'b', '2').equals(makeObject('b', '2', 'a', '1'))).toBe(false);
  });

  it('equals_falseForNull', () => {
    expect(object.equals(null)).toBe(false);
  });

  it('hashCode_equalsForEqualObjects', () => {
    expect(makeObject().hashCode()).toBe(makeObject().hashCode());
    expect(makeObject('a', '1').hashCode()).toBe(makeObject('a', '1').hashCode());
  });

  it('hashCode_differsForDifferentObjects', () => {
    expect(makeObject().hashCode()).not.toBe(makeObject('a', '1').hashCode());
    expect(makeObject('a', '1').hashCode()).not.toBe(makeObject('a', '2').hashCode());
    expect(makeObject('a', '1').hashCode()).not.toBe(makeObject('b', '1').hashCode());
  });

  it('indexOf_returnsNoIndexIfEmpty', () => {
    expect(object.indexOf('a')).toBe(-1);
  });

  it('indexOf_returnsIndexOfMember', () => {
    object.add('a', true);
    expect(object.indexOf('a')).toBe(0);
  });

  it('indexOf_returnsIndexOfLastMember', () => {
    object.add('a', true);
    object.add('a', true);
    expect(object.indexOf('a')).toBe(1);
  });

  it('indexOf_returnsIndexOfLastMember_afterRemove', () => {
    object.add('a', true);
    object.add('a', true);
    object.remove('a');
    expect(object.indexOf('a')).toBe(0);
  });

  it('indexOf_returnsUpdatedIndexAfterRemove', () => {
    object.add('a', true);
    object.add('b', true);
    object.remove('a');
    expect(object.indexOf('b')).toBe(0);
  });

  it('indexOf_returnsIndexOfLastMember_forBigObject', () => {
    object.add('a', true);
    for (let i = 0; i < 256; i++) {
      object.add('x-' + i, 0);
    }
    object.add('a', true);
    expect(object.indexOf('a')).toBe(257);
  });

  it('hashIndexTable_copyConstructor', () => {
    const original = new HashIndexTable();
    original.add('name', 23);
    const copy = new HashIndexTable(original);
    expect(copy.get('name')).toBe(23);
  });

  it('hashIndexTable_add', () => {
    const tbl = new HashIndexTable();
    tbl.add('name-0', 0);
    tbl.add('name-1', 1);
    tbl.add('name-fe', 0xfe);
    tbl.add('name-ff', 0xff);
    expect(tbl.get('name-0')).toBe(0);
    expect(tbl.get('name-1')).toBe(1);
    expect(tbl.get('name-fe')).toBe(0xfe);
    expect(tbl.get('name-ff')).toBe(-1);
  });

  it('hashIndexTable_add_overwritesPreviousValue', () => {
    const tbl = new HashIndexTable();
    tbl.add('name', 23);
    tbl.add('name', 42);
    expect(tbl.get('name')).toBe(42);
  });

  it('hashIndexTable_add_clearsPreviousValueIfIndexExceeds0xff', () => {
    const tbl = new HashIndexTable();
    tbl.add('name', 23);
    tbl.add('name', 300);
    expect(tbl.get('name')).toBe(-1);
  });

  it('hashIndexTable_remove', () => {
    const tbl = new HashIndexTable();
    tbl.add('name', 23);
    tbl.remove(23);
    expect(tbl.get('name')).toBe(-1);
  });

  it('hashIndexTable_remove_updatesSubsequentElements', () => {
    const tbl = new HashIndexTable();
    tbl.add('foo', 23);
    tbl.add('bar', 42);
    tbl.remove(23);
    expect(tbl.get('bar')).toBe(41);
  });

  it('hashIndexTable_remove_doesNotChangePrecedingElements', () => {
    const tbl = new HashIndexTable();
    tbl.add('foo', 23);
    tbl.add('bar', 42);
    tbl.remove(42);
    expect(tbl.get('foo')).toBe(23);
  });

  it('member_returnsNameAndValue', () => {
    const m = new Member('a', Json.TRUE);
    expect(m.getName()).toBe('a');
    expect(m.getValue()).toBe(Json.TRUE);
  });

  it('member_equals_trueForSameInstance', () => {
    const m = new Member('a', Json.TRUE);
    expect(m.equals(m)).toBe(true);
  });

  it('member_equals_trueForEqualObjects', () => {
    const m = new Member('a', Json.TRUE);
    expect(m.equals(new Member('a', Json.TRUE))).toBe(true);
  });

  it('member_equals_falseForDifferingObjects', () => {
    const m = new Member('a', Json.TRUE);
    expect(m.equals(new Member('b', Json.TRUE))).toBe(false);
    expect(m.equals(new Member('a', Json.FALSE))).toBe(false);
  });

  it('member_equals_falseForNull', () => {
    const m = new Member('a', Json.TRUE);
    expect(m.equals(null)).toBe(false);
  });

  it('member_hashCode_equalsForEqualObjects', () => {
    const m = new Member('a', Json.TRUE);
    expect(m.hashCode()).toBe(new Member('a', Json.TRUE).hashCode());
  });

  it('member_hashCode_differsForDifferingObjects', () => {
    const m = new Member('a', Json.TRUE);
    expect(m.hashCode()).not.toBe(new Member('b', Json.TRUE).hashCode());
    expect(m.hashCode()).not.toBe(new Member('a', Json.FALSE).hashCode());
  });
});
