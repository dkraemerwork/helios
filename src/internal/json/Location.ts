/** Immutable object that represents a location in the parsed text. */
export class Location {
  /** The absolute character index, starting at 0. */
  readonly offset: number;
  /** The line number, starting at 1. */
  readonly line: number;
  /** The column number, starting at 1. */
  readonly column: number;

  constructor(offset: number, line: number, column: number) {
    this.offset = offset;
    this.line = line;
    this.column = column;
  }

  toString(): string {
    return `${this.line}:${this.column}`;
  }

  equals(other: unknown): boolean {
    if (this === other) return true;
    if (!(other instanceof Location)) return false;
    return this.offset === other.offset && this.column === other.column && this.line === other.line;
  }
}
