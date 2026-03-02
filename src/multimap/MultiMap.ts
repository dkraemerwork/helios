/**
 * Distributed multi-map interface.
 * Port of com.hazelcast.multimap.MultiMap.
 *
 * A MultiMap maps a single key to multiple values.
 * Values are stored in a collection (SET or LIST) per key.
 */
export interface MultiMap<K, V> {
    /**
     * Stores a key-value pair.
     * @returns true if the collection changed (false for duplicate in SET mode).
     */
    put(key: K, value: V): boolean;

    /**
     * Returns the collection of values associated with the key.
     * Returns an empty collection (not null) when the key has no values.
     */
    get(key: K): { size: number; has(v: V): boolean; [Symbol.iterator](): Iterator<V> };

    /**
     * Removes all values for the given key.
     * @returns the removed values (empty collection if key not found).
     */
    removeAll(key: K): { size: number; [Symbol.iterator](): Iterator<V> };

    /**
     * Removes a single key-value entry.
     * @returns true if the entry existed and was removed.
     */
    remove(key: K, value: V): boolean;

    /**
     * Deletes all values for the given key (void return).
     */
    delete(key: K): void;

    /** Total number of entries across all keys. */
    size(): number;

    /** Returns the number of values for the given key. */
    valueCount(key: K): number;

    /** Returns the set of all keys. */
    keySet(): Set<K>;

    /** Returns all values as a flat array. */
    values(): V[];

    /** Returns all key-value entries as [key, value] pairs. */
    entrySet(): [K, V][];

    containsKey(key: K): boolean;
    containsValue(value: V): boolean;
    containsEntry(key: K, value: V): boolean;

    /** Removes all entries. */
    clear(): void;
}
