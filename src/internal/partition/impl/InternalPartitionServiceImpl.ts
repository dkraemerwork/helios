/**
 * Port of {@code com.hazelcast.internal.partition.impl.InternalPartitionServiceImpl}.
 * Manages the partition table lifecycle: assignment, membership-triggered rebalancing,
 * runtime state application from master, and partition queries.
 */
import { PartitionStateManager } from '@helios/internal/partition/impl/PartitionStateManager';
import type { InternalPartitionImpl } from '@helios/internal/partition/impl/InternalPartitionImpl';
import type { PartitionReplica } from '@helios/internal/partition/PartitionReplica';
import type { PartitionTableView } from '@helios/internal/partition/PartitionTableView';
import type { Address } from '@helios/cluster/Address';
import type { Member } from '@helios/cluster/Member';
import type { Data } from '@helios/internal/serialization/Data';

/**
 * Represents the partition runtime state received from the master.
 * Each partition has a replica array and a version number.
 */
export interface PartitionRuntimeState {
    /** Per-partition replica arrays (index = partitionId). */
    partitions: (PartitionReplica | null)[][];
    /** Per-partition version numbers (index = partitionId). */
    versions: number[];
}

export class InternalPartitionServiceImpl {
    private readonly _stateManager: PartitionStateManager;
    private readonly _partitionCount: number;
    private _initialized: boolean;

    constructor(partitionCount: number = 271) {
        this._partitionCount = partitionCount;
        this._stateManager = new PartitionStateManager(partitionCount);
        this._initialized = false;
    }

    /**
     * Master-only: performs initial partition assignment and marks as initialized.
     * @param members All current cluster members
     * @param masterAddress The address of the current master
     * @param backupCount Number of backup replicas (default 0)
     */
    firstArrangement(members: Member[], _masterAddress: Address, backupCount: number = 0): void {
        this._stateManager.initializePartitionAssignments(members, backupCount);
        this._initialized = true;
    }

    /**
     * Called when a new member joins. Triggers repartitioning to include the new member.
     * @param currentMembers All current cluster members (including the new one)
     */
    memberAdded(currentMembers: Member[]): void {
        const newAssignment = this._stateManager.repartition(currentMembers, []);
        this._applyNewAssignment(newAssignment);
    }

    /**
     * Called when a member leaves. Triggers repartitioning to redistribute orphaned partitions.
     * @param removedMember The member that was removed
     * @param remainingMembers The remaining cluster members
     */
    memberRemoved(removedMember: Member, remainingMembers: Member[]): void {
        const newAssignment = this._stateManager.repartition(remainingMembers, [removedMember]);
        this._applyNewAssignment(newAssignment);
    }

    /**
     * Non-master applies partition state received from master.
     * Per-partition version comparison: skip if new version < current version.
     * @returns true if the state was applied (at least partially)
     */
    applyPartitionRuntimeState(state: PartitionRuntimeState, _sender: Address): boolean {
        for (let i = 0; i < this._partitionCount; i++) {
            const partition = this._stateManager.getPartition(i);
            const currentVersion = partition.version();
            const newVersion = state.versions[i];

            if (newVersion <= currentVersion) continue;

            partition.setReplicas(state.partitions[i]);
            partition.setVersion(newVersion);
        }

        this._initialized = true;
        this._stateManager.updateStamp();
        return true;
    }

    isInitialized(): boolean {
        return this._initialized;
    }

    getPartitionCount(): number {
        return this._partitionCount;
    }

    getPartition(partitionId: number): InternalPartitionImpl {
        return this._stateManager.getPartition(partitionId);
    }

    getPartitionOwner(partitionId: number): PartitionReplica | null {
        return this._stateManager.getPartitionOwner(partitionId);
    }

    getPartitionId(key: Data): number {
        return this._stateManager.getPartitionId(key);
    }

    /**
     * Returns all partition IDs owned by the given member address.
     */
    getMemberPartitions(address: Address): number[] {
        const result: number[] = [];
        for (let i = 0; i < this._partitionCount; i++) {
            const owner = this._stateManager.getPartitionOwner(i);
            if (owner && owner.address().equals(address)) {
                result.push(i);
            }
        }
        return result;
    }

    toPartitionTableView(): PartitionTableView {
        return this._stateManager.toPartitionTableView();
    }

    private _applyNewAssignment(newAssignment: (PartitionReplica | null)[][]): void {
        for (let i = 0; i < this._partitionCount; i++) {
            const partition = this._stateManager.getPartition(i);
            partition.setReplicas(newAssignment[i]);
        }
        this._stateManager.updateStamp();
    }
}
