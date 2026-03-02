/**
 * A window key uniquely identifies a window instance (e.g., "tumbling:0:60000").
 */
export type WindowKey = string;

/**
 * Policy that determines which window(s) an event belongs to.
 *
 * `assignWindows(eventTime)` maps an event's timestamp to one or more window keys.
 * `maxDurationMs` is used to compute the NATS KV bucket TTL safety backstop
 * (bucket TTL = maxDurationMs * 3).
 */
export interface WindowPolicy {
    /** Return the window key(s) for an event with the given timestamp. */
    assignWindows(eventTime: number): WindowKey[];

    /**
     * Maximum possible window duration in milliseconds.
     * Used to compute NATS KV bucket TTL:  TTL = maxDurationMs * 3.
     *
     * - TumblingWindow: maxDurationMs = size
     * - SlidingWindow:  maxDurationMs = size
     * - SessionWindow:  maxDurationMs = gapMs * 2  (→ bucket TTL = gapMs * 6)
     */
    readonly maxDurationMs: number;
}
