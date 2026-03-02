/**
 * Port of {@code com.hazelcast.internal.util.TimeStripUtil}.
 *
 * Converts millis to seconds (as int diffs from a fixed epoch) and back.
 * Allows storing timestamps as 32-bit ints rather than 64-bit longs.
 */

/**
 * Fixed base epoch: Monday, January 1, 2018 00:00:00 UTC (zeroed to seconds).
 * Using a fixed past time prevents discrepancies between nodes.
 */
export const EPOCH_TIME_MILLIS = 1514764800000;

const UNSET = -1;

/**
 * Converts an absolute timestamp (millis) to a compressed int (seconds since EPOCH_TIME_MILLIS).
 * Returns UNSET (-1) for non-positive values; Integer.MAX_VALUE for overflow.
 */
export function stripBaseTime(millis: number): number {
    if (millis === Number.MAX_SAFE_INTEGER || millis === Number.MAX_VALUE) {
        return 0x7fffffff; // Integer.MAX_VALUE
    }
    if (millis > 0) {
        // Use Math.trunc to match Java's integer division (truncates toward zero, not floor)
        const toSeconds = Math.trunc((millis - EPOCH_TIME_MILLIS) / 1000);
        return toSeconds >= 0x7fffffff ? 0x7fffffff : toSeconds;
    }
    return UNSET;
}

/**
 * Reconstructs an absolute timestamp (millis) from a compressed int value.
 * Returns 0 for UNSET (-1); Long.MAX_VALUE proxy for Integer.MAX_VALUE.
 */
export function recomputeWithBaseTime(seconds: number): number {
    if (seconds === UNSET) {
        return 0;
    }
    if (seconds === 0x7fffffff) {
        return Number.MAX_SAFE_INTEGER;
    }
    return EPOCH_TIME_MILLIS + seconds * 1000;
}
