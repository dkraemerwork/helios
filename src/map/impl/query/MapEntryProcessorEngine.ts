/**
 * Port of {@code com.hazelcast.map.impl.operation.MapOperationProvider} entry-processor path.
 *
 * Executes entry processors across all partitions or a specific key set.
 * Routes each key to its correct partition owner, runs the processor, and
 * merges results from all partitions.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data.js';
import type { EntryProcessor } from '@zenystx/helios-core/map/EntryProcessor.js';
import type { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService.js';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine.js';

export interface EntryProcessorEngine {
    /**
     * Execute a processor on the entry for a single key.
     * Routes to the partition owning that key.
     */
    executeOnKey<R>(mapName: string, key: Data, processor: EntryProcessor<R>): R | null;

    /**
     * Execute a processor on all entries in every partition.
     * @returns array of (key, result) pairs from all partitions.
     */
    executeOnEntries<R>(mapName: string, processor: EntryProcessor<R>): Array<readonly [Data, R | null]>;

    /**
     * Execute a processor on a specific set of keys.
     * Each key is routed to the correct partition.
     * @returns map from key → result.
     */
    executeOnKeys<R>(mapName: string, keys: Data[], processor: EntryProcessor<R>): Map<Data, R | null>;
}

export class MapEntryProcessorEngine implements EntryProcessorEngine {
    private readonly _containerService: MapContainerService;
    private readonly _nodeEngine: NodeEngine;

    constructor(containerService: MapContainerService, nodeEngine: NodeEngine) {
        this._containerService = containerService;
        this._nodeEngine = nodeEngine;
    }

    executeOnKey<R>(mapName: string, key: Data, processor: EntryProcessor<R>): R | null {
        const partitionId = this._nodeEngine.getPartitionService().getPartitionId(key);
        const store = this._containerService.getOrCreateRecordStore(mapName, partitionId);
        return store.executeOnKey(key, processor);
    }

    executeOnEntries<R>(mapName: string, processor: EntryProcessor<R>): Array<readonly [Data, R | null]> {
        const results: Array<readonly [Data, R | null]> = [];
        const partitionCount = this._nodeEngine.getPartitionService().getPartitionCount();

        for (let partitionId = 0; partitionId < partitionCount; partitionId++) {
            const store = this._containerService.getRecordStore(mapName, partitionId);
            if (store === null) continue;

            const partitionResults = store.executeOnEntries(processor);
            for (const pair of partitionResults) {
                results.push(pair);
            }
        }

        return results;
    }

    executeOnKeys<R>(mapName: string, keys: Data[], processor: EntryProcessor<R>): Map<Data, R | null> {
        // Group keys by partition to minimize store lookups
        const byPartition = new Map<number, Data[]>();
        const partitionService = this._nodeEngine.getPartitionService();

        for (const key of keys) {
            const partitionId = partitionService.getPartitionId(key);
            let partitionKeys = byPartition.get(partitionId);
            if (partitionKeys === undefined) {
                partitionKeys = [];
                byPartition.set(partitionId, partitionKeys);
            }
            partitionKeys.push(key);
        }

        const results = new Map<Data, R | null>();

        for (const [partitionId, partitionKeys] of byPartition) {
            const store = this._containerService.getOrCreateRecordStore(mapName, partitionId);
            for (const key of partitionKeys) {
                const result = store.executeOnKey(key, processor);
                results.set(key, result);
            }
        }

        return results;
    }
}
