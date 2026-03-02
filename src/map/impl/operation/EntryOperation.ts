/**
 * Port of {@code com.hazelcast.map.impl.operation.EntryOperation}.
 *
 * Executes an EntryProcessor on a single key.
 * Applies any setValue() mutation atomically and sends the processor's result.
 */
import type { Data } from '@helios/internal/serialization/Data';
import type { EntryProcessor } from '@helios/map/EntryProcessor';
import { MapOperation } from '@helios/map/impl/operation/MapOperation';

export class EntryOperation<R = unknown> extends MapOperation {
    private readonly _key: Data;
    private readonly _processor: EntryProcessor<R>;

    constructor(mapName: string, key: Data, processor: EntryProcessor<R>) {
        super(mapName);
        this._key = key;
        this._processor = processor;
    }

    async run(): Promise<void> {
        this.sendResponse(this.recordStore.executeOnKey(this._key, this._processor));
    }
}
