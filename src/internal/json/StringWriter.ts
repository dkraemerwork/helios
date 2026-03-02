import { Writer } from '@helios/internal/json/Writer';

/** Accumulates all written characters into a string (mirrors java.io.StringWriter). */
export class StringWriter extends Writer {
  private buf = '';

  writeSub(s: string, off: number, len: number): void {
    this.buf += s.substring(off, off + len);
  }

  flush(): void {}
  close(): void {}

  toString(): string {
    return this.buf;
  }
}
