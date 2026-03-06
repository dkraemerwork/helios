/**
 * Port of {@code com.hazelcast.internal.partition.ReadonlyInternalPartition}.
 * Immutable/readonly view of an InternalPartition.
 */
import { AbstractInternalPartition } from '@zenystx/core/internal/partition/AbstractInternalPartition';
import type { InternalPartition } from '@zenystx/core/internal/partition/InternalPartition';
import type { PartitionReplica } from '@zenystx/core/internal/partition/PartitionReplica';
import { MAX_REPLICA_COUNT } from '@zenystx/core/internal/partition/InternalPartition';

export class ReadonlyInternalPartition extends AbstractInternalPartition {
    private readonly _replicas: (PartitionReplica | null)[];
    private readonly _version: number;

    constructor(replicas: (PartitionReplica | null)[], partitionId: number, version: number);
    constructor(partition: InternalPartition);
    constructor(
        replicasOrPartition: (PartitionReplica | null)[] | InternalPartition,
        partitionId?: number,
        version?: number,
    ) {
        if (Array.isArray(replicasOrPartition)) {
            super(partitionId!);
            // Pad to MAX_REPLICA_COUNT
            const arr = replicasOrPartition as (PartitionReplica | null)[];
            const padded: (PartitionReplica | null)[] = new Array(MAX_REPLICA_COUNT).fill(null);
            for (let i = 0; i < arr.length && i < MAX_REPLICA_COUNT; i++) {
                padded[i] = arr[i] ?? null;
            }
            this._replicas = padded;
            this._version = version!;
        } else {
            const partition = replicasOrPartition as InternalPartition;
            super(partition.getPartitionId());
            this._replicas = partition.getReplicasCopy();
            this._version = partition.version();
        }
    }

    isLocal(): boolean {
        throw new Error('UnsupportedOperationException');
    }

    isMigrating(): boolean {
        throw new Error('UnsupportedOperationException');
    }

    version(): number {
        return this._version;
    }

    protected replicas(): (PartitionReplica | null)[] {
        return this._replicas;
    }
}
