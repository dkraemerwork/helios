/**
 * Port of {@code com.hazelcast.collection.QueueStore}.
 * Persistence SPI for DistributedQueue.
 */
export interface QueueStore<T> {
    /** Store an item with its queue ID. */
    store(key: number, value: T): Promise<void>;

    /** Store multiple items. */
    storeAll(map: Map<number, T>): Promise<void>;

    /** Delete an item by queue ID. */
    delete(key: number): Promise<void>;

    /** Delete multiple items. */
    deleteAll(keys: Set<number>): Promise<void>;

    /** Load an item by its queue ID. */
    load(key: number): Promise<T | null>;

    /** Load multiple items. Returns a map of ID → value. */
    loadAll(keys: Set<number>): Promise<Map<number, T>>;

    /** Load all keys from the store (for initial population). */
    loadAllKeys(): Promise<Set<number>>;
}
