/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.BatchNearCacheInvalidation}.
 *
 * Represents a batch of Near Cache invalidation events.
 */
import { Invalidation } from '@helios/internal/nearcache/impl/invalidation/Invalidation';

export class BatchNearCacheInvalidation extends Invalidation {
    private readonly _invalidations: Invalidation[];

    constructor(dataStructureName: string, invalidations: Invalidation[]) {
        super(dataStructureName);
        this._invalidations = invalidations;
    }

    getInvalidations(): Invalidation[] {
        return this._invalidations;
    }

    override toString(): string {
        return `BatchNearCacheInvalidation{name='${this.getName()}', count=${this._invalidations.length}}`;
    }
}
