/**
 * Port of {@code com.hazelcast.map.impl.operation.PutOperation}.
 *
 * Stores (key → value) and sends the previous value (or null if new).
 */
import type { Data } from '@helios/internal/serialization/Data';
import { MapOperation } from '@helios/map/impl/operation/MapOperation';

export class PutOperation extends MapOperation {
    private readonly _key: Data;
    private readonly _value: Data;
    private readonly _ttl: number;
    private readonly _maxIdle: number;

    constructor(mapName: string, key: Data, value: Data, ttl: number, maxIdle: number) {
        super(mapName);
        this._key = key;
        this._value = value;
        this._ttl = ttl;
        this._maxIdle = maxIdle;
    }

    async run(): Promise<void> {
        this.sendResponse(
            this.recordStore.put(this._key, this._value, this._ttl, this._maxIdle),
        );
    }
}
