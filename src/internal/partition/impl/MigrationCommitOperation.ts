/**
 * Port of {@code com.hazelcast.internal.partition.operation.MigrationCommitOperation}.
 *
 * Sent to destination after successful MigrationRequestOperation.
 * Uses infinite retry (Number.MAX_SAFE_INTEGER) with heartbeat-based timeout
 * to prevent partition table corruption from lost responses.
 *
 * Ref: MigrationManagerImpl.java:413-482
 */
import type { MigrationInfo } from '@zenystx/helios-core/internal/partition/MigrationInfo';
import { MigrationStatus } from '@zenystx/helios-core/internal/partition/MigrationInfo';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';

export class MigrationCommitOperation extends Operation {
    private readonly _migrationInfo: MigrationInfo;
    private readonly _tryCount: number = Number.MAX_SAFE_INTEGER;

    constructor(migrationInfo: MigrationInfo) {
        super();
        this._migrationInfo = migrationInfo;
        this.partitionId = migrationInfo.getPartitionId();
    }

    getMigrationInfo(): MigrationInfo {
        return this._migrationInfo;
    }

    getTryCount(): number {
        return this._tryCount;
    }

    async run(): Promise<void> {
        this._migrationInfo.setStatus(MigrationStatus.SUCCESS);
        this.sendResponse(true);
    }
}
