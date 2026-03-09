/**
 * Port of {@code com.hazelcast.map.impl.recordstore.RecordStore} (minimal surface).
 *
 * Per-partition in-memory store for a single IMap. Holds the actual key→value
 * records and provides the basic CRUD + batch + entry-processor operations needed
 * by the Block 3.2b map operation classes.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { EntryProcessor } from '@zenystx/helios-core/map/EntryProcessor';
import type { SimpleEntryView } from '@zenystx/helios-core/map/impl/SimpleEntryView';

export interface RecordStore {
    // ── point ops ──────────────────────────────────────────────────────────

    /** Returns the serialized value for key, or null if absent. */
    get(key: Data): Data | null;

    /**
     * Stores (key → value) and returns the old value (or null if new).
     * Matches Java {@code RecordStore.put(Data, Object, long, long)}.
     */
    put(key: Data, value: Data, ttl: number, maxIdle: number): Data | null;

    /**
     * Stores (key → value) without returning the old value.
     * Matches Java {@code RecordStore.set(Data, Object, long, long)}.
     */
    set(key: Data, value: Data, ttl: number, maxIdle: number): void;

    /**
     * Inserts (key → value) only when key is absent.
     * Returns null on success (entry was new); returns the existing value otherwise.
     * Matches Java {@code RecordStore.putIfAbsent(Data, Object, long, long, Address)}.
     */
    putIfAbsent(key: Data, value: Data, ttl: number, maxIdle: number): Data | null;

    replace(key: Data, value: Data, ttl: number, maxIdle: number): Data | null;

    removeIfSame(key: Data, value: Data): boolean;

    /** Removes key and returns the old value, or null if absent. */
    remove(key: Data): Data | null;

    /**
     * Removes key without returning the old value.
     * @returns true if the key existed (and was removed), false otherwise.
     */
    delete(key: Data): boolean;

    /** True if key is present in the store. */
    containsKey(key: Data): boolean;

    /** True if any entry has a value that equals the given value. */
    containsValue(value: Data): boolean;

    // ── batch ops ──────────────────────────────────────────────────────────

    /** Stores all (key, value) pairs. */
    putAll(entries: ReadonlyArray<readonly [Data, Data]>): void;

    /**
     * Fetches values for all requested keys.
     * Missing keys produce a null in the second element of the pair.
     */
    getAll(keys: ReadonlyArray<Data>): Array<readonly [Data, Data | null]>;

    // ── entry processor ─────────────────────────────────────────────────────

    /**
     * Run processor on the entry for key, apply any setValue() mutations,
     * and return the processor's result.
     */
    executeOnKey<R>(key: Data, processor: EntryProcessor<R>): R | null;

    /**
     * Run processor on every entry in this partition.
     * Mutations (setValue) are applied before the next entry is visited.
     * @returns array of (key, result) pairs in iteration order.
     */
    executeOnEntries<R>(processor: EntryProcessor<R>): Array<readonly [Data, R | null]>;

    evict(key: Data): boolean;

    getEntryView(key: Data): SimpleEntryView<Data, Data> | null;

    setTtl(key: Data, ttl: number): boolean;

    // ── metadata ────────────────────────────────────────────────────────────

    /** Number of entries in this partition store. */
    size(): number;

    /** True when the store holds no entries. */
    isEmpty(): boolean;

    /** Remove all entries. */
    clear(): void;

    /** Iterate over all (key, value) pairs. */
    entries(): IterableIterator<readonly [Data, Data]>;
}
