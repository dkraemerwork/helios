import { JsonValue } from '@zenystx/core/internal/json/JsonValue';
import type { JsonWriter } from '@zenystx/core/internal/json/JsonWriter';

/** JSON string value. */
export class JsonString extends JsonValue {
  private readonly string: string;

  constructor(string: string) {
    super();
    if (string === null || string === undefined) {
      throw new Error('string is null');
    }
    this.string = string;
  }

  write(writer: JsonWriter): void {
    writer.writeString(this.string);
  }

  override isString(): boolean { return true; }

  override asString(): string {
    return this.string;
  }

  equals(other: unknown): boolean {
    if (this === other) return true;
    if (!(other instanceof JsonString)) return false;
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
