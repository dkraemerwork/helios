/**
 * SystemEventLog — port of {@code com.hazelcast.internal.diagnostics.SystemLogPlugin}.
 *
 * A fixed-capacity ring buffer of cluster system events. When the buffer is
 * full the oldest event is dropped to make room for the new one.
 *
 * Thread-safe: all mutations happen synchronously on the JS event loop.
 */

/** All known event types. */
export type SystemEventType =
    | 'MEMBER_JOINED'
    | 'MEMBER_LEFT'
    | 'MIGRATION_STARTED'
    | 'MIGRATION_COMPLETED'
    | 'CONNECTION_OPENED'
    | 'CONNECTION_CLOSED'
    | 'STATE_CHANGED';

/** A single system event. */
export interface SystemEvent {
    /** Unix timestamp (ms) when the event occurred. */
    timestamp: number;
    /** Event category. */
    type: SystemEventType;
    /** Human-readable description. */
    message: string;
    /** Optional key-value details. */
    details?: Record<string, unknown>;
}

const DEFAULT_CAPACITY = 100;

export class SystemEventLog {
    private readonly _capacity: number;
    private readonly _buffer: SystemEvent[] = [];

    constructor(capacity: number = DEFAULT_CAPACITY) {
        this._capacity = Math.max(1, capacity);
    }

    /**
     * Push a new event into the ring buffer.
     * If the buffer is at capacity the oldest event is evicted.
     */
    push(event: SystemEvent): void {
        if (this._buffer.length >= this._capacity) {
            this._buffer.shift();
        }
        this._buffer.push(event);
    }

    /**
     * Convenience overload — builds and pushes an event from parts.
     */
    pushEvent(
        type: SystemEventType,
        message: string,
        details?: Record<string, unknown>,
    ): void {
        this.push({ timestamp: Date.now(), type, message, details });
    }

    /**
     * Returns all stored events in chronological order (oldest first).
     * The returned array is a snapshot copy.
     */
    getEvents(): SystemEvent[] {
        return [...this._buffer];
    }

    /**
     * Returns the most recent N events in chronological order.
     * If fewer than N events exist, all are returned.
     */
    getRecentEvents(n: number): SystemEvent[] {
        return this._buffer.slice(-n);
    }

    /** Total events currently stored. */
    get size(): number {
        return this._buffer.length;
    }

    /** Configured maximum capacity. */
    get capacity(): number {
        return this._capacity;
    }

    /** Clear all stored events. */
    clear(): void {
        this._buffer.length = 0;
    }
}
