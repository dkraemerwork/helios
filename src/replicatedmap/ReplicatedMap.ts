/**
 * Distributed replicated map interface.
 * Port of com.hazelcast.replicatedmap.ReplicatedMap (minimal surface for Block 7.3).
 */
export interface ReplicatedMap<K, V> {
    /** Returns the name of this replicated map. */
    getName(): string;

    /** Associates the given value with the given key. Returns the previous value or null. */
    put(key: K, value: V): V | null;

    /** Returns the value associated with the key, or null if not present. */
    get(key: K): V | null;

    /** Removes the mapping for the key. Returns the removed value or null. */
    remove(key: K): V | null;

    /** Returns true if a mapping for the key exists. */
    containsKey(key: K): boolean;

    /** Returns true if any key is mapped to the given value. */
    containsValue(value: V): boolean;

    /** Returns the number of mappings. */
    size(): number;

    /** Returns true if there are no mappings. */
    isEmpty(): boolean;

    /** Removes all mappings. */
    clear(): void;

    /** Returns all keys. */
    keySet(): K[];

    /** Returns all values. */
    values(): V[];

    /** Returns all key-value pairs. */
    entrySet(): [K, V][];

    /** Destroys this replicated map instance. */
    destroy(): void;
}
