import { WriterConfig } from '@zenystx/helios-core/internal/json/WriterConfig';
import { JsonWriter } from '@zenystx/helios-core/internal/json/JsonWriter';
import { Writer } from '@zenystx/helios-core/internal/json/Writer';

/** Human-readable JSON output with configurable indentation. */
export class PrettyPrint extends WriterConfig {
  /** Two-space indentation (the most common pretty-print style). */
  static readonly PRETTY_PRINT: WriterConfig = PrettyPrint.indentWithSpaces(2);

  private readonly indentChars: string | null; // null = single-line mode

  protected constructor(indentChars: string | null) {
    super();
    this.indentChars = indentChars;
  }

  /** Wrapped mode, no indentation (adds spaces after commas/colons but no newlines). */
  static singleLine(): PrettyPrint {
    return new PrettyPrint(null);
  }

  /** Wrapped mode, indented with `number` spaces per level. */
  static indentWithSpaces(number: number): PrettyPrint {
    if (number < 0) throw new Error('number is negative');
    return new PrettyPrint(' '.repeat(number));
  }

  /** Wrapped mode, indented with tabs. */
  static indentWithTabs(): PrettyPrint {
    return new PrettyPrint('\t');
  }

  createWriter(writer: Writer): JsonWriter {
    return new PrettyPrintWriter(writer, this.indentChars);
  }
}

class PrettyPrintWriter extends JsonWriter {
  private readonly indentChars: string | null;
  private indent = 0;

  constructor(writer: Writer, indentChars: string | null) {
    super(writer);
    this.indentChars = indentChars;
  }

  override writeArrayOpen(): void {
    this.indent++;
    this.writer.writeInt('['.charCodeAt(0));
    this.writeNewLine();
  }

  override writeArrayClose(): void {
    this.indent--;
    this.writeNewLine();
    this.writer.writeInt(']'.charCodeAt(0));
  }

  override writeArraySeparator(): void {
    this.writer.writeInt(','.charCodeAt(0));
    if (!this.writeNewLine()) {
      this.writer.writeInt(' '.charCodeAt(0));
    }
  }

  override writeObjectOpen(): void {
    this.indent++;
    this.writer.writeInt('{'.charCodeAt(0));
    this.writeNewLine();
  }

  override writeObjectClose(): void {
    this.indent--;
    this.writeNewLine();
    this.writer.writeInt('}'.charCodeAt(0));
  }

  override writeMemberSeparator(): void {
    this.writer.writeInt(':'.charCodeAt(0));
    this.writer.writeInt(' '.charCodeAt(0));
  }

  override writeObjectSeparator(): void {
    this.writer.writeInt(','.charCodeAt(0));
    if (!this.writeNewLine()) {
      this.writer.writeInt(' '.charCodeAt(0));
    }
  }

  private writeNewLine(): boolean {
    if (this.indentChars === null) return false;
    this.writer.writeInt('\n'.charCodeAt(0));
    for (let i = 0; i < this.indent; i++) {
      this.writer.writeStr(this.indentChars);
    }
    return true;
  }
}
