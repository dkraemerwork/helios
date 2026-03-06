import type { JsonParser } from '@zenystx/core/internal/json/JsonParser';
import type { Location } from '@zenystx/core/internal/json/Location';

/**
 * Abstract SAX-style event handler for the JSON parser.
 * All methods have empty default implementations.
 */
export abstract class JsonHandler<A, O> {
  /** @internal Set by JsonParser on construction. */
  parser!: JsonParser;

  protected getLocation(): Location {
    return this.parser.getLocation();
  }

  startNull(): void {}
  endNull(): void {}
  startBoolean(): void {}
  endBoolean(_value: boolean): void {}
  startString(): void {}
  endString(_string: string): void {}
  startNumber(): void {}
  endNumber(_string: string): void {}
  startArray(): A | null { return null; }
  endArray(_array: A): void {}
  startArrayValue(_array: A): void {}
  endArrayValue(_array: A): void {}
  startObject(): O | null { return null; }
  endObject(_object: O): void {}
  startObjectName(_object: O): void {}
  endObjectName(_object: O, _name: string): void {}
  startObjectValue(_object: O, _name: string): void {}
  endObjectValue(_object: O, _name: string): void {}
}
