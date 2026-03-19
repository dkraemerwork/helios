/**
 * Registry that manages {@link CacheEntryListener} registrations for a single
 * cache partition and dispatches fired events to matching listeners.
 *
 * Port of Hazelcast {@code CacheEventListenerAdaptor} / listener registration
 * logic in {@code AbstractCacheService}.
 */
import type {
    CacheEntryEvent,
    CacheEntryListenerConfiguration,
} from './CacheEntryEvent.js';
import { CacheEntryEventType } from './CacheEntryEvent.js';

// ── Internal registration record ──────────────────────────────────────────────

interface CacheEntryListenerRegistration<K, V> {
    readonly registrationId: string;
    readonly config: CacheEntryListenerConfiguration<K, V>;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export class CacheListenerRegistry<K = unknown, V = unknown> {
    private readonly _listeners = new Map<
        string,
        CacheEntryListenerRegistration<K, V>
    >();

    /**
     * Registers a listener with the given configuration.
     *
     * @returns A registration ID that can be used to remove the listener later.
     */
    addListener(config: CacheEntryListenerConfiguration<K, V>): string {
        const registrationId = crypto.randomUUID();
        this._listeners.set(registrationId, { registrationId, config });
        return registrationId;
    }

    /**
     * Removes a previously registered listener.
     *
     * @returns {@code true} if the listener was found and removed.
     */
    removeListener(registrationId: string): boolean {
        return this._listeners.delete(registrationId);
    }

    /**
     * Dispatches {@code event} to all registered listeners whose configuration
     * matches the event type.
     *
     * Synchronous listeners are invoked inline; for asynchronous listeners the
     * call is still synchronous in this implementation — a real production
     * system would post to a dedicated event-dispatch thread pool.
     */
    fireEvent(event: CacheEntryEvent<K, V>): void {
        for (const { config } of this._listeners.values()) {
            const { listener } = config;
            switch (event.eventType) {
                case CacheEntryEventType.CREATED:
                    listener.onCreated?.(event);
                    break;
                case CacheEntryEventType.UPDATED:
                    listener.onUpdated?.(event);
                    break;
                case CacheEntryEventType.REMOVED:
                    listener.onRemoved?.(event);
                    break;
                case CacheEntryEventType.EXPIRED:
                    listener.onExpired?.(event);
                    break;
            }
        }
    }

    /** Returns {@code true} if there are no registered listeners. */
    isEmpty(): boolean {
        return this._listeners.size === 0;
    }

    /** Returns the number of registered listeners. */
    size(): number {
        return this._listeners.size;
    }
}
