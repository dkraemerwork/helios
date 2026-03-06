import { Writer } from '@zenystx/core/internal/json/Writer';

/**
 * A lightweight writing buffer to reduce the number of write operations on the
 * underlying writer. Not thread-safe. Does not flush or close the wrapped writer.
 */
export class WritingBuffer extends Writer {
  private readonly writer: Writer;
  private readonly buffer: string[]; // char array
  private fill = 0;

  constructor(writer: Writer, bufferSize = 16) {
    super();
    this.writer = writer;
    this.buffer = new Array<string>(bufferSize);
  }

  override writeInt(c: number): void {
    if (this.fill > this.buffer.length - 1) {
      this.flush();
    }
    this.buffer[this.fill++] = String.fromCharCode(c);
  }

  writeSub(s: string, off: number, len: number): void {
    if (this.fill > this.buffer.length - len) {
      this.flush();
      if (len > this.buffer.length) {
        this.writer.writeSub(s, off, len);
        return;
      }
    }
    for (let i = 0; i < len; i++) {
      this.buffer[this.fill++] = s[off + i];
    }
  }

  /** Flushes the internal buffer but does NOT flush the wrapped writer. */
  flush(): void {
    this.writer.writeSub(this.buffer.slice(0, this.fill).join(''), 0, this.fill);
    this.fill = 0;
  }

  /** Does not close or flush the wrapped writer. */
  close(): void {}
}
