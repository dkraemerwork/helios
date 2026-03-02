/**
 * Port of {@code com.hazelcast.map.impl.operation.SetOperation}.
 *
 * Stores (key → value) without returning the old value (fire-and-forget put).
 */
import type { Data } from '@helios/internal/serialization/Data';
import { MapOperation } from '@helios/map/impl/operation/MapOperation';

export class SetOperation extends MapOperation {
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
        this.recordStore.set(this._key, this._value, this._ttl, this._maxIdle);
        this.sendResponse(undefined);
    }
}
