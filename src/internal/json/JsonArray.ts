import { JsonValue } from '@zenystx/helios-core/internal/json/JsonValue';
import { Json } from '@zenystx/helios-core/internal/json/Json';
import type { JsonWriter } from '@zenystx/helios-core/internal/json/JsonWriter';

/** Ordered, mutable JSON array. */
export class JsonArray extends JsonValue implements Iterable<JsonValue> {
  private readonly _values: JsonValue[];
  private readonly _unmodifiable: boolean;

  constructor(array?: JsonArray) {
    super();
    if (array !== undefined && array !== null) {
      this._values = [...(array as JsonArray)._values];
      this._unmodifiable = false;
    } else if (array === null) {
      throw new Error('array is null');
    } else {
      this._values = [];
      this._unmodifiable = false;
    }
  }

  static unmodifiableArray(array: JsonArray): JsonArray {
    const inst = Object.create(JsonArray.prototype) as JsonArray;
    // @ts-expect-error private field assignment
    inst._values = array._values; // backed by same array
    // @ts-expect-error private field assignment
    inst._unmodifiable = true;
    return inst;
  }

  private checkModifiable(): void {
    if (this._unmodifiable) {
      throw new Error('object is not modifiable');
    }
  }

  add(value: number | boolean | string | JsonValue | null): this {
    this.checkModifiable();
    const jv = value instanceof JsonValue ? value : Json.value(value as never);
    if (jv === null || jv === undefined) throw new Error('value is null');
    this._values.push(jv);
    return this;
  }

  set(index: number, value: number | boolean | string | JsonValue | null): this {
    this.checkModifiable();
    const jv = value instanceof JsonValue ? value : Json.value(value as never);
    if (jv === null || jv === undefined) throw new Error('value is null');
    this._values[index] = jv;
    return this;
  }

  remove(index: number): this {
    this.checkModifiable();
    this._values.splice(index, 1);
    return this;
  }

  size(): number { return this._values.length; }
  isEmpty(): boolean { return this._values.length === 0; }

  get(index: number): JsonValue {
    return this._values[index];
  }

  /** Returns a snapshot copy of the values list. */
  values(): JsonValue[] {
    return [...this._values];
  }

  [Symbol.iterator](): Iterator<JsonValue> {
    let i = 0;
    const vals = this._values;
    return {
      next(): IteratorResult<JsonValue> {
        if (i < vals.length) {
          return { value: vals[i++], done: false };
        }
        return { value: undefined as unknown as JsonValue, done: true };
      },
    };
  }

  write(writer: JsonWriter): void {
    writer.writeArrayOpen();
    const it = this[Symbol.iterator]();
    let next = it.next();
    if (!next.done) {
      next.value.write(writer);
      next = it.next();
      while (!next.done) {
        writer.writeArraySeparator();
        next.value.write(writer);
        next = it.next();
      }
    }
    writer.writeArrayClose();
  }

  override isArray(): boolean { return true; }
  override asArray(): JsonArray { return this; }

  equals(other: unknown): boolean {
    if (this === other) return true;
    if (!(other instanceof JsonArray)) return false;
    if (this._values.length !== other._values.length) return false;
    for (let i = 0; i < this._values.length; i++) {
      if (!(this._values[i] as unknown as { equals(o: unknown): boolean }).equals(other._values[i])) return false;
    }
    return true;
  }

  hashCode(): number {
    let h = 1;
    for (const v of this._values) {
      h = (Math.imul(31, h) + (v as unknown as { hashCode(): number }).hashCode()) | 0;
    }
    return h;
  }
}
