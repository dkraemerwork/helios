/**
 * Represents a single event in the Event Journal.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';

export enum EventJournalEventType {
    ADDED = 1,
    UPDATED = 2,
    REMOVED = 3,
    EVICTED = 4,
    LOADED = 5,
}

export interface EventJournalEvent {
    /** Monotonically increasing sequence number within the partition. */
    readonly sequence: bigint;
    /** The key of the affected entry. */
    readonly key: Data;
    /** The new value (null for REMOVED/EVICTED). */
    readonly newValue: Data | null;
    /** The old value (null for ADDED/LOADED). */
    readonly oldValue: Data | null;
    /** The event type. */
    readonly eventType: EventJournalEventType;
    /** Timestamp when the event was recorded. */
    readonly timestamp: number;
}
