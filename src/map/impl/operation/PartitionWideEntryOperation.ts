/**
 * Port of {@code com.hazelcast.map.impl.operation.PartitionWideEntryOperation}.
 *
 * Executes an EntryProcessor on every entry in this partition.
 * Sends a Map<Data, R | null> of (key → result) pairs.
 *
 * In single-node operation this is equivalent to executeOnEntries with no predicate.
 * For predicate-filtered execution see PartitionWideEntryWithPredicateOperation
 * (deferred to a later block once query infrastructure is available).
 */
import type { EntryProcessor } from '@zenystx/helios-core/map/EntryProcessor';
import { MapOperation } from '@zenystx/helios-core/map/impl/operation/MapOperation';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';

export class PartitionWideEntryOperation<R = unknown> extends MapOperation {
    private readonly _processor: EntryProcessor<R>;

    constructor(mapName: string, processor: EntryProcessor<R>) {
        super(mapName);
        this._processor = processor;
    }

    async run(): Promise<void> {
        const pairs = this.recordStore.executeOnEntries(this._processor);
        // Return as Map<Data, R | null> matching Java's Map<Data, Object> response.
        const result = new Map<Data, R | null>(pairs);
        this.sendResponse(result);
    }
}
