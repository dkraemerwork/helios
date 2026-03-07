/**
 * Port of {@code com.hazelcast.map.impl.operation.PutIfAbsentOperation}.
 *
 * Inserts (key → value) only when key is absent.
 * Sends null on success (entry was new) or the existing value otherwise.
 * Implements BackupAwareOperation — produces a PutBackupOperation.
 *
 * Block 21.2: Performs external MapStore write on the owner when key was absent.
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
        const existing = this.recordStore.putIfAbsent(this._key, this._value, this._ttl, this._maxIdle);
        this.sendResponse(existing);
        if (existing === null) {
            this.recordNamespaceMutation();
        }
        // Owner-side external store write only when key was absent (existing === null)
        if (existing === null && this.mapDataStore.isWithStore()) {
            this.containerService.ensureExternalMapStoreOperationAllowed(this.partitionId);
            const ne = this.getNodeEngine()!;
            const key = ne.toObject(this._key);
            const value = ne.toObject(this._value);
            await this.mapDataStore.add(key, value, Date.now());
        }
    }

    shouldBackup(): boolean { return true; }
    getSyncBackupCount(): number { return 1; }
    getAsyncBackupCount(): number { return 0; }

    getBackupOperation(): Operation {
        return new PutBackupOperation(this.mapName, this._key, this._value, this._ttl, this._maxIdle);
    }
}
