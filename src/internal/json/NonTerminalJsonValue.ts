import { JsonValue } from '@zenystx/core/internal/json/JsonValue';
import type { JsonWriter } from '@zenystx/core/internal/json/JsonWriter';

/**
 * Sentinel JsonValue for the query engine indicating a non-terminal path
 * (resolves to an object or array, not a primitive). Must not be encoded.
 */
export class NonTerminalJsonValue extends JsonValue {
  static readonly INSTANCE = new NonTerminalJsonValue();

  private constructor() {
    super();
  }

  write(_writer: JsonWriter): void {
    throw new Error('This object must not be encoded');
  }
}
