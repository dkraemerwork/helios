import { JsonHandler } from '@helios/internal/json/JsonHandler';
import { Location } from '@helios/internal/json/Location';
import { ParseException } from '@helios/internal/json/ParseException';
import { StringReader } from '@helios/internal/json/StringReader';
import type { Reader } from '@helios/internal/json/Reader';

const MAX_NESTING_LEVEL = 1000;
const MIN_BUFFER_SIZE = 10;
const DEFAULT_BUFFER_SIZE = 1024;

/** Streaming, event-driven JSON parser. Reports all events to a JsonHandler. */
export class JsonParser {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly handler: JsonHandler<any, any>;
  private reader!: Reader;
  private buffer!: string[];
  private bufferOffset = 0;
  private index = 0;
  private fill = 0;
  private line = 1;
  private lineOffset = 0;
  private current = 0;
  private captureBuffer: string[] | null = null;
  private captureStart = -1;
  private nestingLevel = 0;

  constructor(handler: JsonHandler<unknown, unknown>) {
    if (handler === null || handler === undefined) {
      throw new Error('handler is null');
    }
    this.handler = handler;
    handler.parser = this;
  }

  parse(input: string): void;
  parse(reader: Reader, buffersize?: number): void;
  parse(input: string | Reader, buffersize?: number): void {
    if (typeof input === 'string') {
      if (input === null || input === undefined) throw new Error('string is null');
      const sz = Math.max(MIN_BUFFER_SIZE, Math.min(DEFAULT_BUFFER_SIZE, input.length));
      this.parseReader(new StringReader(input), sz);
    } else {
      this.parseReader(input, buffersize ?? DEFAULT_BUFFER_SIZE);
    }
  }

  private parseReader(reader: Reader, buffersize: number): void {
    if (reader === null || reader === undefined) throw new Error('reader is null');
    if (buffersize <= 0) throw new Error('buffersize is zero or negative');
    this.reader = reader;
    this.buffer = new Array<string>(buffersize);
    this.bufferOffset = 0;
    this.index = 0;
    this.fill = 0;
    this.line = 1;
    this.lineOffset = 0;
    this.current = 0;
    this.captureStart = -1;
    this.read();
    this.skipWhiteSpace();
    this.readValue();
    this.skipWhiteSpace();
    if (!this.isEndOfText()) {
      throw this.error('Unexpected character');
    }
  }

  private readValue(): void {
    switch (this.current) {
      case 'n'.charCodeAt(0): this.readNull(); break;
      case 't'.charCodeAt(0): this.readTrue(); break;
      case 'f'.charCodeAt(0): this.readFalse(); break;
      case '"'.charCodeAt(0): this.readString(); break;
      case '['.charCodeAt(0): this.readArray(); break;
      case '{'.charCodeAt(0): this.readObject(); break;
      case '-'.charCodeAt(0):
      case '0'.charCodeAt(0):
      case '1'.charCodeAt(0):
      case '2'.charCodeAt(0):
      case '3'.charCodeAt(0):
      case '4'.charCodeAt(0):
      case '5'.charCodeAt(0):
      case '6'.charCodeAt(0):
      case '7'.charCodeAt(0):
      case '8'.charCodeAt(0):
      case '9'.charCodeAt(0):
        this.readNumber();
        break;
      default:
        throw this.expected('value');
    }
  }

  private readArray(): void {
    const array = this.handler.startArray();
    this.read();
    if (++this.nestingLevel > MAX_NESTING_LEVEL) {
      throw this.error('Nesting too deep');
    }
    this.skipWhiteSpace();
    if (this.readChar(']'.charCodeAt(0))) {
      this.nestingLevel--;
      this.handler.endArray(array);
      return;
    }
    do {
      this.skipWhiteSpace();
      this.handler.startArrayValue(array);
      this.readValue();
      this.handler.endArrayValue(array);
      this.skipWhiteSpace();
    } while (this.readChar(','.charCodeAt(0)));
    if (!this.readChar(']'.charCodeAt(0))) {
      throw this.expected("',' or ']'");
    }
    this.nestingLevel--;
    this.handler.endArray(array);
  }

