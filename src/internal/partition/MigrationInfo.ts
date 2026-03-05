/**
 * Port of {@code com.hazelcast.internal.partition.MigrationInfo}.
 * Represents migration metadata for a partition replica.
 */
import type { PartitionReplica } from '@helios/internal/partition/PartitionReplica';

export enum MigrationStatus {
    ACTIVE = 0,
    SUCCESS = 2,
    FAILED = 3,
}

export class MigrationInfo {
    private readonly _partitionId: number;
    private readonly _source: PartitionReplica | null;
    private readonly _destination: PartitionReplica | null;
    private readonly _sourceCurrentReplicaIndex: number;
    private readonly _sourceNewReplicaIndex: number;
    private readonly _destinationCurrentReplicaIndex: number;
    private readonly _destinationNewReplicaIndex: number;
    private _status: MigrationStatus;
    private _initialPartitionVersion: number = 0;

    constructor(
        partitionId: number,
        source: PartitionReplica | null,
        destination: PartitionReplica | null,
        sourceCurrentReplicaIndex: number,
        sourceNewReplicaIndex: number,
        destinationCurrentReplicaIndex: number,
        destinationNewReplicaIndex: number,
    ) {
        this._partitionId = partitionId;
        this._source = source;
        this._destination = destination;
        this._sourceCurrentReplicaIndex = sourceCurrentReplicaIndex;
        this._sourceNewReplicaIndex = sourceNewReplicaIndex;
        this._destinationCurrentReplicaIndex = destinationCurrentReplicaIndex;
        this._destinationNewReplicaIndex = destinationNewReplicaIndex;
        this._status = MigrationStatus.ACTIVE;
    }

    getPartitionId(): number { return this._partitionId; }
    getSource(): PartitionReplica | null { return this._source; }
    getDestination(): PartitionReplica | null { return this._destination; }
    getSourceCurrentReplicaIndex(): number { return this._sourceCurrentReplicaIndex; }
    getSourceNewReplicaIndex(): number { return this._sourceNewReplicaIndex; }
    getDestinationCurrentReplicaIndex(): number { return this._destinationCurrentReplicaIndex; }
    getDestinationNewReplicaIndex(): number { return this._destinationNewReplicaIndex; }
    getStatus(): MigrationStatus { return this._status; }
    setStatus(status: MigrationStatus): this { this._status = status; return this; }

    getInitialPartitionVersion(): number { return this._initialPartitionVersion; }
    setInitialPartitionVersion(version: number): this { this._initialPartitionVersion = version; return this; }
}
