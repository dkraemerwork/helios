import { JsonString } from '@zenystx/helios-core/internal/json/JsonString';
import { JsonWriter } from '@zenystx/helios-core/internal/json/JsonWriter';
import { StringWriter } from '@zenystx/helios-core/internal/json/StringWriter';
import { beforeEach, describe, expect, it } from 'bun:test';

describe('JsonString_Test', () => {
  let output: StringWriter;
  let writer: JsonWriter;

  beforeEach(() => {
    output = new StringWriter();
    writer = new JsonWriter(output);
  });

  it('constructor_failsWithNull', () => {
    expect(() => new JsonString(null as unknown as string)).toThrow('string is null');
  });

  it('write', () => {
    new JsonString('foo').write(writer);
    expect(output.toString()).toBe('"foo"');
  });

  it('write_escapesStrings', () => {
    new JsonString('foo\\bar').write(writer);
    expect(output.toString()).toBe('"foo\\\\bar"');
  });

  it('isString', () => {
    expect(new JsonString('foo').isString()).toBe(true);
  });

  it('asString', () => {
    expect(new JsonString('foo').asString()).toBe('foo');
  });

  it('equals_trueForSameInstance', () => {
    const str = new JsonString('foo');
    expect(str.equals(str)).toBe(true);
  });

  it('equals_trueForEqualStrings', () => {
    expect(new JsonString('foo').equals(new JsonString('foo'))).toBe(true);
  });

  it('equals_falseForDifferentStrings', () => {
    expect(new JsonString('').equals(new JsonString('foo'))).toBe(false);
    expect(new JsonString('foo').equals(new JsonString('bar'))).toBe(false);
  });

  it('equals_falseForNull', () => {
    expect(new JsonString('foo').equals(null)).toBe(false);
  });

  it('hashCode_equalsForEqualStrings', () => {
    expect(new JsonString('foo').hashCode()).toBe(new JsonString('foo').hashCode());
  });

  it('hashCode_differsForDifferentStrings', () => {
    expect(new JsonString('').hashCode()).not.toBe(new JsonString('foo').hashCode());
    expect(new JsonString('foo').hashCode()).not.toBe(new JsonString('bar').hashCode());
  });
});
