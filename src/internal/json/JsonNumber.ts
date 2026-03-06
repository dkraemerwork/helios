import { JsonValue } from '@zenystx/helios-core/internal/json/JsonValue';
import type { JsonWriter } from '@zenystx/helios-core/internal/json/JsonWriter';

/** JSON number value — stored as raw string for lossless representation. */
export class JsonNumber extends JsonValue {
  private readonly string: string;

  constructor(string: string) {
    super();
    if (string === null || string === undefined) {
      throw new Error('string is null');
    }
    this.string = string;
  }

  write(writer: JsonWriter): void {
    writer.writeNumber(this.string);
  }

  toString(): string {
    return this.string;
  }

  override isNumber(): boolean { return true; }

  override asInt(): number {
    const n = Number(this.string);
    if (this.string.includes('.') || this.string.toLowerCase().includes('e')) {
      throw new RangeError(`Not an integer: ${this.string}`);
    }
    if (!Number.isInteger(n) || n > 2147483647 || n < -2147483648) {
      throw new RangeError(`Value out of int range: ${this.string}`);
    }
    return n | 0;
  }

  override asLong(): number {
    const n = Number(this.string);
    if (this.string.includes('.') || this.string.toLowerCase().includes('e')) {
      throw new RangeError(`Not an integer: ${this.string}`);
    }
    if (!Number.isInteger(n)) {
      throw new RangeError(`Not an integer: ${this.string}`);
    }
    return n || 0; // normalize -0 to 0
  }

  override asFloat(): number {
    return Math.fround(parseFloat(this.string));
  }

  override asDouble(): number {
    return parseFloat(this.string);
  }

  equals(other: unknown): boolean {
    if (this === other) return true;
    if (!(other instanceof JsonNumber)) return false;
    return this.string === other.string;
  }

  hashCode(): number {
    let h = 0;
    for (let i = 0; i < this.string.length; i++) {
      h = (Math.imul(31, h) + this.string.charCodeAt(i)) | 0;
    }
    return h;
  }
}
