/**
 * Port of {@code com.hazelcast.map.impl.query.QueryEngine} (interface + single-node impl).
 *
 * Executes predicate-based queries against local partition stores.
 *
 * In Phase 3 (single-node), all partitions are local: the engine scans all
 * RecordStores owned by MapContainerService and applies the predicate.
 */
import type { Predicate } from '@helios/query/Predicate';
import type { MapContainerService } from '@helios/map/impl/MapContainerService';
import { IterationType } from '@helios/internal/util/IterationType';
import { QueryResult } from '@helios/map/impl/query/QueryResult';
import { QueryResultRow } from '@helios/map/impl/query/QueryResultRow';
import type { Data } from '@helios/internal/serialization/Data';
import type { QueryableEntry } from '@helios/query/impl/QueryableEntry';

/** Minimal interface — expanded in later blocks. */
export interface QueryEngine {
    /**
     * Execute a predicate query against the named map on all local partitions.
     * Returns a QueryResult containing matching rows.
     */
    executeOnLocalPartitions(
        mapName: string,
        predicate: Predicate,
        iterationType: IterationType,
    ): QueryResult;
}

/**
 * Simple scan-based implementation for single-node use.
 * Uses {@link MapContainerService} to iterate all (partitionId, store) pairs.
 */
export class MapQueryEngineImpl implements QueryEngine {
    private readonly _containerService: MapContainerService;

    constructor(containerService: MapContainerService) {
        this._containerService = containerService;
    }

    executeOnLocalPartitions(
        mapName: string,
        predicate: Predicate,
        iterationType: IterationType,
    ): QueryResult {
        const result = new QueryResult(iterationType, Number.MAX_SAFE_INTEGER, false, null);

        // Iterate over all (key, value) pairs in the store for mapName
        // MapContainerService exposes stores keyed by (mapName, partitionId).
        // We access all known stores via the internal API.
        for (const [key, value] of this._iterateMapEntries(mapName)) {
            const entry = this._toQueryableEntry(key, value);
            if (predicate.apply(entry)) {
                result.addRow(this._toRow(entry, iterationType));
            }
        }

        return result;
    }

    private *_iterateMapEntries(mapName: string): Iterable<readonly [Data, Data]> {
        // Access stores for all known partition IDs via MapContainerService.
        // The container service exposes a way to iterate via getOrCreateRecordStore.
        // We use the internal _stores map indirectly by iterating known partitions.
        // For single-node, we iterate over all stores that exist for mapName.
        const entries = this._containerService.getAllEntries(mapName);
        yield* entries;
    }

    private _toQueryableEntry(key: Data, value: Data): QueryableEntry<Data, Data> {
        return {
            getKey: () => key,
            getValue: () => value,
            getAttributeValue: (attr: string) => {
                if (attr === '__key') return key;
                if (attr === 'this') return value;
                return undefined;
            },
        };
    }

    private _toRow(entry: QueryableEntry<Data, Data>, iterationType: IterationType): QueryResultRow {
        const key = iterationType === IterationType.KEY || iterationType === IterationType.ENTRY
            ? entry.getKey() : null;
        const value = iterationType === IterationType.VALUE || iterationType === IterationType.ENTRY
            ? entry.getValue() : null;
        return new QueryResultRow(key, value);
    }
}
