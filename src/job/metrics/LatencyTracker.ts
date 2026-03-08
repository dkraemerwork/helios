/**
 * Circular-buffer latency tracker for single-threaded use.
 *
 * Records latency values into a fixed-size ring buffer and computes
 * p50, p99, and max on demand by sorting the current window.
 */
export class LatencyTracker {
  private readonly buffer: Float64Array;
  private readonly _capacity: number;
  private _count = 0;
  private _writeIndex = 0;
  private _max = 0;

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error(`capacity must be positive, got ${capacity}`);
    }
    this._capacity = capacity;
    this.buffer = new Float64Array(capacity);
  }

  /** Number of values currently stored (at most capacity). */
  get count(): number {
    return this._count;
  }

  /** Record a latency value in milliseconds. */
  record(value: number): void {
    this.buffer[this._writeIndex] = value;
    this._writeIndex = (this._writeIndex + 1) % this._capacity;
    if (this._count < this._capacity) {
      this._count++;
    }
    // Update running max
    if (this._count === 1 || value > this._max) {
      this._max = value;
    }
  }

  /** Get the 50th percentile (median). Returns 0 if empty. */
  getP50(): number {
    return this.getPercentile(0.5);
  }

  /** Get the 99th percentile. Returns 0 if empty. */
  getP99(): number {
    return this.getPercentile(0.99);
  }

  /** Get the maximum recorded value. Returns 0 if empty. */
  getMax(): number {
    if (this._count === 0) return 0;
    return this._max;
  }

  /** Reset all tracked state. */
  reset(): void {
    this._count = 0;
    this._writeIndex = 0;
    this._max = 0;
    this.buffer.fill(0);
  }

  private getPercentile(p: number): number {
    if (this._count === 0) return 0;

    // Copy active entries and sort
    const active = new Float64Array(this._count);
    for (let i = 0; i < this._count; i++) {
      active[i] = this.buffer[i];
    }
    active.sort();

    // Use nearest-rank method
    const rank = Math.ceil(p * this._count) - 1;
    return active[Math.max(0, rank)];
  }
}
