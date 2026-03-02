/**
 * Abstraction over the system clock for all TTL/time-based logic.
 *
 * All runtime code that needs the current time must use this interface
 * rather than calling `Date.now()` or `Temporal.Now.*` directly.
 * This makes time-dependent logic fully testable.
 */
export interface TimeSource {
  /** Returns the current epoch time in milliseconds. */
  nowMillis(): number;
}
