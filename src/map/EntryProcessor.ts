/**
 * Port of {@code com.hazelcast.map.EntryProcessor}.
 *
 * Runs atomically on the partition thread that owns the entry's key.
 * Call entry.setValue() to modify the entry; return a result of type R.
 */
import type { Data } from '@zenystx/core/internal/serialization/Data';

/**
 * An entry view passed to {@link EntryProcessor.process}.
 * Changes via setValue() are applied atomically to the RecordStore.
 */
export interface MapEntry {
    /** The serialized key for this entry. */
    getKey(): Data;

    /** The current serialized value, or null if the entry does not exist. */
    getValue(): Data | null;

    /**
     * Set the new value for this entry.
     * Pass null to remove the entry.
     */
    setValue(value: Data | null): void;

    /** True if this entry currently exists in the map. */
    exists(): boolean;
}

/**
 * Port of {@code com.hazelcast.map.EntryProcessor<K, V, R>}.
 *
 * Executed per-entry on the partition owning thread.
 * Implement {@link process} to read and/or mutate the entry via the MapEntry view.
 */
export interface EntryProcessor<R = unknown> {
    /**
     * Execute on the given entry.
     * @param entry — mutable view; call setValue() to persist changes.
     * @returns the result to return to the caller, or null.
     */
    process(entry: MapEntry): R | null;

    /**
     * Returns the backup processor to run on backup replicas, or null if none.
     * For single-node operation backups are not applicable; return null.
     */
    getBackupProcessor(): EntryProcessor<R> | null;
}
