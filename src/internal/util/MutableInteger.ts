/** Mutable integer which can be used for counting purposes. Not thread-safe. */
export class MutableInteger {
  value: number;

  constructor(value = 0) {
    this.value = value;
  }

  getAndInc(): number {
    return this.value++;
  }

  addAndGet(delta: number): number {
    this.value += delta;
    return this.value;
  }
}
