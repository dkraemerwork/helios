/**
 * Port of {@code com.hazelcast.internal.partition.AbstractInternalPartition}.
 * Base implementation of InternalPartition.
 */
import type { Address } from '@zenystx/helios-core/cluster/Address';
import type { InternalPartition } from '@zenystx/helios-core/internal/partition/InternalPartition';
import { MAX_REPLICA_COUNT } from '@zenystx/helios-core/internal/partition/InternalPartition';
import { PartitionReplica } from '@zenystx/helios-core/internal/partition/PartitionReplica';

export abstract class AbstractInternalPartition implements InternalPartition {
    protected readonly partitionId: number;

    constructor(partitionId: number) {
        this.partitionId = partitionId;
    }

    /** Returns the internal replica array. Callers must not modify. */
    protected abstract replicas(): (PartitionReplica | null)[];

    abstract isLocal(): boolean;
    abstract isMigrating(): boolean;
    abstract version(): number;

    getPartitionId(): number {
        return this.partitionId;
    }

    getOwnerOrNull(): Address | null {
        const replica = this.replicas()[0] ?? null;
        return replica ? replica.address() : null;
    }

    getOwnerReplicaOrNull(): PartitionReplica | null {
        return this.replicas()[0] ?? null;
    }

    getReplicaAddress(replicaIndex: number): Address | null {
        const replica = this.getReplica(replicaIndex);
        return replica ? replica.address() : null;
    }

    isOwnerOrBackupAddress(address: Address): boolean {
        if (!address) return false;
        for (const replica of this.replicas()) {
            if (replica && address.equals(replica.address())) return true;
        }
        return false;
    }

    isOwnerOrBackupReplica(replica: PartitionReplica): boolean {
        return AbstractInternalPartition.getReplicaIndex(this.replicas(), replica) >= 0;
    }

    getReplica(replicaIndex: number): PartitionReplica | null {
        if (replicaIndex >= MAX_REPLICA_COUNT) {
            throw new RangeError(`Replica index out of bounds: ${replicaIndex}`);
        }
        const arr = this.replicas();
        if (replicaIndex >= arr.length) return null;
        return arr[replicaIndex] ?? null;
    }

    getReplicaIndex(replica: PartitionReplica): number {
        return AbstractInternalPartition.getReplicaIndex(this.replicas(), replica);
    }

    getReplicasCopy(): (PartitionReplica | null)[] {
        const arr = this.replicas();
        const result: (PartitionReplica | null)[] = new Array(MAX_REPLICA_COUNT).fill(null);
        for (let i = 0; i < arr.length && i < MAX_REPLICA_COUNT; i++) {
            result[i] = arr[i] ?? null;
        }
        return result;
    }

    static getReplicaIndex(replicas: (PartitionReplica | null)[], replica: PartitionReplica | null): number {
        if (replica == null) return -1;
        for (let i = 0; i < replicas.length; i++) {
            const r = replicas[i];
            if (r && replica.equals(r)) return i;
        }
        return -1;
    }

    equals(other: unknown): boolean {
        if (this === other) return true;
        if (!(other instanceof AbstractInternalPartition)) return false;
        if (this.partitionId !== other.getPartitionId()) return false;
        if (this.version() !== other.version()) return false;
        const r1 = this.replicas();
        const r2 = other.replicas();
        if (r1.length !== r2.length) return false;
        for (let i = 0; i < r1.length; i++) {
            const a = r1[i] ?? null;
            const b = r2[i] ?? null;
            if (a === null && b === null) continue;
            if (a === null || b === null) return false;
            if (!a.equals(b)) return false;
        }
        return true;
    }

    hashCode(): number {
        let result = 1;
        for (const r of this.replicas()) {
            result = (Math.imul(31, result) + (r ? r.hashCode() : 0)) | 0;
        }
        result = (Math.imul(31, result) + this.partitionId) | 0;
        result = (Math.imul(31, result) + this.version()) | 0;
        return result;
    }

    toString(): string {
        const sb: string[] = [`Partition {ID: ${this.partitionId}, Version: ${this.version()}} [\n`];
        const arr = this.replicas();
        for (let i = 0; i < arr.length; i++) {
            const r = arr[i];
            if (r) sb.push(`\t${i}:${r}\n`);
        }
        sb.push(']');
        return sb.join('');
    }
}
