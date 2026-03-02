/** Interface for character stream readers (mirrors java.io.Reader). */
export interface Reader {
  /**
   * Read characters into a portion of an array.
   * @returns number of chars read, or -1 at end of stream
   */
  read(buf: string[], off: number, len: number): number;
}
