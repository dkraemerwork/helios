import type { Reader } from '@zenystx/core/internal/json/Reader';

/** Reads from a string (mirrors java.io.StringReader). */
export class StringReader implements Reader {
  private pos = 0;

  constructor(private readonly str: string) {}

  read(buf: string[], off: number, len: number): number {
    if (this.pos >= this.str.length) return -1;
    const count = Math.min(len, this.str.length - this.pos);
    for (let i = 0; i < count; i++) {
      buf[off + i] = this.str[this.pos++];
    }
    return count;
  }
}
