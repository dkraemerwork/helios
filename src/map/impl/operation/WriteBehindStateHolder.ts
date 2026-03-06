/**
 * Port of {@code com.hazelcast.map.impl.operation.WriteBehindStateHolder}.
 *
 * Captures write-behind queue state (delayed entries + flush sequences) for all maps
 * in a partition during replication, and applies the captured state to a destination.
 *
 * Note: asList() captures queue + staging area entries (Finding 10) to prevent data loss
 * for entries mid-flush. The staging area is NOT directly replicated — after applyState(),
 * entries are reconstructed from the queue via addForcibly().
 */
import type { DelayedEntry } from '@zenystx/helios-core/map/impl/mapstore/writebehind/DelayedEntry';
import type { WriteBehindStore } from '@zenystx/helios-core/map/impl/mapstore/writebehind/WriteBehindStore';

export class WriteBehindStateHolder {
    /** Per-map captured delayed entries. */
    readonly delayedEntries = new Map<string, DelayedEntry<unknown, unknown>[]>();
    /** Per-map captured flush sequences. */
    readonly flushSequences = new Map<string, Map<string, number>>();

    /**
     * Captures write-behind state from all provided stores.
     *
     * @param stores map of mapName → WriteBehindStore
     */
    prepare(stores: Map<string, WriteBehindStore<unknown, unknown>>): void {
        for (const [mapName, store] of stores) {
            this.delayedEntries.set(mapName, store.asList());
            this.flushSequences.set(mapName, store.getFlushSequences());
        }
    }

    /**
     * Applies captured state to destination stores.
     * Resets each store, restores flush sequences, adds entries via addForcibly,
     * and restarts the worker (Finding 8).
     *
     * @param stores map of mapName → WriteBehindStore (destination)
     */
    applyState(stores: Map<string, WriteBehindStore<unknown, unknown>>): void {
        for (const [mapName, entries] of this.delayedEntries) {
            const store = stores.get(mapName);
            if (!store) continue;

            store.reset();

            const seqs = this.flushSequences.get(mapName);
            if (seqs) {
                store.setFlushSequences(seqs);
            }

            for (const entry of entries) {
                store.queue.addForcibly(entry);
            }

            // Finding 8: restart worker after addForcibly loop
            store.worker.start();
        }
    }
}
