import { Json } from '@zenystx/helios-core/internal/json/Json';
import { JsonObject } from '@zenystx/helios-core/internal/json/JsonObject';
import { JsonValue } from '@zenystx/helios-core/internal/json/JsonValue';
import type { JsonWriter } from '@zenystx/helios-core/internal/json/JsonWriter';
import { StringWriter } from '@zenystx/helios-core/internal/json/StringWriter';
import { WriterConfig } from '@zenystx/helios-core/internal/json/WriterConfig';
import { describe, expect, it } from 'bun:test';

class MockWriter extends StringWriter {
  closeMethodIsCalled = false;
  override close(): void {
    super.close();
    this.closeMethodIsCalled = true;
  }
}

describe('JsonValue_Test', () => {
  it('writeTo', () => {
    const value = new JsonObject();
    const writer = new StringWriter();
    value.writeTo(writer);
    expect(writer.toString()).toBe('{}');
  });

  it('writeTo_failsWithNullWriter', () => {
    const value = new JsonObject();
    expect(() => value.writeTo(null as unknown as StringWriter, WriterConfig.MINIMAL)).toThrow('writer is null');
  });

  it('writeTo_failsWithNullConfig', () => {
    const value = new JsonObject();
    expect(() => value.writeTo(new StringWriter(), null as unknown as WriterConfig)).toThrow('config is null');
  });

  it('toString_failsWithNullConfig', () => {
    const value = new JsonObject();
    expect(() => value.toString(null as unknown as WriterConfig)).toThrow('config is null');
  });

  it('writeTo_doesNotCloseWriter', () => {
    const value = new JsonObject();
    const writer = new MockWriter();
    value.writeTo(writer);
    expect(writer.closeMethodIsCalled).toBe(false);
  });

  it('asObject_failsOnIncompatibleType', () => {
    expect(() => Json.NULL.asObject()).toThrow('Not an object: null');
  });

  it('asArray_failsOnIncompatibleType', () => {
    expect(() => Json.NULL.asArray()).toThrow('Not an array: null');
  });

  it('asString_failsOnIncompatibleType', () => {
    expect(() => Json.NULL.asString()).toThrow('Not a string: null');
  });

  it('asInt_failsOnIncompatibleType', () => {
    expect(() => Json.NULL.asInt()).toThrow('Not a number: null');
  });

  it('asLong_failsOnIncompatibleType', () => {
    expect(() => Json.NULL.asLong()).toThrow('Not a number: null');
  });

  it('asFloat_failsOnIncompatibleType', () => {
    expect(() => Json.NULL.asFloat()).toThrow('Not a number: null');
  });

  it('asDouble_failsOnIncompatibleType', () => {
    expect(() => Json.NULL.asDouble()).toThrow('Not a number: null');
  });

  it('asBoolean_failsOnIncompatibleType', () => {
    expect(() => Json.NULL.asBoolean()).toThrow('Not a boolean: null');
  });

  it('isXxx_returnsFalseForIncompatibleType', () => {
    const jsonValue = new class extends JsonValue {
      write(_writer: JsonWriter): void {}
    }();
    expect(jsonValue.isArray()).toBe(false);
    expect(jsonValue.isObject()).toBe(false);
    expect(jsonValue.isString()).toBe(false);
    expect(jsonValue.isNumber()).toBe(false);
    expect(jsonValue.isBoolean()).toBe(false);
    expect(jsonValue.isNull()).toBe(false);
    expect(jsonValue.isTrue()).toBe(false);
    expect(jsonValue.isFalse()).toBe(false);
  });
});
