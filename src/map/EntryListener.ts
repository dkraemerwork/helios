/**
 * Entry event types and listener interface for IMap.
 * Port of com.hazelcast.core.EntryListener / EntryEvent.
 */

/** Types of entry events fired by an IMap. */
export type EntryEventType = 'ADDED' | 'UPDATED' | 'REMOVED' | 'EVICTED' | 'CLEARED';

/**
 * An event object delivered to EntryListener callbacks.
 */
export interface EntryEvent<K, V> {
    /** The map name that generated this event. */
    getName(): string;
    /** The key affected by the event (null for CLEARED). */
    getKey(): K | null;
    /** The new value (non-null for ADDED/UPDATED; null for REMOVED/EVICTED/CLEARED). */
    getValue(): V | null;
    /** The previous value (non-null for UPDATED/REMOVED; null otherwise). */
    getOldValue(): V | null;
    /** The type of event. */
    getEventType(): EntryEventType;
}

/**
 * Listener interface for IMap entry events.
 * All methods are optional — implement only the events you care about.
 */
export interface EntryListener<K = unknown, V = unknown> {
    entryAdded?(event: EntryEvent<K, V>): void;
    entryUpdated?(event: EntryEvent<K, V>): void;
    entryRemoved?(event: EntryEvent<K, V>): void;
    entryEvicted?(event: EntryEvent<K, V>): void;
    mapCleared?(): void;
}

/** Simple concrete EntryEvent implementation. */
export class EntryEventImpl<K, V> implements EntryEvent<K, V> {
    constructor(
        private readonly _name: string,
        private readonly _key: K | null,
        private readonly _value: V | null,
        private readonly _oldValue: V | null,
        private readonly _eventType: EntryEventType,
    ) {}

    getName(): string { return this._name; }
    getKey(): K | null { return this._key; }
    getValue(): V | null { return this._value; }
    getOldValue(): V | null { return this._oldValue; }
    getEventType(): EntryEventType { return this._eventType; }
}
