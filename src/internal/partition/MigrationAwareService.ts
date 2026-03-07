/**
 * Port of {@code com.hazelcast.internal.partition.FragmentedMigrationAwareService}.
 * Interface for services that participate in partition migration by providing
 * replication operations for their state.
 */
import type { PartitionMigrationEvent } from '@zenystx/helios-core/internal/partition/PartitionMigrationEvent';
import type { ServiceNamespace } from '@zenystx/helios-core/internal/services/ServiceNamespace';
import type { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';

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

    /**
     * Called before migration starts on both source and destination.
     * Services can prepare for ownership changes (e.g., pause processing).
     */
    beforeMigration(event: PartitionMigrationEvent): void;

    /**
     * Called after migration completes successfully.
     * Services should finalize state: clean up demoted replicas, activate promoted ones.
     */
    commitMigration(event: PartitionMigrationEvent): void;

    /**
     * Called after migration fails.
     * Services should roll back any state changes made during beforeMigration.
     */
    rollbackMigration(event: PartitionMigrationEvent): void;
}