  private readObject(): void {
    const object = this.handler.startObject();
    this.read();
    if (++this.nestingLevel > MAX_NESTING_LEVEL) {
      throw this.error('Nesting too deep');
    }
    this.skipWhiteSpace();
    if (this.readChar('}'.charCodeAt(0))) {
      this.nestingLevel--;
      this.handler.endObject(object);
      return;
    }
    do {
      this.skipWhiteSpace();
      this.handler.startObjectName(object);
      const name = this.readName();
      this.handler.endObjectName(object, name);
      this.skipWhiteSpace();
      if (!this.readChar(':'.charCodeAt(0))) {
        throw this.expected("':'");
      }
      this.skipWhiteSpace();
      this.handler.startObjectValue(object, name);
      this.readValue();
      this.handler.endObjectValue(object, name);
      this.skipWhiteSpace();
    } while (this.readChar(','.charCodeAt(0)));
    if (!this.readChar('}'.charCodeAt(0))) {
      throw this.expected("',' or '}'");
    }
    this.nestingLevel--;
    this.handler.endObject(object);
  }

  private readName(): string {
    if (this.current !== '"'.charCodeAt(0)) {
      throw this.expected('name');
    }
    return this.readStringInternal();
  }

  private readNull(): void {
    this.handler.startNull();
    this.read();
    this.readRequiredChar('u'.charCodeAt(0));
    this.readRequiredChar('l'.charCodeAt(0));
    this.readRequiredChar('l'.charCodeAt(0));
    this.handler.endNull();
  }

  private readTrue(): void {
    this.handler.startBoolean();
    this.read();
    this.readRequiredChar('r'.charCodeAt(0));
    this.readRequiredChar('u'.charCodeAt(0));
    this.readRequiredChar('e'.charCodeAt(0));
    this.handler.endBoolean(true);
  }

  private readFalse(): void {
    this.handler.startBoolean();
    this.read();
    this.readRequiredChar('a'.charCodeAt(0));
    this.readRequiredChar('l'.charCodeAt(0));
    this.readRequiredChar('s'.charCodeAt(0));
    this.readRequiredChar('e'.charCodeAt(0));
    this.handler.endBoolean(false);
  }

  private readRequiredChar(ch: number): void {
    if (!this.readChar(ch)) {
      throw this.expected(`'${String.fromCharCode(ch)}'`);
    }
  }

  private readString(): void {
    this.handler.startString();
    this.handler.endString(this.readStringInternal());
  }

  private readStringInternal(): string {
    this.read();
    this.startCapture();
    while (this.current !== '"'.charCodeAt(0)) {
      if (this.current === '\\'.charCodeAt(0)) {
        this.pauseCapture();
        this.readEscape();
        this.startCapture();
      } else if (this.current < 0x20) {
        throw this.expected('valid string character');
      } else {
        this.read();
      }
    }
    const str = this.endCapture();
    this.read();
    return str;
  }

  private readEscape(): void {
    this.read();
    const c = this.current;
    if (c === '"'.charCodeAt(0) || c === '/'.charCodeAt(0) || c === '\\'.charCodeAt(0)) {
      this.captureBuffer!.push(String.fromCharCode(c));
    } else if (c === 'b'.charCodeAt(0)) {
      this.captureBuffer!.push('\b');
    } else if (c === 'f'.charCodeAt(0)) {
      this.captureBuffer!.push('\f');
    } else if (c === 'n'.charCodeAt(0)) {
      this.captureBuffer!.push('\n');
    } else if (c === 'r'.charCodeAt(0)) {
      this.captureBuffer!.push('\r');
    } else if (c === 't'.charCodeAt(0)) {
      this.captureBuffer!.push('\t');
    } else if (c === 'u'.charCodeAt(0)) {
      const hexChars: string[] = [];
      for (let i = 0; i < 4; i++) {
        this.read();
        if (!this.isHexDigit()) {
          throw this.expected('hexadecimal digit');
        }
        hexChars.push(String.fromCharCode(this.current));
      }
      this.captureBuffer!.push(String.fromCharCode(parseInt(hexChars.join(''), 16)));
    } else {
      throw this.expected('valid escape sequence');
    }
    this.read();
  }

