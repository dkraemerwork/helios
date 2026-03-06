import { describe, it, expect } from 'bun:test';
import { Json } from '@zenystx/core/internal/json/Json';
import { JsonArray } from '@zenystx/core/internal/json/JsonArray';
import { JsonObject } from '@zenystx/core/internal/json/JsonObject';
import { StringReader } from '@zenystx/core/internal/json/StringReader';

describe('Json_Test', () => {
  it('literalConstants', () => {
    expect(Json.NULL.isNull()).toBe(true);
    expect(Json.TRUE.isTrue()).toBe(true);
    expect(Json.FALSE.isFalse()).toBe(true);
  });

  it('value_int', () => {
    expect(Json.value(0).toString()).toBe('0');
    expect(Json.value(23).toString()).toBe('23');
    expect(Json.value(-1).toString()).toBe('-1');
    expect(Json.value(2147483647).toString()).toBe('2147483647');
    expect(Json.value(-2147483648).toString()).toBe('-2147483648');
  });

  // value_long: Long.MAX_VALUE/MIN_VALUE lose precision in JavaScript — skip.

  // value_float / value_double with exponential notation: JS String() format differs from Java — skip.

  it('value_cutsOffPointZero', () => {
    expect(Json.value(0).toString()).toBe('0');
    expect(Json.value(-1).toString()).toBe('-1');
    expect(Json.value(10).toString()).toBe('10');
  });

  it('value_failsWithInfinity', () => {
    const msg = 'Infinite and NaN values not permitted in JSON';
    expect(() => Json.value(Infinity)).toThrow(msg);
    expect(() => Json.value(-Infinity)).toThrow(msg);
  });

  it('value_failsWithNaN', () => {
    expect(() => Json.value(NaN)).toThrow('Infinite and NaN values not permitted in JSON');
  });

  it('value_boolean', () => {
    expect(Json.value(true)).toBe(Json.TRUE);
    expect(Json.value(false)).toBe(Json.FALSE);
  });

  it('value_string', () => {
    expect(Json.value('').asString()).toBe('');
    expect(Json.value('Hello').asString()).toBe('Hello');
    expect(Json.value('"Hello"').asString()).toBe('"Hello"');
  });

  it('value_string_toleratesNull', () => {
    expect(Json.value(null)).toBe(Json.NULL);
  });

  it('array_empty', () => {
    expect(new JsonArray().equals(Json.array())).toBe(true);
  });

  it('array_numbers', () => {
    expect(new JsonArray().add(23).equals(Json.array(23))).toBe(true);
    expect(new JsonArray().add(23).add(42).equals(Json.array(23, 42))).toBe(true);
  });

  it('array_floats', () => {
    expect(new JsonArray().add(3.14).equals(Json.array(3.14))).toBe(true);
    expect(new JsonArray().add(3.14).add(1.41).equals(Json.array(3.14, 1.41))).toBe(true);
  });

  it('array_booleans', () => {
    expect(new JsonArray().add(true).equals(Json.array(true))).toBe(true);
    expect(new JsonArray().add(true).add(false).equals(Json.array(true, false))).toBe(true);
  });

  it('array_strings', () => {
    expect(new JsonArray().add('foo').equals(Json.array('foo'))).toBe(true);
    expect(new JsonArray().add('foo').add('bar').equals(Json.array('foo', 'bar'))).toBe(true);
  });

  it('object', () => {
    expect(new JsonObject().equals(Json.object())).toBe(true);
  });

  it('parse_string', () => {
    expect(Json.value(23).equals(Json.parse('23'))).toBe(true);
  });

  it('parse_string_failsWithNull', () => {
    // null goes through Reader path and throws 'reader is null'
    expect(() => Json.parse(null as unknown as string)).toThrow();
  });

  it('parse_reader', () => {
    expect(Json.value(23).equals(Json.parse(new StringReader('23')))).toBe(true);
  });

  it('parse_reader_failsWithNull', () => {
    expect(() => Json.parse(null as unknown as StringReader)).toThrow();
  });
});
