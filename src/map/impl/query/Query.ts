/**
 * Port of {@code com.hazelcast.map.impl.query.Query}.
 *
 * Represents a query together with all variants: predicate, iterationType, etc.
 */
import type { Predicate } from '@zenystx/core/query/Predicate';
import type { PartitionIdSet } from '@zenystx/core/internal/util/collection/PartitionIdSet';
import { IterationType } from '@zenystx/core/internal/util/IterationType';

export class Query {
    private readonly _mapName: string;
    private readonly _predicate: Predicate;
    private readonly _iterationType: IterationType;
    private readonly _partitionIdSet: PartitionIdSet | null;

    constructor(
        mapName: string,
        predicate: Predicate,
        iterationType: IterationType,
        partitionIdSet?: PartitionIdSet | null,
    ) {
        if (!mapName) throw new Error('mapName must not be null/empty');
        if (!predicate) throw new Error('predicate must not be null');
        if (!iterationType) throw new Error('iterationType must not be null');
        this._mapName = mapName;
        this._predicate = predicate;
        this._iterationType = iterationType;
        this._partitionIdSet = partitionIdSet ?? null;
    }

    getMapName(): string { return this._mapName; }
    getPredicate(): Predicate { return this._predicate; }
    getIterationType(): IterationType { return this._iterationType; }
    getPartitionIdSet(): PartitionIdSet | null { return this._partitionIdSet; }

    static of(): QueryBuilder { return new QueryBuilder(); }
    static ofQuery(query: Query): QueryBuilder { return new QueryBuilder(query); }
}

export class QueryBuilder {
    private _mapName = '';
    private _predicate: Predicate | null = null;
    private _iterationType: IterationType = IterationType.ENTRY;
    private _partitionIdSet: PartitionIdSet | null = null;

    constructor(query?: Query) {
        if (query) {
            this._mapName = query.getMapName();
            this._predicate = query.getPredicate();
            this._iterationType = query.getIterationType();
            this._partitionIdSet = query.getPartitionIdSet();
        }
    }

    mapName(name: string): this { this._mapName = name; return this; }
    predicate(p: Predicate): this { this._predicate = p; return this; }
    iterationType(t: IterationType): this { this._iterationType = t; return this; }
    partitionIdSet(set: PartitionIdSet | null): this { this._partitionIdSet = set; return this; }

    build(): Query {
        if (!this._predicate) throw new Error('predicate is required');
        return new Query(this._mapName, this._predicate, this._iterationType, this._partitionIdSet);
    }
}
