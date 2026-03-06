/**
 * Port of {@code com.hazelcast.map.impl.operation.PutIfAbsentOperation}.
 *
 * Inserts (key → value) only when key is absent.
 * Sends null on success (entry was new) or the existing value otherwise.
 * Implements BackupAwareOperation — produces a PutBackupOperation.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { BackupAwareOperation } from '@zenystx/helios-core/spi/impl/operationservice/BackupAwareOperation';
import { MapOperation } from '@zenystx/helios-core/map/impl/operation/MapOperation';
import { PutBackupOperation } from '@zenystx/helios-core/map/impl/operation/PutBackupOperation';

export class PutIfAbsentOperation extends MapOperation implements BackupAwareOperation {
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
            this.recordStore.putIfAbsent(this._key, this._value, this._ttl, this._maxIdle),
        );
    }

    shouldBackup(): boolean { return true; }
    getSyncBackupCount(): number { return 1; }
    getAsyncBackupCount(): number { return 0; }

    getBackupOperation(): Operation {
        return new PutBackupOperation(this.mapName, this._key, this._value, this._ttl, this._maxIdle);
    }
}
