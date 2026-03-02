import type { TimeSource } from './TimeSource';

/**
 * Returns true if the TC39 Temporal API is available in the current runtime.
 * Bun 1.3.x does not yet expose Temporal; this guard enables forward compat.
 */
function isTemporalAvailable(): boolean {
  return (
    typeof (globalThis as Record<string, unknown>)['Temporal'] !== 'undefined' &&
    typeof ((globalThis as Record<string, unknown>)['Temporal'] as Record<string, unknown>)?.['Now'] !== 'undefined'
  );
}

/**
 * System clock singleton.
 *
 * Uses `Temporal.Now.instant().epochMilliseconds` when the Temporal API is
 * available (future Bun); falls back to `Date.now()` otherwise.
 */
export const SystemClock: TimeSource = {
  nowMillis(): number {
    if (isTemporalAvailable()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (globalThis as any).Temporal.Now.instant().epochMilliseconds as number;
    }
    return Date.now();
  },
};

/**
 * Creates an immutable clock that always returns the same epoch millisecond value.
 * Useful for unit tests that need deterministic, non-advancing time.
 */
export function fixedClock(epochMillis: number): TimeSource {
  return { nowMillis: () => epochMillis };
}

/**
 * A manually-controllable clock for testing.
 * Time advances only when `advance()` or `set()` is called explicitly.
 */
export class ManualClock implements TimeSource {
  private _millis: number;

  constructor(initialMillis: number = 0) {
    this._millis = initialMillis;
  }

  nowMillis(): number {
    return this._millis;
  }

  /** Advance the clock by `deltaMillis` milliseconds. */
  advance(deltaMillis: number): void {
    this._millis += deltaMillis;
  }

  /** Set the clock to an exact epoch millisecond value. */
  set(epochMillis: number): void {
    this._millis = epochMillis;
  }
}
