/**
 * Port of {@code com.hazelcast.internal.partition.PartitionTableView}.
 * Immutable view of the partition table.
 */
import type { InternalPartition } from '@zenystx/helios-core/internal/partition/InternalPartition';
import { PartitionReplica } from '@zenystx/helios-core/internal/partition/PartitionReplica';
import { AbstractInternalPartition } from '@zenystx/helios-core/internal/partition/AbstractInternalPartition';
import { PartitionStampUtil } from '@zenystx/helios-core/internal/partition/PartitionStampUtil';
import { MAX_REPLICA_COUNT } from '@zenystx/helios-core/internal/partition/InternalPartition';

export class PartitionTableView {
    private readonly _partitions: (InternalPartition | null)[];
    private _stamp: bigint | null = null;

    constructor(partitions: (InternalPartition | null)[]) {
        this._partitions = partitions;
    }

    stamp(): bigint {
        if (this._stamp == null) {
            this._stamp = PartitionStampUtil.calculateStamp(this._partitions);
        }
        return this._stamp;
    }

    length(): number {
        return this._partitions.length;
    }

    getPartition(partitionId: number): InternalPartition | null {
        return this._partitions[partitionId] ?? null;
    }

    getReplica(partitionId: number, replicaIndex: number): PartitionReplica | null {
        const partition = this._partitions[partitionId];
        return partition ? partition.getReplica(replicaIndex) : null;
    }

    getReplicas(partitionId: number): (PartitionReplica | null)[] {
        const partition = this._partitions[partitionId];
        return partition ? partition.getReplicasCopy() : new Array(MAX_REPLICA_COUNT).fill(null);
    }

    distanceOf(other: PartitionTableView): number {
        let distance = 0;
        for (let i = 0; i < this._partitions.length; i++) {
            const p1 = this._partitions[i];
            const p2 = other._partitions[i];
            if (p1 && p2) {
                distance += this._distanceOfPartitions(p1, p2);
            }
        }
        return distance;
    }

    private _distanceOfPartitions(p1: InternalPartition, p2: InternalPartition): number {
        let distance = 0;
        for (let i = 0; i < MAX_REPLICA_COUNT; i++) {
            const r1 = p1.getReplica(i);
            const r2 = p2.getReplica(i);
            if (r1 == null) {
                if (r2 != null) {
                    distance += MAX_REPLICA_COUNT;
                }
            } else {
                if (r2 != null) {
                    if (r1.uuid() !== r2.uuid()) {
                        const idx2 = this._replicaIndexOfUuid(r1.uuid(), p2);
                        if (idx2 === -1) {
                            distance += MAX_REPLICA_COUNT;
                        } else {
                            distance += Math.abs(idx2 - i);
                        }
                    }
                }
            }
        }
        return distance;
    }

    private _replicaIndexOfUuid(uuid: string, partition: InternalPartition): number {
        // Access replicas array directly if possible
        if (partition instanceof AbstractInternalPartition) {
            const replicas = (partition as any).replicas() as (PartitionReplica | null)[];
            for (let i = 0; i < replicas.length; i++) {
                if (replicas[i] && replicas[i]!.uuid() === uuid) return i;
            }
            return -1;
        }
        // Fallback: use getReplicasCopy
        const replicas = partition.getReplicasCopy();
        for (let i = 0; i < replicas.length; i++) {
            if (replicas[i] && replicas[i]!.uuid() === uuid) return i;
        }
        return -1;
    }

    getMemberUuids(): Set<string> {
        const uuids = new Set<string>();
        for (const p of this._partitions) {
            if (!p) continue;
            for (const r of p.getReplicasCopy()) {
                if (r) uuids.add(r.uuid());
            }
        }
        return uuids;
    }

    equals(other: unknown): boolean {
        if (this === other) return true;
        if (!(other instanceof PartitionTableView)) return false;
        const a = this._partitions;
        const b = other._partitions;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            const p1 = a[i];
            const p2 = b[i];
            if (p1 == null && p2 == null) continue;
            if (p1 == null || p2 == null) return false;
            if (!(p1 instanceof AbstractInternalPartition)) return p1 === p2;
            if (!p1.equals(p2)) return false;
        }
        return true;
    }

    hashCode(): number {
        let result = 1;
        for (const p of this._partitions) {
            result = (Math.imul(31, result) + (p instanceof AbstractInternalPartition ? p.hashCode() : 0)) | 0;
        }
        return result;
    }

    toString(): string {
        return `PartitionTableView{partitions=[...], stamp=${this.stamp()}}`;
    }
}
