/**
 * Port of {@code com.hazelcast.internal.partition.FragmentedMigrationAwareService}.
 * Interface for services that participate in partition migration by providing
 * replication operations for their state.
 */
import type { Operation } from '@helios/spi/impl/operationservice/Operation';
import type { PartitionMigrationEvent } from '@helios/internal/partition/PartitionMigrationEvent';
import type { ServiceNamespace } from '@helios/internal/services/ServiceNamespace';

export interface MigrationAwareService {
    /**
     * Called by MigrationManager during migration processing.
     * Returns an Operation that, when executed on the destination, applies this
     * service's state for the given partition and namespaces.
     *
     * @param event - describes source, destination, partitionId, migration type
     * @param namespaces - the ServiceNamespace instances to include
     * @returns an Operation to send to the destination, or null if nothing to migrate
     */
    prepareReplicationOperation(
        event: PartitionMigrationEvent,
        namespaces: ServiceNamespace[],
    ): Operation | null;
}
