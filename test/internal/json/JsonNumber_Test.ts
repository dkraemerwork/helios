import { describe, it, expect, beforeEach } from 'bun:test';
import { JsonNumber } from '@helios/internal/json/JsonNumber';
import { JsonWriter } from '@helios/internal/json/JsonWriter';
import { StringWriter } from '@helios/internal/json/StringWriter';

describe('JsonNumber_Test', () => {
  let output: StringWriter;
  let writer: JsonWriter;

  beforeEach(() => {
    output = new StringWriter();
    writer = new JsonWriter(output);
  });

  it('constructor_failsWithNull', () => {
    expect(() => new JsonNumber(null as unknown as string)).toThrow('string is null');
  });

  it('write', () => {
    new JsonNumber('23').write(writer);
    expect(output.toString()).toBe('23');
  });

  it('toString_returnsInputString', () => {
    expect(new JsonNumber('foo').toString()).toBe('foo');
  });

  it('isNumber', () => {
    expect(new JsonNumber('23').isNumber()).toBe(true);
  });

  it('asInt', () => {
    expect(new JsonNumber('23').asInt()).toBe(23);
  });

  it('asInt_failsWithExceedingValues', () => {
    expect(() => new JsonNumber('10000000000').asInt()).toThrow();
  });

  it('asInt_failsWithExponent', () => {
    expect(() => new JsonNumber('1e5').asInt()).toThrow();
  });

  it('asInt_failsWithFractional', () => {
    expect(() => new JsonNumber('23.5').asInt()).toThrow();
  });

  it('asLong', () => {
    expect(new JsonNumber('23').asLong()).toBe(23);
  });

  it('asLong_failsWithExponent', () => {
    expect(() => new JsonNumber('1e5').asLong()).toThrow();
  });

  it('asLong_failsWithFractional', () => {
    expect(() => new JsonNumber('23.5').asLong()).toThrow();
  });

  it('asFloat', () => {
    expect(new JsonNumber('23.05').asFloat()).toBeCloseTo(23.05);
  });

  it('asFloat_returnsInfinityForExceedingValues', () => {
    expect(new JsonNumber('1e50').asFloat()).toBe(Infinity);
    expect(new JsonNumber('-1e50').asFloat()).toBe(-Infinity);
  });

  it('asDouble', () => {
    expect(new JsonNumber('23.05').asDouble()).toBeCloseTo(23.05);
  });

  it('asDouble_returnsInfinityForExceedingValues', () => {
    expect(new JsonNumber('1e500').asDouble()).toBe(Infinity);
    expect(new JsonNumber('-1e500').asDouble()).toBe(-Infinity);
  });

  it('equals_trueForSameInstance', () => {
    const number = new JsonNumber('23');
    expect(number.equals(number)).toBe(true);
  });

  it('equals_trueForEqualNumberStrings', () => {
    expect(new JsonNumber('23').equals(new JsonNumber('23'))).toBe(true);
  });

  it('equals_falseForDifferentNumberStrings', () => {
    expect(new JsonNumber('23').equals(new JsonNumber('42'))).toBe(false);
    expect(new JsonNumber('1e+5').equals(new JsonNumber('1e5'))).toBe(false);
  });

  it('equals_falseForNull', () => {
    expect(new JsonNumber('23').equals(null)).toBe(false);
  });

  it('hashCode_equalsForEqualStrings', () => {
    expect(new JsonNumber('23').hashCode()).toBe(new JsonNumber('23').hashCode());
  });

  it('hashCode_differsForDifferentStrings', () => {
    expect(new JsonNumber('23').hashCode()).not.toBe(new JsonNumber('42').hashCode());
  });
});
