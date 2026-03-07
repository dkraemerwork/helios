/**
 * Port of {@code com.hazelcast.internal.partition.operation.FinalizeMigrationOperation}.
 *
 * Executed on both source and destination after migration completes (or fails).
 * On success: updates partition replicas, notifies services via commitMigration.
 * On failure: rolls back by cleaning up PartitionContainer state and notifying
 * services via rollbackMigration.
 *
 * Ref: FinalizeMigrationOperation.java:97, 181-205
 */
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { MigrationInfo } from '@zenystx/helios-core/internal/partition/MigrationInfo';
import type { InternalPartitionImpl } from '@zenystx/helios-core/internal/partition/impl/InternalPartitionImpl';
import type { PartitionContainer } from '@zenystx/helios-core/internal/partition/impl/PartitionContainer';
import type { MigrationAwareService } from '@zenystx/helios-core/internal/partition/MigrationAwareService';
import { PartitionMigrationEvent } from '@zenystx/helios-core/internal/partition/PartitionMigrationEvent';

export class FinalizeMigrationOperation extends Operation {
    private readonly _migrationInfo: MigrationInfo;
    private readonly _success: boolean;
    private readonly _partition: InternalPartitionImpl;
    private readonly _container: PartitionContainer | null;
    private readonly _services: ReadonlyMap<string, MigrationAwareService> | null;

    constructor(
        migrationInfo: MigrationInfo,
        success: boolean,
        partition: InternalPartitionImpl,
        container?: PartitionContainer,
        services?: ReadonlyMap<string, MigrationAwareService>,
    ) {
        super();
        this._migrationInfo = migrationInfo;
        this._success = success;
        this._partition = partition;
        this._container = container ?? null;
        this._services = services ?? null;
        this.partitionId = migrationInfo.getPartitionId();
    }

    getMigrationInfo(): MigrationInfo {
        return this._migrationInfo;
    }

    isSuccess(): boolean {
        return this._success;
    }

    async run(): Promise<void> {
        if (this._success) {
            this._applyMigration();
            this._notifyServices(true);
        } else {
            this._rollback();
            this._notifyServices(false);
        }
        this._partition.resetMigrating();
        this.sendResponse(true);
    }

    private _applyMigration(): void {
        const info = this._migrationInfo;
        const dest = info.getDestination();
        const destNewIdx = info.getDestinationNewReplicaIndex();

        if (dest !== null && destNewIdx >= 0) {
            this._partition.setReplica(destNewIdx, dest);
        }

        const source = info.getSource();
        const srcNewIdx = info.getSourceNewReplicaIndex();

        if (source !== null && srcNewIdx === -1) {
            // Source is being removed from this replica index
            const srcCurIdx = info.getSourceCurrentReplicaIndex();
            if (srcCurIdx >= 0) {
                const current = this._partition.getReplica(srcCurIdx);
                if (current && current.equals(source)) {
                    this._partition.setReplica(srcCurIdx, null);
                }
            }
        }
    }

    private _rollback(): void {
        if (this._container) {
            this._container.cleanUpOnMigration();
        }
    }

    /**
     * Notifies all registered MigrationAwareServices of migration completion or rollback.
     * On success: calls commitMigration for cleanup of demoted replicas.
     * On failure: calls rollbackMigration for cleanup of destination-side state.
     */
    private _notifyServices(success: boolean): void {
        if (!this._services) return;

        const info = this._migrationInfo;
        const event = new PartitionMigrationEvent(
            info.getPartitionId(),
            info.getSource(),
            info.getDestination(),
            'MOVE',
        );

        for (const [, service] of this._services) {
            if (success) {
                service.commitMigration(event);
            } else {
                service.rollbackMigration(event);
            }
        }
    }
}
