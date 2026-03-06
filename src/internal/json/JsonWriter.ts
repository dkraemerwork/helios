import { Writer } from '@zenystx/helios-core/internal/json/Writer';

const CONTROL_CHARACTERS_END = 0x001f;

const QUOT_CHARS = '\\"';
const BS_CHARS = '\\\\';
const LF_CHARS = '\\n';
const CR_CHARS = '\\r';
const TAB_CHARS = '\\t';
const UNICODE_2028_CHARS = '\\u2028';
const UNICODE_2029_CHARS = '\\u2029';
const HEX_DIGITS = '0123456789abcdef';

/** Core JSON writer — produces minimal (compact) JSON output. */
export class JsonWriter {
  protected readonly writer: Writer;

  constructor(writer: Writer) {
    this.writer = writer;
  }

  writeLiteral(value: string): void {
    this.writer.writeStr(value);
  }

  writeNumber(string: string): void {
    this.writer.writeStr(string);
  }

  writeString(string: string): void {
    this.writer.writeInt('"'.charCodeAt(0));
    this.writeJsonString(string);
    this.writer.writeInt('"'.charCodeAt(0));
  }

  writeArrayOpen(): void {
    this.writer.writeInt('['.charCodeAt(0));
  }

  writeArrayClose(): void {
    this.writer.writeInt(']'.charCodeAt(0));
  }

  writeArraySeparator(): void {
    this.writer.writeInt(','.charCodeAt(0));
  }

  writeObjectOpen(): void {
    this.writer.writeInt('{'.charCodeAt(0));
  }

  writeObjectClose(): void {
    this.writer.writeInt('}'.charCodeAt(0));
  }

  writeMemberName(name: string): void {
    this.writer.writeInt('"'.charCodeAt(0));
    this.writeJsonString(name);
    this.writer.writeInt('"'.charCodeAt(0));
  }

  writeMemberSeparator(): void {
    this.writer.writeInt(':'.charCodeAt(0));
  }

  writeObjectSeparator(): void {
    this.writer.writeInt(','.charCodeAt(0));
  }

  protected writeJsonString(string: string): void {
    const length = string.length;
    let start = 0;
    for (let index = 0; index < length; index++) {
      const replacement = JsonWriter.getReplacementChars(string.charCodeAt(index));
      if (replacement !== null) {
        this.writer.writeSub(string, start, index - start);
        this.writer.writeStr(replacement);
        start = index + 1;
      }
    }
    this.writer.writeSub(string, start, length - start);
  }

  static getReplacementChars(ch: number): string | null {
    if (ch > '\\'.charCodeAt(0)) {
      if (ch < 0x2028 || ch > 0x2029) {
        return null;
      }
      return ch === 0x2028 ? UNICODE_2028_CHARS : UNICODE_2029_CHARS;
    }
    if (ch === '\\'.charCodeAt(0)) {
      return BS_CHARS;
    }
    if (ch > '"'.charCodeAt(0)) {
      return null;
    }
    if (ch === '"'.charCodeAt(0)) {
      return QUOT_CHARS;
    }
    if (ch > CONTROL_CHARACTERS_END) {
      return null;
    }
    if (ch === '\n'.charCodeAt(0)) {
      return LF_CHARS;
    }
    if (ch === '\r'.charCodeAt(0)) {
      return CR_CHARS;
    }
    if (ch === '\t'.charCodeAt(0)) {
      return TAB_CHARS;
    }
    return `\\u00${HEX_DIGITS[(ch >> 4) & 0x000f]}${HEX_DIGITS[ch & 0x000f]}`;
  }
}
