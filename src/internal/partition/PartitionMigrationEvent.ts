/**
 * Port of {@code com.hazelcast.internal.partition.PartitionMigrationEvent}.
 * Value object describing a partition migration: source, destination, type.
 */
import type { PartitionReplica } from '@zenystx/helios-core/internal/partition/PartitionReplica';

/** The type of migration being performed. */
export type MigrationType = 'COPY' | 'MOVE' | 'SHIFT_UP' | 'SHIFT_DOWN';

/** Which end of the migration this node is on. */
export type MigrationEndpoint = 'SOURCE' | 'DESTINATION';

export class PartitionMigrationEvent {
    readonly partitionId: number;
    readonly source: PartitionReplica | null;
    readonly destination: PartitionReplica | null;
    readonly migrationType: MigrationType;
    readonly migrationEndpoint: MigrationEndpoint;
    readonly currentReplicaIndex: number;
    readonly newReplicaIndex: number;

    constructor(
        partitionId: number,
        source: PartitionReplica | null,
        destination: PartitionReplica | null,
        migrationType: MigrationType,
        migrationEndpoint: MigrationEndpoint = 'SOURCE',
        currentReplicaIndex: number = 0,
        newReplicaIndex: number = -1,
    ) {
        this.partitionId = partitionId;
        this.source = source;
        this.destination = destination;
        this.migrationType = migrationType;
        this.migrationEndpoint = migrationEndpoint;
        this.currentReplicaIndex = currentReplicaIndex;
        this.newReplicaIndex = newReplicaIndex;
    }

    toString(): string {
        return `PartitionMigrationEvent{partitionId=${this.partitionId}, type=${this.migrationType}, endpoint=${this.migrationEndpoint}, source=${this.source}, destination=${this.destination}}`;
    }
}
