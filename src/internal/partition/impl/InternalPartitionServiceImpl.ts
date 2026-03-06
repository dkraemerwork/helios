/**
 * Port of {@code com.hazelcast.internal.partition.impl.InternalPartitionServiceImpl}.
 * Manages the partition table lifecycle: assignment, membership-triggered rebalancing,
 * runtime state application from master, and partition queries.
 */
import { PartitionStateManager } from '@zenystx/helios-core/internal/partition/impl/PartitionStateManager';
import type { InternalPartitionImpl } from '@zenystx/helios-core/internal/partition/impl/InternalPartitionImpl';
import type { PartitionReplica } from '@zenystx/helios-core/internal/partition/PartitionReplica';
import type { PartitionTableView } from '@zenystx/helios-core/internal/partition/PartitionTableView';
import type { Address } from '@zenystx/helios-core/cluster/Address';
import type { Member } from '@zenystx/helios-core/cluster/Member';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { MigrationAwareService } from '@zenystx/helios-core/internal/partition/MigrationAwareService';
import type { MigrationInfo } from '@zenystx/helios-core/internal/partition/MigrationInfo';

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
    private readonly _migrationAwareServices = new Map<string, MigrationAwareService>();
    private _completedMigrations: MigrationInfo[] = [];
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

    registerMigrationAwareService(serviceName: string, service: MigrationAwareService): void {
        this._migrationAwareServices.set(serviceName, service);
    }

    getMigrationAwareServices(): ReadonlyMap<string, MigrationAwareService> {
        return this._migrationAwareServices;
    }

    /**
     * Apply completed migrations received from master via PublishCompletedMigrationsOp.
     * Each migration's initialPartitionVersion must match the current partition version;
     * if there's a version gap, reject the entire batch and return false.
     *
     * Ref: InternalPartitionServiceImpl.java:860
     * Remediation — Finding 12: version gap rejection.
     */
    applyCompletedMigrations(migrations: readonly MigrationInfo[]): boolean {
        for (const migration of migrations) {
            const partitionId = migration.getPartitionId();
            const partition = this._stateManager.getPartition(partitionId);
            const currentVersion = partition.version();
            const initialVersion = migration.getInitialPartitionVersion();

            if (initialVersion !== currentVersion) {
                // Version gap — reject entire batch, request full state from master
                return false;
            }

            // Apply the migration: update replicas
            const dest = migration.getDestination();
            const destNewIdx = migration.getDestinationNewReplicaIndex();
            if (dest !== null && destNewIdx >= 0) {
                partition.setReplica(destNewIdx, dest);
            }

            const source = migration.getSource();
            const srcNewIdx = migration.getSourceNewReplicaIndex();
            if (source !== null && srcNewIdx === -1) {
                const srcCurIdx = migration.getSourceCurrentReplicaIndex();
                if (srcCurIdx >= 0) {
                    const current = partition.getReplica(srcCurIdx);
                    if (current && current.equals(source)) {
                        partition.setReplica(srcCurIdx, null);
                    }
                }
            }

            this._completedMigrations.push(migration as MigrationInfo);
        }

        this._stateManager.updateStamp();
        return true;
    }

    /** Clear the completed migrations list (after full partition-state publish). */
    clearCompletedMigrations(): void {
        this._completedMigrations = [];
    }

    /** Get the accumulated completed migrations since last clear. */
    getCompletedMigrations(): readonly MigrationInfo[] {
        return this._completedMigrations;
    }

    /**
     * Called when a migration fails. Increments partition version by replicaCount + 1.
     * The extra +1 prevents stale in-flight MigrationCommitOperations from being applied.
     *
     * Ref: MigrationManagerImpl.java:1519-1521, 1603-1605
     * Remediation — Finding 3: version +1 extra delta.
     */
    onMigrationFailure(partitionId: number, replicaCount: number): void {
        const partition = this._stateManager.getPartition(partitionId);
        partition.setVersion(partition.version() + replicaCount + 1);
        this._stateManager.updateStamp();
    }

    private _applyNewAssignment(newAssignment: (PartitionReplica | null)[][]): void {
        for (let i = 0; i < this._partitionCount; i++) {
            const partition = this._stateManager.getPartition(i);
            partition.setReplicas(newAssignment[i]);
        }
        this._stateManager.updateStamp();
    }
}
