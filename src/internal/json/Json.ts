import { JsonArray } from '@zenystx/helios-core/internal/json/JsonArray';
import { JsonHandler } from '@zenystx/helios-core/internal/json/JsonHandler';
import { JsonLiteral } from '@zenystx/helios-core/internal/json/JsonLiteral';
import { JsonNumber } from '@zenystx/helios-core/internal/json/JsonNumber';
import { JsonObject } from '@zenystx/helios-core/internal/json/JsonObject';
import { JsonParser } from '@zenystx/helios-core/internal/json/JsonParser';
import { JsonString } from '@zenystx/helios-core/internal/json/JsonString';
import { JsonValue } from '@zenystx/helios-core/internal/json/JsonValue';
import type { Reader } from '@zenystx/helios-core/internal/json/Reader';

/** Static factory and entry point for the minimal JSON library. */
export class Json {
  private constructor() {}

  static readonly NULL: JsonValue = new JsonLiteral('null');
  static readonly TRUE: JsonValue = new JsonLiteral('true');
  static readonly FALSE: JsonValue = new JsonLiteral('false');

  static value(value: number): JsonValue;
  static value(value: string | null): JsonValue;
  static value(value: boolean): JsonValue;
  static value(value: number | string | boolean | null): JsonValue {
    if (value === null || value === undefined) return Json.NULL;
    if (typeof value === 'boolean') return value ? Json.TRUE : Json.FALSE;
    if (typeof value === 'string') return new JsonString(value);
    if (typeof value === 'number') {
      if (!isFinite(value)) throw new Error('Infinite and NaN values not permitted in JSON');
      return new JsonNumber(cutOffPointZero(String(value)));
    }
    throw new Error(`Unsupported value type: ${typeof value}`);
  }

  static array(): JsonArray;
  static array(...values: number[]): JsonArray;
  static array(...values: string[]): JsonArray;
  static array(...values: boolean[]): JsonArray;
  static array(...values: (number | string | boolean)[]): JsonArray {
    const arr = new JsonArray();
    for (const v of values) arr.add(Json.value(v as never));
    return arr;
  }

  static object(): JsonObject {
    return new JsonObject();
  }

  static parse(input: string): JsonValue;
  static parse(reader: Reader): JsonValue;
  static parse(input: string | Reader): JsonValue {
    const handler = new DefaultHandler();
    const parser = new JsonParser(handler);
    if (typeof input === 'string') {
      parser.parse(input);
    } else {
      parser.parse(input);
    }
    return handler.getValue();
  }
}

function cutOffPointZero(s: string): string {
  if (s.endsWith('.0')) return s.slice(0, -2);
  return s;
}

/** @internal Default handler that builds a JSON value tree. */
export class DefaultHandler extends JsonHandler<JsonArray, JsonObject> {
  protected value: JsonValue | null = null;

  override startArray(): JsonArray { return new JsonArray(); }
  override startObject(): JsonObject { return new JsonObject(); }
  override endNull(): void { this.value = Json.NULL; }
  override endBoolean(bool: boolean): void { this.value = bool ? Json.TRUE : Json.FALSE; }
  override endString(string: string): void { this.value = new JsonString(string); }
  override endNumber(string: string): void { this.value = new JsonNumber(string); }
  override endArray(array: JsonArray): void { this.value = array; }
  override endObject(object: JsonObject): void { this.value = object; }
  override endArrayValue(array: JsonArray): void { array.add(this.value!); }
  override endObjectValue(object: JsonObject, name: string): void { object.add(name, this.value!); }

  getValue(): JsonValue {
    return this.value!;
  }
}
