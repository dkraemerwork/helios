/**
 * Port of {@code com.hazelcast.internal.cluster.impl.SplitBrainHandler}.
 * Orchestrates the merge flow when split-brain is healed.
 *
 * Iterates entries from the merging (smaller) cluster side, applies
 * the configured merge policy for each map, and mutates the surviving
 * cluster's record stores accordingly.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { MergePolicyProvider } from '@zenystx/helios-core/spi/merge/MergePolicyProvider';
import { SplitBrainMergeDataImpl } from '@zenystx/helios-core/spi/merge/SplitBrainMergeDataImpl';
import type { SplitBrainMergePolicy } from '@zenystx/helios-core/spi/merge/SplitBrainMergePolicy';

export interface MergeEntryStats {
    hits: number;
    creationTime: number;
    lastAccessTime: number;
    lastUpdateTime: number;
    expirationTime: number;
    version: number;
}

export interface MergeableRecordStore {
    put(key: Data, value: Data, ttl: number, maxIdle: number): Data | null;
    get(key: Data): Data | null;
    remove(key: Data): Data | null;
    entries(): IterableIterator<readonly [Data, Data]>;
    /** Returns the full stats for a key without touching access counters, or null if absent. */
    getEntryStats(key: Data): MergeEntryStats | null;
}

export interface MergeableMapStore {
    getAllEntries(mapName: string): IterableIterator<readonly [Data, Data]>;
    getRecordStore(mapName: string, partitionId: number): MergeableRecordStore | null;
    getMapNames(): string[];
}

export interface MergeResult {
    mapName: string;
    mergedCount: number;
    discardedCount: number;
    totalEntries: number;
}

export class SplitBrainMergeHandler {
    private readonly _policyProvider = new MergePolicyProvider();

    /**
     * Execute the merge for a single map.
     *
     * @param mapName — name of the map
     * @param policyName — merge policy to use
     * @param mergingEntries — entries from the merging (smaller) cluster side
     * @param existingStore — the surviving cluster's map container service
     * @param partitionResolver — function to resolve partition ID from key Data
     */
    mergeMap(
        mapName: string,
        policyName: string,
        mergingEntries: IterableIterator<readonly [Data, Data]>,
        existingStore: MergeableMapStore,
        partitionResolver: (key: Data) => number,
    ): MergeResult {
        const policy: SplitBrainMergePolicy = this._policyProvider.getMergePolicy(policyName);
        let mergedCount = 0;
        let discardedCount = 0;
        let totalEntries = 0;

        for (const [mergingKey, mergingValue] of mergingEntries) {
            totalEntries++;

            const mergingData = new SplitBrainMergeDataImpl(mergingKey, mergingValue);

            const partitionId = partitionResolver(mergingKey);
            const store = existingStore.getRecordStore(mapName, partitionId);
            const existingRawValue = store?.get(mergingKey) ?? null;
            let existingData: SplitBrainMergeDataImpl | null = null;
            if (existingRawValue !== null && store !== null) {
                const stats = store.getEntryStats(mergingKey);
                existingData = new SplitBrainMergeDataImpl(
                    mergingKey,
                    existingRawValue,
                    stats?.hits ?? 0,
                    stats?.creationTime ?? 0,
                    stats?.lastAccessTime ?? 0,
                    stats?.lastUpdateTime ?? 0,
                    stats?.expirationTime ?? Number.MAX_SAFE_INTEGER,
                    stats?.version ?? 0,
                );
            }

            const winner = policy.merge(mergingData, existingData);

            if (winner === null) {
                // Policy decided to discard — remove from existing store if present
                store?.remove(mergingKey);
                discardedCount++;
            } else if (winner === mergingData) {
                // Merging value wins — put into surviving store
                store?.put(mergingKey, mergingValue, -1, -1);
                mergedCount++;
            } else {
                // Existing value wins — no change needed
                discardedCount++;
            }
        }

        return { mapName, mergedCount, discardedCount, totalEntries };
    }

    /**
     * Execute merge for all maps in the merging store.
     *
     * @param policyNameResolver — returns the merge policy name for a given map name
     * @param mergingStore — the map store from the merging (smaller) cluster
     * @param existingStore — the surviving cluster's map container service
     * @param partitionResolver — function to resolve partition ID from key Data
     */
    mergeAll(
        policyNameResolver: (mapName: string) => string,
        mergingStore: MergeableMapStore,
        existingStore: MergeableMapStore,
        partitionResolver: (key: Data) => number,
    ): MergeResult[] {
        const results: MergeResult[] = [];
        for (const mapName of mergingStore.getMapNames()) {
            const policyName = policyNameResolver(mapName);
            const entries = mergingStore.getAllEntries(mapName);
            const result = this.mergeMap(mapName, policyName, entries, existingStore, partitionResolver);
            results.push(result);
        }
        return results;
    }

    getAvailablePolicies(): string[] {
        return this._policyProvider.getAvailablePolicies();
    }
}
