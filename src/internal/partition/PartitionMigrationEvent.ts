/**
 * Port of {@code com.hazelcast.internal.partition.PartitionMigrationEvent}.
 * Value object describing a partition migration: source, destination, type.
 */
import type { PartitionReplica } from '@zenystx/core/internal/partition/PartitionReplica';

/** The type of migration being performed. */
export type MigrationType = 'COPY' | 'MOVE' | 'SHIFT_UP' | 'SHIFT_DOWN';

export class PartitionMigrationEvent {
    readonly partitionId: number;
    readonly source: PartitionReplica | null;
    readonly destination: PartitionReplica | null;
    readonly migrationType: MigrationType;

    constructor(
        partitionId: number,
        source: PartitionReplica | null,
        destination: PartitionReplica | null,
        migrationType: MigrationType,
    ) {
        this.partitionId = partitionId;
        this.source = source;
        this.destination = destination;
        this.migrationType = migrationType;
    }

    toString(): string {
        return `PartitionMigrationEvent{partitionId=${this.partitionId}, type=${this.migrationType}, source=${this.source}, destination=${this.destination}}`;
    }
}
