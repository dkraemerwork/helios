/** Mutable long which can be used for counting purposes. Not thread-safe. */
export class MutableLong {
  value: number;

  constructor(value = 0) {
    this.value = value;
  }

  static valueOf(value: number): MutableLong {
    return new MutableLong(value);
  }

  addAndGet(delta: number): number {
    this.value += delta;
    return this.value;
  }

  getAndInc(): number {
    return this.value++;
  }

  equals(other: unknown): boolean {
    if (this === other) return true;
    if (!(other instanceof MutableLong)) return false;
    return this.value === other.value;
  }

  hashCode(): number {
    // Mirror Java's Long.hashCode: (int)(value ^ (value >>> 32))
    // For JS numbers, just use the value directly
    return this.value | 0;
  }

  toString(): string {
    return `MutableLong{value=${this.value}}`;
  }
}
