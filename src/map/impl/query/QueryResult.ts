/**
 * Port of {@code com.hazelcast.map.impl.query.QueryResult}.
 *
 * Represents a result of a query execution as an iterable collection of rows.
 * Optionally applies a {@link Projection} to transform entries before adding them as rows.
 */
import type { LocalMapStatsImpl } from '@zenystx/helios-core/internal/monitor/impl/LocalMapStatsImpl';
import type { PartitionIdSet } from '@zenystx/helios-core/internal/util/collection/PartitionIdSet';
import { IterationType } from '@zenystx/helios-core/internal/util/IterationType';
import { QueryResultRow } from '@zenystx/helios-core/map/impl/query/QueryResultRow';
import { QueryResultSizeExceededException } from '@zenystx/helios-core/map/QueryResultSizeExceededException';
import type { QueryableEntry } from '@zenystx/helios-core/query/impl/QueryableEntry';
import type { Projection } from '@zenystx/helios-core/projection/Projection';
import type { SerializationService } from '@zenystx/helios-core/internal/serialization/SerializationService';

export class QueryResult implements Iterable<QueryResultRow> {
    private _rows: QueryResultRow[] = [];
    private _partitionIds: PartitionIdSet | null = null;

    private readonly _iterationType: IterationType;
    private readonly _resultLimit: number;
    private readonly _orderAndLimitExpected: boolean;
    private readonly _mapStats: LocalMapStatsImpl | null;
    private readonly _projection: Projection<unknown, unknown> | null;
    private readonly _serializationService: SerializationService | null;

    private _resultSize = 0;

    /** No-arg constructor for deserialization. */
    constructor();
    constructor(
        iterationType: IterationType,
        resultLimit: number,
        orderAndLimitExpected: boolean,
        mapStats?: LocalMapStatsImpl | null,
        projection?: Projection<unknown, unknown> | null,
        serializationService?: SerializationService | null,
    );
    constructor(
        iterationType?: IterationType,
        resultLimit?: number,
        orderAndLimitExpected?: boolean,
        mapStats?: LocalMapStatsImpl | null,
        projection?: Projection<unknown, unknown> | null,
        serializationService?: SerializationService | null,
    ) {
        this._iterationType = iterationType ?? IterationType.ENTRY;
        this._resultLimit = resultLimit ?? Number.MAX_SAFE_INTEGER;
        this._orderAndLimitExpected = orderAndLimitExpected ?? false;
        this._mapStats = mapStats ?? null;
        this._projection = projection ?? null;
        this._serializationService = serializationService ?? null;
    }

    // ── for testing ──────────────────────────────────────────────────────────

    getIterationType(): IterationType { return this._iterationType; }

    // ── Iterable ─────────────────────────────────────────────────────────────

    [Symbol.iterator](): Iterator<QueryResultRow> {
        return this._rows[Symbol.iterator]();
    }

    // ── public API ──────────────────────────────────────────────────────────

    size(): number { return this._rows.length; }

    isEmpty(): boolean { return this._rows.length === 0; }

    addRow(row: QueryResultRow): void {
        this._rows.push(row);
    }

    /** Add a QueryableEntry, enforcing the result size limit. */
    add(entry: QueryableEntry): void {
        if (++this._resultSize > this._resultLimit) {
            this._mapStats?.incrementQueryResultSizeExceededCount();
            throw new QueryResultSizeExceededException();
        }
        this._rows.push(this._convertEntryToRow(entry));
    }

    createSubResult(): QueryResult {
        return new QueryResult(
            this._iterationType, this._resultLimit, this._orderAndLimitExpected,
            this._mapStats, this._projection, this._serializationService,
        );
    }

    completeConstruction(partitionIds: PartitionIdSet): void {
        this._partitionIds = partitionIds;
    }

    getPartitionIds(): PartitionIdSet | null { return this._partitionIds; }

    setPartitionIds(partitionIds: PartitionIdSet): void {
        this._partitionIds = partitionIds;
    }

    combine(result: QueryResult): void {
        const other = result.getPartitionIds();
        if (other === null) return;
        if (this._partitionIds === null) {
            this._partitionIds = new (other.constructor as new (src: PartitionIdSet) => PartitionIdSet)(other);
        } else {
            this._partitionIds.addAll(other);
        }
        this._rows = [...this._rows, ...result._rows];
    }

    getRows(): QueryResultRow[] { return this._rows; }

    private _convertEntryToRow(entry: QueryableEntry): QueryResultRow {
        const key = this._iterationType === IterationType.KEY || this._iterationType === IterationType.ENTRY
            ? (entry.getKey() as import('@zenystx/helios-core/internal/serialization/Data').Data ?? null)
            : null;
        const value = this._getValueData(entry);
        return new QueryResultRow(key, value);
    }

    /**
     * Returns the value Data for a row. If a projection is set, the entry is
     * transformed through the projection and re-serialized; otherwise the
     * raw entry value is returned.
     */
    private _getValueData(entry: QueryableEntry): import('@zenystx/helios-core/internal/serialization/Data').Data | null {
        if (this._iterationType === IterationType.KEY) return null;
        if (this._projection !== null && this._serializationService !== null) {
            const transformed = this._projection.transform(entry);
            return this._serializationService.toData(transformed);
        }
        return entry.getValue() as import('@zenystx/helios-core/internal/serialization/Data').Data ?? null;
    }
}
