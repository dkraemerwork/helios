/**
 * Port of {@code com.hazelcast.map.QueryCache}.
 *
 * A continuously maintained, locally-indexed view of an IMap subset.
 */
import type { Predicate } from '@zenystx/helios-core/query/Predicate';

export interface QueryCache<K, V> {
    /** Get a value by key from the local cache. */
    get(key: K): V | null;

    /** Check if a key exists in the local cache. */
    containsKey(key: K): boolean;

    /** Check if a value exists in the local cache. */
    containsValue(value: V): boolean;

    /** Returns true if the cache is empty. */
    isEmpty(): boolean;

    /** Returns the number of entries in the cache. */
    size(): number;

    /** Get all keys. */
    keySet(): Set<K>;

    /** Get all keys matching a predicate. */
    keySet(predicate: Predicate<K, V>): Set<K>;

    /** Get all values. */
    values(): V[];

    /** Get all values matching a predicate. */
    values(predicate: Predicate<K, V>): V[];

    /** Get all entries. */
    entrySet(): Set<[K, V]>;

    /** Get all entries matching a predicate. */
    entrySet(predicate: Predicate<K, V>): Set<[K, V]>;

    /**
     * Recreate the QueryCache by re-querying the source map.
     * Useful for recovery after a connection loss or event gap.
     */
    recreate(): Promise<void>;

    /** Destroy this QueryCache. */
    destroy(): Promise<void>;

    /** Returns the name of this QueryCache. */
    getName(): string;

    /**
     * Add an entry listener that fires for changes to this QueryCache.
     */
    addEntryListener(listener: QueryCacheEntryListener<K, V>, includeValue?: boolean): string;

    /**
     * Remove a previously added entry listener.
     */
    removeEntryListener(listenerId: string): boolean;
}

export interface QueryCacheEntryListener<K, V> {
    entryAdded?(key: K, value: V): void;
    entryUpdated?(key: K, oldValue: V | null, value: V): void;
    entryRemoved?(key: K, oldValue: V | null): void;
    entryEvicted?(key: K, oldValue: V | null): void;
}
