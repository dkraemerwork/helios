/**
 * Port of {@code com.hazelcast.map.impl.query.QueryEngine} (interface + full impl).
 *
 * Executes predicate-based queries against local partition stores with:
 * - Predicate + projection fan-out across all partition owners
 * - Paging predicate support (anchor-based pagination)
 * - Aggregations: count, sum, avg, min, max, distinct values
 *
 * In Phase 3 (single-node), all partitions are local.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { IterationType } from '@zenystx/helios-core/internal/util/IterationType';
import type { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService';
import { QueryResult } from '@zenystx/helios-core/map/impl/query/QueryResult';
import { QueryResultRow } from '@zenystx/helios-core/map/impl/query/QueryResultRow';
import type { QueryableEntry } from '@zenystx/helios-core/query/impl/QueryableEntry';
import { MultiPartitionPredicateImpl } from '@zenystx/helios-core/query/impl/predicates/MultiPartitionPredicateImpl';
import { PartitionPredicateImpl } from '@zenystx/helios-core/query/impl/predicates/PartitionPredicateImpl';
import type { Predicate } from '@zenystx/helios-core/query/Predicate';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine';

/** Anchor record used for paging predicate continuation. */
export interface PagingAnchor {
    readonly key: Data;
    readonly value: Data;
}

/**
 * Paging predicate wraps a regular predicate, adds a page size and optional anchor.
 * Enables cursor-style pagination over map entries.
 */
export interface PagingPredicate extends Predicate {
    readonly pageSize: number;
    readonly anchor: PagingAnchor | null;
    /** Comparator for ordering — null = natural ordering by key serialized bytes. */
    readonly comparator: ((a: QueryResultRow, b: QueryResultRow) => number) | null;
}

export function isPagingPredicate(p: Predicate): p is PagingPredicate {
    return 'pageSize' in p && typeof (p as PagingPredicate).pageSize === 'number';
}

/** Type guard: checks if a predicate is a partition predicate (single or multi). */
export function isPartitionPredicate(p: Predicate): p is PartitionPredicateImpl | MultiPartitionPredicateImpl {
    return p instanceof PartitionPredicateImpl || p instanceof MultiPartitionPredicateImpl;
}

/** Aggregation types supported by the engine. */
export type AggregationType = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'distinct';

export interface AggregationRequest {
    readonly type: AggregationType;
    /** Attribute path to extract from each value, e.g. "salary". Null = use the whole value. */
    readonly attribute: string | null;
}

export interface AggregationResult {
    readonly type: AggregationType;
    readonly count: number;
    readonly sum: number;
    readonly avg: number;
    readonly min: number | null;
    readonly max: number | null;
    readonly distinctValues: Set<unknown>;
}

/** Minimal interface — can be widened in later blocks. */
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

    /**
     * Execute a paging predicate and return one page of results.
     * The caller should persist the last row of the result as the anchor for the next page.
     */
    executeOnLocalPartitionsWithPaging(
        mapName: string,
        predicate: PagingPredicate,
        iterationType: IterationType,
    ): QueryResult;

    /**
     * Execute an aggregation across all entries matching the predicate.
     */
    aggregate(
        mapName: string,
        predicate: Predicate,
        aggregation: AggregationRequest,
        nodeEngine: NodeEngine,
    ): AggregationResult;
}

/**
 * Full query engine implementation for single-node use.
 * Uses {@link MapContainerService} to iterate all (partitionId, store) pairs.
 */
export class MapQueryEngineImpl implements QueryEngine {
    private readonly _containerService: MapContainerService;
    private readonly _nodeEngine: NodeEngine | null;

    constructor(containerService: MapContainerService, nodeEngine?: NodeEngine | null) {
        this._containerService = containerService;
        this._nodeEngine = nodeEngine ?? null;
    }

    executeOnLocalPartitions(
        mapName: string,
        predicate: Predicate,
        iterationType: IterationType,
    ): QueryResult {
        const result = new QueryResult(iterationType, Number.MAX_SAFE_INTEGER, false, null);

        let targetPredicate = predicate;
        let entries: IterableIterator<readonly [Data, Data]>;

        if (isPartitionPredicate(predicate)) {
            targetPredicate = predicate.getTarget();
            const partitionIds = this._resolvePartitionIds(predicate.getPartitionKeys());
            entries = this._containerService.getEntriesForPartitions(mapName, partitionIds);
        } else {
            entries = this._containerService.getAllEntries(mapName);
        }

        for (const [key, value] of entries) {
            const entry = this._toQueryableEntry(key, value);
            if (targetPredicate.apply(entry)) {
                result.addRow(this._toRow(entry, iterationType));
            }
        }

        return result;
    }

