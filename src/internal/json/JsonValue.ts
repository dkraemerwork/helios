import { Writer } from '@zenystx/helios-core/internal/json/Writer';
import { WriterConfig } from '@zenystx/helios-core/internal/json/WriterConfig';
import { WritingBuffer } from '@zenystx/helios-core/internal/json/WritingBuffer';
import type { JsonWriter } from '@zenystx/helios-core/internal/json/JsonWriter';
import type { JsonObject } from '@zenystx/helios-core/internal/json/JsonObject';
import type { JsonArray } from '@zenystx/helios-core/internal/json/JsonArray';

/** Abstract base class for all JSON value types. */
export abstract class JsonValue {
  isObject(): boolean { return false; }
  isArray(): boolean { return false; }
  isNumber(): boolean { return false; }
  isString(): boolean { return false; }
  isBoolean(): boolean { return false; }
  isTrue(): boolean { return false; }
  isFalse(): boolean { return false; }
  isNull(): boolean { return false; }

  asObject(): JsonObject {
    throw new UnsupportedOperationError(`Not an object: ${this}`);
  }

  asArray(): JsonArray {
    throw new UnsupportedOperationError(`Not an array: ${this}`);
  }

  asInt(): number {
    throw new UnsupportedOperationError(`Not a number: ${this}`);
  }

  asLong(): number {
    throw new UnsupportedOperationError(`Not a number: ${this}`);
  }

  asFloat(): number {
    throw new UnsupportedOperationError(`Not a number: ${this}`);
  }

  asDouble(): number {
    throw new UnsupportedOperationError(`Not a number: ${this}`);
  }

  asString(): string {
    throw new UnsupportedOperationError(`Not a string: ${this}`);
  }

  asBoolean(): boolean {
    throw new UnsupportedOperationError(`Not a boolean: ${this}`);
  }

  writeTo(writer: Writer, config: WriterConfig = WriterConfig.MINIMAL): void {
    if (writer === null || writer === undefined) {
      throw new Error('writer is null');
    }
    if (config === null || config === undefined) {
      throw new Error('config is null');
    }
    const writingBuffer = new WritingBuffer(writer, 128);
    const jsonWriter = config.createWriter(writingBuffer);
    this.write(jsonWriter);
    writingBuffer.flush();
  }

  toString(config: WriterConfig = WriterConfig.MINIMAL): string {
    if (config === null || config === undefined) {
      throw new Error('config is null');
    }
    const sw = new StringWriterLocal();
    this.writeTo(sw, config);
    return sw.toString();
  }

  abstract write(writer: JsonWriter): void;

  equals(other: unknown): boolean {
    return this === other;
  }
}

/** Used to signal unsupported coercions. */
export class UnsupportedOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedOperationError';
  }
}

/** Local StringWriter to avoid circular import (Writer → StringWriter → Writer). */
class StringWriterLocal extends Writer {
  private buf = '';
  writeSub(s: string, off: number, len: number): void {
    this.buf += s.substring(off, off + len);
  }
  flush(): void {}
  close(): void {}
  toString(): string { return this.buf; }
}
