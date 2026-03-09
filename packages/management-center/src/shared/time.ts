/**
 * Time utility functions for the Helios Management Center.
 *
 * Provides consistent timestamp generation and boundary alignment
 * used by metric aggregation, retention, and scheduling.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_FIVE_MINUTES = 5 * MS_PER_MINUTE;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** Returns the current time in milliseconds since epoch. */
export function nowMs(): number {
  return Date.now();
}

/** Returns the current time in whole seconds since epoch. */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Floors a millisecond timestamp to the start of its containing minute. */
export function minuteBoundary(ts: number): number {
  return Math.floor(ts / MS_PER_MINUTE) * MS_PER_MINUTE;
}

/** Floors a millisecond timestamp to the start of its containing 5-minute window. */
export function fiveMinuteBoundary(ts: number): number {
  return Math.floor(ts / MS_PER_FIVE_MINUTES) * MS_PER_FIVE_MINUTES;
}

/** Floors a millisecond timestamp to the start of its containing hour. */
export function hourBoundary(ts: number): number {
  return Math.floor(ts / MS_PER_HOUR) * MS_PER_HOUR;
}

/** Floors a millisecond timestamp to the start of its containing UTC day. */
export function dayBoundary(ts: number): number {
  return Math.floor(ts / MS_PER_DAY) * MS_PER_DAY;
}

/** Converts a millisecond duration to fractional hours. */
export function msToHours(ms: number): number {
  return ms / MS_PER_HOUR;
}

/** Converts a millisecond duration to fractional days. */
export function msToDays(ms: number): number {
  return ms / MS_PER_DAY;
}

/** Converts a millisecond epoch timestamp to an ISO-8601 string. */
export function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}
