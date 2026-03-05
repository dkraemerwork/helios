/**
 * Port of {@code com.hazelcast.internal.partition.impl.PartitionStateManagerImpl}.
 * Owns the partition table: assignment, repartition, stamp calculation.
 */
import { InternalPartitionImpl } from '@helios/internal/partition/impl/InternalPartitionImpl';
import { PartitionReplica } from '@helios/internal/partition/PartitionReplica';
import { PartitionStampUtil } from '@helios/internal/partition/PartitionStampUtil';
import { PartitionTableView } from '@helios/internal/partition/PartitionTableView';
import type { Member } from '@helios/cluster/Member';
import type { Data } from '@helios/internal/serialization/Data';

export class PartitionStateManager {
    private readonly _partitions: InternalPartitionImpl[];
    private readonly _partitionCount: number;
    private _initialized: boolean;
    private _stateStamp: bigint;

    constructor(partitionCount: number = 271) {
        this._partitionCount = partitionCount;
        this._partitions = new Array(partitionCount);
        for (let i = 0; i < partitionCount; i++) {
            this._partitions[i] = new InternalPartitionImpl(i, null, null);
        }
        this._initialized = false;
        this._stateStamp = 0n;
    }

    isInitialized(): boolean {
        return this._initialized;
    }

    getStateStamp(): bigint {
        return this._stateStamp;
    }

    /**
     * Initial round-robin assignment of partition owners (and optional backups).
     * @param members Data members to distribute partitions across
     * @param backupCount Number of backup replicas (default 0)
     */
    initializePartitionAssignments(members: Member[], backupCount: number = 0): void {
        const dataMembers = members.filter(m => !m.isLiteMember());
        if (dataMembers.length === 0) return;

        const replicas = this._buildReplicas(dataMembers);

        for (let i = 0; i < this._partitionCount; i++) {
            const ownerIdx = i % dataMembers.length;
            const owner = replicas[ownerIdx];
            this._partitions[i].setReplica(0, owner);

            // Assign backups on different members
            const maxBackups = Math.min(backupCount, dataMembers.length - 1);
            for (let b = 1; b <= maxBackups; b++) {
                const backupIdx = (ownerIdx + b) % dataMembers.length;
                this._partitions[i].setReplica(b, replicas[backupIdx]);
            }
        }

        this._initialized = true;
        this.updateStamp();
    }

    /**
     * Computes new partition assignment after membership change.
     * Returns new replica arrays per partition.
     */
    repartition(currentMembers: Member[], excludedMembers: Member[]): (PartitionReplica | null)[][] {
        const dataMembers = currentMembers.filter(m => !m.isLiteMember());
        const excludedUuids = new Set(excludedMembers.map(m => m.getUuid()));
        const replicas = this._buildReplicas(dataMembers);
        const validUuids = new Set(dataMembers.map(m => m.getUuid()));

        const result: (PartitionReplica | null)[][] = [];

        // Count current ownership per member for rebalancing
        const ownershipCount = new Map<string, number>();
        for (const r of replicas) ownershipCount.set(r.uuid(), 0);

        // First pass: clear excluded, count current valid owners
        const cleaned: (PartitionReplica | null)[][] = [];
        for (let i = 0; i < this._partitionCount; i++) {
            const currentReplicas = this._partitions[i].getReplicasCopy();
            const newReplicas = [...currentReplicas];
            for (let r = 0; r < newReplicas.length; r++) {
                const rep = newReplicas[r];
                if (rep && (excludedUuids.has(rep.uuid()) || !validUuids.has(rep.uuid()))) {
                    newReplicas[r] = null;
                }
            }
            cleaned.push(newReplicas);
            const owner = newReplicas[0];
            if (owner) {
                ownershipCount.set(owner.uuid(), (ownershipCount.get(owner.uuid()) ?? 0) + 1);
            }
        }

        // Target: each member should own ~partitionCount/memberCount
        const targetMax = Math.ceil(this._partitionCount / dataMembers.length);

        // Second pass: rebalance — steal from over-assigned, give to unassigned/under-assigned
        for (let i = 0; i < this._partitionCount; i++) {
            const newReplicas = cleaned[i];

            if (newReplicas[0] == null) {
                // Find the least-loaded member
                const leastLoaded = this._leastLoadedReplica(replicas, ownershipCount, newReplicas);
                newReplicas[0] = leastLoaded;
                ownershipCount.set(leastLoaded.uuid(), (ownershipCount.get(leastLoaded.uuid()) ?? 0) + 1);
            } else {
                // Check if current owner is over-assigned — steal if another member has 0
                const owner = newReplicas[0];
                const ownerCount = ownershipCount.get(owner.uuid()) ?? 0;
                if (ownerCount > targetMax) {
                    const leastLoaded = this._leastLoadedReplica(replicas, ownershipCount, newReplicas);
                    const leastCount = ownershipCount.get(leastLoaded.uuid()) ?? 0;
                    if (leastCount < ownerCount - 1) {
                        newReplicas[0] = leastLoaded;
                        ownershipCount.set(owner.uuid(), ownerCount - 1);
                        ownershipCount.set(leastLoaded.uuid(), leastCount + 1);
                    }
                }
            }

            result.push(newReplicas);
        }

        return result;
    }

    /** Recalculates stateStamp from all partition versions. */
    updateStamp(): void {
        this._stateStamp = PartitionStampUtil.calculateStamp(this._partitions);
    }

    /** Returns owner PartitionReplica for the given partition, or null. */
    getPartitionOwner(partitionId: number): PartitionReplica | null {
        return this._partitions[partitionId]?.getReplica(0) ?? null;
    }

    /** Returns the partition for direct manipulation. */
    getPartition(partitionId: number): InternalPartitionImpl {
        return this._partitions[partitionId];
    }

    /** Deterministic partition ID: hash(key) % partitionCount. */
    getPartitionId(key: Data): number {
        const hash = key.getPartitionHash();
        return Math.abs(hash % this._partitionCount);
    }

    /** Creates an immutable PartitionTableView snapshot. */
    toPartitionTableView(): PartitionTableView {
        const snapshot = this._partitions.map(p => p.copy(null));
        return new PartitionTableView(snapshot);
    }

    get partitionCount(): number {
        return this._partitionCount;
    }

    private _buildReplicas(dataMembers: Member[]): PartitionReplica[] {
        return dataMembers.map(m => new PartitionReplica(m.getAddress(), m.getUuid()));
    }

    private _leastLoadedReplica(
        candidates: PartitionReplica[],
        counts: Map<string, number>,
        currentReplicas: (PartitionReplica | null)[],
    ): PartitionReplica {
        const usedUuids = new Set(currentReplicas.filter(r => r != null).map(r => r!.uuid()));
        let best = candidates[0];
        let bestCount = counts.get(best.uuid()) ?? 0;
        for (const c of candidates) {
            if (usedUuids.has(c.uuid())) continue;
            const cc = counts.get(c.uuid()) ?? 0;
            if (cc < bestCount || usedUuids.has(best.uuid())) {
                best = c;
                bestCount = cc;
            }
        }
        return best;
    }

}
