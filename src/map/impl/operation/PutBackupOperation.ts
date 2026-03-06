/**
 * Port of {@code com.hazelcast.map.impl.operation.PutBackupOperation}.
 *
 * Backup operation that applies a put (key → value) on the backup RecordStore.
 * Used by PutOperation, SetOperation, and PutIfAbsentOperation.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { MapOperation } from '@zenystx/helios-core/map/impl/operation/MapOperation';

export class PutBackupOperation extends MapOperation {
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
    }
}