    executeOnLocalPartitionsWithPaging(
        mapName: string,
        predicate: PagingPredicate,
        iterationType: IterationType,
    ): QueryResult {
        // Collect all matching entries first
        const matching: Array<readonly [Data, Data]> = [];
        for (const [key, value] of this._containerService.getAllEntries(mapName)) {
            const entry = this._toQueryableEntry(key, value);
            if (predicate.apply(entry)) {
                matching.push([key, value] as const);
            }
        }

        // Sort matching entries
        const comparator = predicate.comparator ?? this._defaultComparator;
        const rows = matching.map(([k, v]) => this._toRowFromData(k, v, iterationType));
        rows.sort((a, b) => comparator(a, b));

        // Apply anchor-based pagination: skip rows that come before/at the anchor
        let startIndex = 0;
        if (predicate.anchor !== null) {
            const anchorRow = this._toRowFromData(predicate.anchor.key, predicate.anchor.value, iterationType);
            for (let i = 0; i < rows.length; i++) {
                if (comparator(rows[i], anchorRow) > 0) {
                    startIndex = i;
                    break;
                }
                startIndex = rows.length; // anchor is at or beyond end
            }
        }

        const result = new QueryResult(iterationType, Number.MAX_SAFE_INTEGER, false, null);
        const endIndex = Math.min(startIndex + predicate.pageSize, rows.length);
        for (let i = startIndex; i < endIndex; i++) {
            result.addRow(rows[i]);
        }

        return result;
    }

    aggregate(
        mapName: string,
        predicate: Predicate,
        aggregation: AggregationRequest,
        nodeEngine: NodeEngine,
    ): AggregationResult {
        let count = 0;
        let sum = 0;
        let min: number | null = null;
        let max: number | null = null;
        const distinctValues = new Set<unknown>();

        let targetPredicate = predicate;
        let entries: IterableIterator<readonly [Data, Data]>;

        if (isPartitionPredicate(predicate)) {
            targetPredicate = predicate.getTarget();
            const partitionIds = this._resolvePartitionIds(predicate.getPartitionKeys());
            entries = this._containerService.getEntriesForPartitions(mapName, partitionIds);
        } else {
            entries = this._containerService.getAllEntries(mapName);
        }

        for (const [key, valueData] of entries) {
            const entry = this._toQueryableEntry(key, valueData);
            if (!targetPredicate.apply(entry)) continue;

            count++;

            // Extract the attribute value for numeric aggregations
            let attrValue: unknown;
            if (aggregation.attribute !== null) {
                attrValue = entry.getAttributeValue(aggregation.attribute);
            } else {
                // Use the deserialized value for 'distinct'
                attrValue = nodeEngine.toObject(valueData);
            }

            if (aggregation.type === 'distinct') {
                distinctValues.add(attrValue);
                continue;
            }

            const num = typeof attrValue === 'number' ? attrValue : Number(attrValue);
            if (isNaN(num)) continue;

            sum += num;
            if (min === null || num < min) min = num;
            if (max === null || num > max) max = num;
        }

        return {
            type: aggregation.type,
            count,
            sum,
            avg: count > 0 ? sum / count : 0,
            min,
            max,
            distinctValues,
        };
    }

    private _resolvePartitionIds(partitionKeys: unknown[]): Set<number> {
        const partitionIds = new Set<number>();
        if (this._nodeEngine === null) {
            return partitionIds;
        }
        for (const key of partitionKeys) {
            const keyData = this._nodeEngine.toData(key);
            if (keyData !== null) {
                partitionIds.add(this._nodeEngine.getPartitionService().getPartitionId(keyData));
            }
        }
        return partitionIds;
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
        return this._toRowFromData(entry.getKey(), entry.getValue(), iterationType);
    }

    private _toRowFromData(key: Data, value: Data, iterationType: IterationType): QueryResultRow {
        const rowKey = iterationType === IterationType.KEY || iterationType === IterationType.ENTRY
            ? key : null;
        const rowValue = iterationType === IterationType.VALUE || iterationType === IterationType.ENTRY
            ? value : null;
        return new QueryResultRow(rowKey, rowValue);
    }

    private _defaultComparator(a: QueryResultRow, b: QueryResultRow): number {
        const ak = a.getKey();
        const bk = b.getKey();
        if (ak === null && bk === null) return 0;
        if (ak === null) return -1;
        if (bk === null) return 1;
        const aBytes = ak.toByteArray();
        const bBytes = bk.toByteArray();
        if (aBytes === null && bBytes === null) return 0;
        if (aBytes === null) return -1;
        if (bBytes === null) return 1;
        const len = Math.min(aBytes.length, bBytes.length);
        for (let i = 0; i < len; i++) {
            const diff = aBytes[i] - bBytes[i];
            if (diff !== 0) return diff;
        }
        return aBytes.length - bBytes.length;
    }
}
