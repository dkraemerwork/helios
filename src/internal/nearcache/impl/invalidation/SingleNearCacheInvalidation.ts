/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.SingleNearCacheInvalidation}.
 *
 * Represents a single Near Cache invalidation event.
 */
import { Invalidation } from '@helios/internal/nearcache/impl/invalidation/Invalidation';
import type { Data } from '@helios/internal/serialization/Data';

export class SingleNearCacheInvalidation extends Invalidation {
    private readonly _key: Data | null;

    constructor(
        key: Data | null,
        dataStructureName: string,
        sourceUuid: string | null,
        partitionUuid: string,
        sequence: number,
    ) {
        super(dataStructureName, sourceUuid, partitionUuid, sequence);
        this._key = key;
    }

    override getKey(): Data | null {
        return this._key;
    }

    override toString(): string {
        return `SingleNearCacheInvalidation{${super.toString()}, key=${this._key}}`;
    }
}
