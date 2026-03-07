/**
 * Port of {@code com.hazelcast.internal.partition.operation.MigrationRequestOperation}.
 *
 * Sent to destination node during migration. Collects replication operations from
 * all MigrationAwareServices and executes them on the destination to transfer state.
 */
import type { MigrationAwareService } from '@zenystx/helios-core/internal/partition/MigrationAwareService';
import type { MigrationInfo } from '@zenystx/helios-core/internal/partition/MigrationInfo';
import { PartitionMigrationEvent } from '@zenystx/helios-core/internal/partition/PartitionMigrationEvent';
import type { ServiceNamespace } from '@zenystx/helios-core/internal/services/ServiceNamespace';
import { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';

export class MigrationRequestOperation extends Operation {
    private readonly _migrationInfo: MigrationInfo;
    private readonly _replicationOps: Operation[] = [];

    constructor(
        migrationInfo: MigrationInfo,
        namespaces: ServiceNamespace[],
        services?: ReadonlyMap<string, MigrationAwareService>,
    ) {
        super();
        this._migrationInfo = migrationInfo;
        this.partitionId = migrationInfo.getPartitionId();

        if (services) {
            this._collectReplicationOperations(namespaces, services);
        }
    }

    getMigrationInfo(): MigrationInfo {
        return this._migrationInfo;
    }

    getReplicationOperations(): readonly Operation[] {
        return this._replicationOps;
    }

    async run(): Promise<void> {
        for (const op of this._replicationOps) {
            await op.run();
        }
        this.sendResponse(true);
    }

    private _collectReplicationOperations(
        namespaces: ServiceNamespace[],
        services: ReadonlyMap<string, MigrationAwareService>,
    ): void {
        const event = new PartitionMigrationEvent(
            this._migrationInfo.getPartitionId(),
            this._migrationInfo.getSource(),
            this._migrationInfo.getDestination(),
            'COPY',
        );

        for (const [, service] of services) {
            const op = service.prepareReplicationOperation(event, namespaces);
            if (op !== null) {
                this._replicationOps.push(op);
            }
        }
    }
}
