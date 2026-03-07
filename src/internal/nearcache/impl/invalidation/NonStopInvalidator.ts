/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.invalidation.NonStopInvalidator}.
 *
 * Sends invalidations to Near Caches immediately.
 */
import type { Invalidation } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/Invalidation';
import type { EventFilter, InvalidatorNodeEngine } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/Invalidator';
import { Invalidator } from '@zenystx/helios-core/internal/nearcache/impl/invalidation/Invalidator';

export class NonStopInvalidator extends Invalidator {
    constructor(serviceName: string, eventFilter: EventFilter, nodeEngine: InvalidatorNodeEngine) {
        super(serviceName, eventFilter, nodeEngine);
    }

    protected override invalidateInternal(invalidation: Invalidation, orderKey: number): void {
        this.sendImmediately(invalidation, orderKey);
    }
}
