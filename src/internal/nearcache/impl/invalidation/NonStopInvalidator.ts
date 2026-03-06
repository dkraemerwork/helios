/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.NonStopInvalidator}.
 *
 * Sends invalidations to Near Caches immediately.
 */
import { Invalidator } from '@zenystx/core/internal/nearcache/impl/invalidation/Invalidator';
import type { Invalidation } from '@zenystx/core/internal/nearcache/impl/invalidation/Invalidation';
import type { EventFilter, InvalidatorNodeEngine } from '@zenystx/core/internal/nearcache/impl/invalidation/Invalidator';

export class NonStopInvalidator extends Invalidator {
    constructor(serviceName: string, eventFilter: EventFilter, nodeEngine: InvalidatorNodeEngine) {
        super(serviceName, eventFilter, nodeEngine);
    }

    protected override invalidateInternal(invalidation: Invalidation, orderKey: number): void {
        this.sendImmediately(invalidation, orderKey);
    }
}
