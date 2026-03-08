import type { MetricUnit } from './MetricUnit.js';

/**
 * UserMetric — a simple numeric counter that pipeline code can read and write.
 *
 * Instantiated via the static `Metrics` factory. Not thread-safe by design
 * (Node.js is single-threaded per event-loop tick; use atomic patterns for
 * worker-thread scenarios if needed).
 */
export class UserMetric {
  readonly name: string;
  readonly unit: MetricUnit;
  private _value = 0;

  constructor(name: string, unit: MetricUnit) {
    this.name = name;
    this.unit = unit;
  }

  /** Current value of the metric. */
  get(): number {
    return this._value;
  }

  /** Set the metric to an absolute value. */
  set(value: number): void {
    this._value = value;
  }

  /** Increment by `delta` (default 1). */
  increment(delta = 1): void {
    this._value += delta;
  }

  /** Decrement by `delta` (default 1). */
  decrement(delta = 1): void {
    this._value -= delta;
  }

  /** Reset the metric to zero. */
  reset(): void {
    this._value = 0;
  }
}
