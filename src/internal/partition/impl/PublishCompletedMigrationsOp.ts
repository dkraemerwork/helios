/**
 * Port of {@code com.hazelcast.internal.partition.operation.PublishCompletedMigrationsOperation}.
 *
 * Sent by master to all members after a migration finalizes, carrying the collection
 * of completed MigrationInfo. Receivers call applyCompletedMigrations() to update
 * their local partition tables immediately (instead of waiting for the periodic
 * publishPartitionState broadcast).
 *
 * Ref: PublishCompletedMigrationsOperation.java:42-96
 */
import type { MigrationInfo } from '@zenystx/helios-core/internal/partition/MigrationInfo';
import { GENERIC_PARTITION_ID, Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';

export class PublishCompletedMigrationsOp extends Operation {
    private readonly _completedMigrations: readonly MigrationInfo[];

    constructor(completedMigrations: readonly MigrationInfo[]) {
        super();
        this._completedMigrations = completedMigrations;
        this.partitionId = GENERIC_PARTITION_ID;
    }

    getCompletedMigrations(): readonly MigrationInfo[] {
        return this._completedMigrations;
    }

    async run(): Promise<void> {
        // The actual application is done by InternalPartitionServiceImpl.applyCompletedMigrations()
        // which is called by the operation handler after receiving this operation.
        this.sendResponse(true);
    }
}
