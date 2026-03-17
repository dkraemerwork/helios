/**
 * Port of {@code com.hazelcast.cp.CPMap}.
 *
 * A linearizable, distributed key-value map backed by the Raft consensus
 * protocol. Provides strong consistency guarantees (CP) unlike AP IMap.
 */
export interface CPMap<K, V> {
    /**
     * Puts a key-value pair. Returns the previous value, or null if none.
     */
    put(key: K, value: V): Promise<V | null>;

    /**
     * Sets a key-value pair (void return — no previous value).
     */
    set(key: K, value: V): Promise<void>;

    /**
     * Gets the value for a key, or null if absent.
     */
    get(key: K): Promise<V | null>;

    /**
     * Removes a key. Returns the previous value, or null if none.
     */
    remove(key: K): Promise<V | null>;

    /**
     * Deletes a key (void return — no previous value).
     */
    delete(key: K): Promise<void>;

    /**
     * Puts only if the key is not already present.
     * Returns the existing value if present, or null if put succeeded.
     */
    putIfAbsent(key: K, value: V): Promise<V | null>;

    /**
     * Atomically sets the value for a key if the current value matches the expected value.
     * Returns true if the value was replaced.
     */
    compareAndSet(key: K, expectedValue: V, newValue: V): Promise<boolean>;

    /** Returns the name of this CPMap. */
    getName(): string;

    /** Destroys this CPMap. */
    destroy(): Promise<void>;
}
