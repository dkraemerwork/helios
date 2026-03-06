/**
 * Distributed map interface.
 * Port of com.hazelcast.map.IMap.
 * Full IMap contract — Block 7.4.
 * Block 12.A3: 11 data methods made async (Promise return types).
 */
import type { Predicate } from '@zenystx/helios-core/query/Predicate';
import type { Aggregator } from '@zenystx/helios-core/aggregation/Aggregator';
import type { EntryListener } from '@zenystx/helios-core/map/EntryListener';
import type { IndexConfig } from '@zenystx/helios-core/config/IndexConfig';

export interface IMap<K, V> {
    /** Returns the name of this map. */
    getName(): string;

    /** Associates the specified value with the key. Returns the old value or null. */
    put(key: K, value: V): Promise<V | null>;

    /** Associates the value with the key without returning the old value. */
    set(key: K, value: V): Promise<void>;

    /** Returns the value for the given key, or null if absent. */
    get(key: K): Promise<V | null>;

    /** Removes and returns the value for the given key, or null if absent. */
    remove(key: K): Promise<V | null>;

    /** Removes the mapping for a key without returning the old value. */
    delete(key: K): Promise<void>;

    /** Returns true if this map contains a mapping for the specified key. */
    containsKey(key: K): boolean;

    /** Returns true if this map maps one or more keys to the specified value. */
    containsValue(value: V): boolean;

    /** Returns the number of entries. */
    size(): number;

    /** Returns true if this map contains no entries. */
    isEmpty(): boolean;

    /** Removes all entries. */
    clear(): Promise<void>;

    /** If the key is not present, associates the value and returns null; else returns existing value. */
    putIfAbsent(key: K, value: V): Promise<V | null>;

    /** Copies all key-value pairs from the given iterable. */
    putAll(entries: Iterable<[K, V]>): Promise<void>;

    /** Returns a map of key → value for all given keys. */
    getAll(keys: K[]): Promise<Map<K, V | null>>;

    /**
     * Replaces the entry for the key only if it currently has a mapping.
     * Returns the previous value or null.
     */
    replace(key: K, value: V): Promise<V | null>;

    /**
     * Replaces the value only if it currently maps to oldValue.
     * Returns true if replaced.
     */
    replaceIfSame(key: K, oldValue: V, newValue: V): Promise<boolean>;

    // ── Indexing ──────────────────────────────────────────────────────────────

    /** Adds an index to this map for the given configuration. */
    addIndex(indexConfig: IndexConfig): void;

    // ── Predicate-based query methods ────────────────────────────────────────

    /** Returns all values in the map. */
    values(): V[];
    /** Returns values matching the given predicate. */
    values(predicate: Predicate<K, V>): V[];

    /** Returns all keys in the map. */
    keySet(): Set<K>;
    /** Returns keys whose entries match the given predicate. */
    keySet(predicate: Predicate<K, V>): Set<K>;

    /** Returns all entries as a Map<K, V>. */
    entrySet(): Map<K, V>;
    /** Returns entries matching the given predicate. */
    entrySet(predicate: Predicate<K, V>): Map<K, V>;

    // ── Aggregation ──────────────────────────────────────────────────────────

    /** Executes the aggregator on all entries. */
    aggregate<R>(aggregator: Aggregator<[K, V], R>): R;
    /** Executes the aggregator on entries matching the predicate. */
    aggregate<R>(aggregator: Aggregator<[K, V], R>, predicate: Predicate<K, V>): R;

    // ── Entry listeners ──────────────────────────────────────────────────────

    /**
     * Adds an entry listener.
     * @param includeValue whether the event includes the entry value
     * @returns a registration ID that can be passed to removeEntryListener
     */
    addEntryListener(listener: EntryListener<K, V>, includeValue?: boolean): string;

    /** Removes the listener with the given registration ID. Returns true if removed. */
    removeEntryListener(listenerId: string): boolean;

    // ── Locking ──────────────────────────────────────────────────────────────

    /** Acquires the lock for the key. Blocks (single-threaded: no-op if uncontested). */
    lock(key: K): void;

    /**
     * Tries to acquire the lock.
     * In single-node single-threaded mode this always succeeds unless already locked by this call path.
     * Returns true if the lock was acquired.
     */
    tryLock(key: K): boolean;

    /** Releases the lock for the key. */
    unlock(key: K): void;

    /** Returns true if the key is currently locked. */
    isLocked(key: K): boolean;

    // ── Async variants ───────────────────────────────────────────────────────

    /** Asynchronously puts the value. Returns a Promise resolving to the old value or null. */
    putAsync(key: K, value: V): Promise<V | null>;

    /** Asynchronously gets the value. Returns a Promise resolving to the value or null. */
    getAsync(key: K): Promise<V | null>;

    /** Asynchronously removes the entry. Returns a Promise resolving to the old value or null. */
    removeAsync(key: K): Promise<V | null>;
}