  private readNumber(): void {
    this.handler.startNumber();
    this.startCapture();
    this.readChar('-'.charCodeAt(0));
    const firstDigit = this.current;
    if (!this.readDigit()) {
      throw this.expected('digit');
    }
    if (firstDigit !== '0'.charCodeAt(0)) {
      while (this.readDigit()) { /* consume */ }
    }
    this.readFraction();
    this.readExponent();
    this.handler.endNumber(this.endCapture());
  }

  private readFraction(): boolean {
    if (!this.readChar('.'.charCodeAt(0))) return false;
    if (!this.readDigit()) throw this.expected('digit');
    while (this.readDigit()) { /* consume */ }
    return true;
  }

  private readExponent(): boolean {
    if (!this.readChar('e'.charCodeAt(0)) && !this.readChar('E'.charCodeAt(0))) return false;
    if (!this.readChar('+'.charCodeAt(0))) {
      this.readChar('-'.charCodeAt(0));
    }
    if (!this.readDigit()) throw this.expected('digit');
    while (this.readDigit()) { /* consume */ }
    return true;
  }

  private readChar(ch: number): boolean {
    if (this.current !== ch) return false;
    this.read();
    return true;
  }

  private readDigit(): boolean {
    if (!this.isDigit()) return false;
    this.read();
    return true;
  }

  private skipWhiteSpace(): void {
    while (this.isWhiteSpace()) this.read();
  }

  private read(): void {
    if (this.index === this.fill) {
      if (this.captureStart !== -1) {
        for (let i = this.captureStart; i < this.fill; i++) {
          this.captureBuffer!.push(this.buffer[i]);
        }
        this.captureStart = 0;
      }
      this.bufferOffset += this.fill;
      this.fill = this.reader.read(this.buffer, 0, this.buffer.length);
      this.index = 0;
      if (this.fill === -1) {
        this.current = -1;
        this.index++;
        return;
      }
    }
    if (this.current === '\n'.charCodeAt(0)) {
      this.line++;
      this.lineOffset = this.bufferOffset + this.index;
    }
    this.current = this.buffer[this.index++].charCodeAt(0);
  }

  private startCapture(): void {
    if (this.captureBuffer === null) {
      this.captureBuffer = [];
    }
    this.captureStart = this.index - 1;
  }

  private pauseCapture(): void {
    const end = this.current === -1 ? this.index : this.index - 1;
    for (let i = this.captureStart; i < end; i++) {
      this.captureBuffer!.push(this.buffer[i]);
    }
    this.captureStart = -1;
  }

  private endCapture(): string {
    const start = this.captureStart;
    const end = this.index - 1;
    this.captureStart = -1;
    if (this.captureBuffer !== null && this.captureBuffer.length > 0) {
      for (let i = start; i < end; i++) {
        this.captureBuffer.push(this.buffer[i]);
      }
      const captured = this.captureBuffer.join('');
      this.captureBuffer.length = 0;
      return captured;
    }
    return this.buffer.slice(start, end).join('');
  }

  getLocation(): Location {
    const offset = this.bufferOffset + this.index - 1;
    const column = offset - this.lineOffset + 1;
    return new Location(offset, this.line, column);
  }

  private expected(expected: string): ParseException {
    if (this.isEndOfText()) {
      return this.error('Unexpected end of input');
    }
    return this.error(`Expected ${expected}`);
  }

  private error(message: string): ParseException {
    return new ParseException(message, this.getLocation());
  }

  private isWhiteSpace(): boolean {
    return this.current === ' '.charCodeAt(0) ||
           this.current === '\t'.charCodeAt(0) ||
           this.current === '\n'.charCodeAt(0) ||
           this.current === '\r'.charCodeAt(0);
  }

  private isDigit(): boolean {
    return this.current >= '0'.charCodeAt(0) && this.current <= '9'.charCodeAt(0);
  }

  private isHexDigit(): boolean {
    return (this.current >= '0'.charCodeAt(0) && this.current <= '9'.charCodeAt(0)) ||
           (this.current >= 'a'.charCodeAt(0) && this.current <= 'f'.charCodeAt(0)) ||
           (this.current >= 'A'.charCodeAt(0) && this.current <= 'F'.charCodeAt(0));
  }

  private isEndOfText(): boolean {
    return this.current === -1;
  }
}
