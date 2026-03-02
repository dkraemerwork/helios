/** Abstract base class for character stream writers (mirrors java.io.Writer). */
export abstract class Writer {
  /** Write a single character given as a UTF-16 code unit. */
  writeInt(c: number): void {
    this.writeSub(String.fromCharCode(c), 0, 1);
  }

  /** Write an entire string. */
  writeStr(s: string): void {
    this.writeSub(s, 0, s.length);
  }

  /** Write a substring: s[off .. off+len). */
  abstract writeSub(s: string, off: number, len: number): void;

  abstract flush(): void;
  abstract close(): void;
}
