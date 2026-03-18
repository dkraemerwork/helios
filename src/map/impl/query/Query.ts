/**
 * Port of {@code com.hazelcast.map.impl.query.Query}.
 *
 * Represents a query together with all variants: predicate, iterationType,
 * aggregator, and projection.
 *
 * Aggregator and Projection are mutually exclusive — providing both will throw.
 */
import type { PartitionIdSet } from '@zenystx/helios-core/internal/util/collection/PartitionIdSet';
import { IterationType } from '@zenystx/helios-core/internal/util/IterationType';
import type { Predicate } from '@zenystx/helios-core/query/Predicate';
import type { Projection } from '@zenystx/helios-core/projection/Projection';

export class Query {
    private readonly _mapName: string;
    private readonly _predicate: Predicate;
    private readonly _iterationType: IterationType;
    private readonly _partitionIdSet: PartitionIdSet | null;
    private readonly _projection: Projection<unknown, unknown> | null;

    constructor(
        mapName: string,
        predicate: Predicate,
        iterationType: IterationType,
        partitionIdSet?: PartitionIdSet | null,
        projection?: Projection<unknown, unknown> | null,
    ) {
        if (!mapName) throw new Error('mapName must not be null/empty');
        if (!predicate) throw new Error('predicate must not be null');
        if (!iterationType) throw new Error('iterationType must not be null');
        this._mapName = mapName;
        this._predicate = predicate;
        this._iterationType = iterationType;
        this._partitionIdSet = partitionIdSet ?? null;
        this._projection = projection ?? null;
    }

    getMapName(): string { return this._mapName; }
    getPredicate(): Predicate { return this._predicate; }
    getIterationType(): IterationType { return this._iterationType; }
    getPartitionIdSet(): PartitionIdSet | null { return this._partitionIdSet; }
    getProjection(): Projection<unknown, unknown> | null { return this._projection; }
    isProjectionQuery(): boolean { return this._projection !== null; }

    static of(): QueryBuilder { return new QueryBuilder(); }
    static ofQuery(query: Query): QueryBuilder { return new QueryBuilder(query); }
}

export class QueryBuilder {
    private _mapName = '';
    private _predicate: Predicate | null = null;
    private _iterationType: IterationType = IterationType.ENTRY;
    private _partitionIdSet: PartitionIdSet | null = null;
    private _projection: Projection<unknown, unknown> | null = null;

    constructor(query?: Query) {
        if (query) {
            this._mapName = query.getMapName();
            this._predicate = query.getPredicate();
            this._iterationType = query.getIterationType();
            this._partitionIdSet = query.getPartitionIdSet();
            this._projection = query.getProjection();
        }
    }

    mapName(name: string): this { this._mapName = name; return this; }
    predicate(p: Predicate): this { this._predicate = p; return this; }
    iterationType(t: IterationType): this { this._iterationType = t; return this; }
    partitionIdSet(set: PartitionIdSet | null): this { this._partitionIdSet = set; return this; }
    projection(p: Projection<unknown, unknown> | null): this { this._projection = p; return this; }

    build(): Query {
        if (!this._predicate) throw new Error('predicate is required');
        return new Query(this._mapName, this._predicate, this._iterationType, this._partitionIdSet, this._projection);
    }
}
