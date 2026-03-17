/**
 * Port of {@code com.hazelcast.ringbuffer.RingbufferStore}.
 * Persistence SPI for Ringbuffer.
 */
export interface RingbufferStore<T> {
    /** Store an item at a given sequence number. */
    store(sequence: bigint, data: T): Promise<void>;

    /** Store multiple items. */
    storeAll(items: Map<bigint, T>): Promise<void>;

    /** Load an item by sequence number. */
    load(sequence: bigint): Promise<T | null>;

    /** Load multiple items by sequence numbers. */
    loadAll(sequences: Set<bigint>): Promise<Map<bigint, T>>;

    /**
     * Return the largest sequence number in the store,
     * or -1n if the store is empty.
     */
    getLargestSequence(): Promise<bigint>;
}
