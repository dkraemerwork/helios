/**
 * JCache (JSR-107) compatible cache entry event model.
 *
 * Port of {@code javax.cache.event.CacheEntryEvent} and
 * {@code javax.cache.event.CacheEntryListener}.
 */

// ── Event type ────────────────────────────────────────────────────────────────

export enum CacheEntryEventType {
    CREATED = 'CREATED',
    UPDATED = 'UPDATED',
    REMOVED = 'REMOVED',
    EXPIRED = 'EXPIRED',
}

// ── Event ─────────────────────────────────────────────────────────────────────

export interface CacheEntryEvent<K, V> {
    /** The key affected by this event. */
    readonly key: K;
    /** The new value (null for REMOVED/EXPIRED). */
    readonly value: V | null;
    /** The previous value, or null if not available / not requested. */
    readonly oldValue: V | null;
    /** The type of cache mutation that triggered this event. */
    readonly eventType: CacheEntryEventType;
    /** The name of the cache that fired this event. */
    readonly source: string;
}

// ── Listener ──────────────────────────────────────────────────────────────────

export interface CacheEntryListener<K, V> {
    onCreated?(event: CacheEntryEvent<K, V>): void;
    onUpdated?(event: CacheEntryEvent<K, V>): void;
    onRemoved?(event: CacheEntryEvent<K, V>): void;
    onExpired?(event: CacheEntryEvent<K, V>): void;
}

// ── Listener configuration ────────────────────────────────────────────────────

export interface CacheEntryListenerConfiguration<K, V> {
    /** The listener to invoke on cache events. */
    readonly listener: CacheEntryListener<K, V>;
    /**
     * When {@code true} the old value before the mutation will be available
     * in {@link CacheEntryEvent.oldValue}; otherwise {@code oldValue} is null.
     */
    readonly oldValueRequired: boolean;
    /**
     * When {@code true} the listener is invoked synchronously on the mutating
     * thread and must complete before the cache operation returns.  When
     * {@code false} the event may be dispatched asynchronously.
     */
    readonly synchronous: boolean;
}
