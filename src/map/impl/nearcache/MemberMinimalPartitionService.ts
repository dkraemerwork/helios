/**
 * Port of {@code com.hazelcast.map.impl.nearcache.MemberMinimalPartitionService}.
 *
 * Member-side implementation of {@link MinimalPartitionService}.
 * Delegates partition ID lookups and partition count to the wrapped partition service.
 */
import type { MinimalPartitionService } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/MinimalPartitionService';

/** Minimal interface needed from the wrapped partition service. */
export interface PartitionServiceLike {
    getPartitionCount(): number;
    getPartitionId(key: unknown): number;
}

export class MemberMinimalPartitionService implements MinimalPartitionService {
    private readonly _partitionService: PartitionServiceLike;

    constructor(partitionService: PartitionServiceLike) {
        this._partitionService = partitionService;
    }

    getPartitionId(key: unknown): number {
        return this._partitionService.getPartitionId(key);
    }

    getPartitionCount(): number {
        return this._partitionService.getPartitionCount();
    }
}
