import { JsonValue } from '@helios/internal/json/JsonValue';
import type { JsonWriter } from '@helios/internal/json/JsonWriter';

/** JSON literal values: null, true, false. */
export class JsonLiteral extends JsonValue {
  private readonly value: string;
  private readonly _isNull: boolean;
  private readonly _isTrue: boolean;
  private readonly _isFalse: boolean;

  constructor(value: string) {
    super();
    this.value = value;
    this._isNull = value === 'null';
    this._isTrue = value === 'true';
    this._isFalse = value === 'false';
  }

  write(writer: JsonWriter): void {
    writer.writeLiteral(this.value);
  }

  toString(): string {
    return this.value;
  }

  override isNull(): boolean { return this._isNull; }
  override isTrue(): boolean { return this._isTrue; }
  override isFalse(): boolean { return this._isFalse; }
  override isBoolean(): boolean { return this._isTrue || this._isFalse; }

  override asBoolean(): boolean {
    if (this._isNull) return super.asBoolean();
    return this._isTrue;
  }

  equals(other: unknown): boolean {
    if (this === other) return true;
    if (!(other instanceof JsonLiteral)) return false;
    return this.value === other.value;
  }

  hashCode(): number {
    let h = 0;
    for (let i = 0; i < this.value.length; i++) {
      h = (Math.imul(31, h) + this.value.charCodeAt(i)) | 0;
    }
    return h;
  }
}
