/**
 * Port of {@code com.hazelcast.internal.partition.impl.MigrationManager}.
 *
 * Block 16.B3a: triggerControlTask, ControlTask, RedoPartitioningTask,
 * MigrationPlanner invocation, pauseMigration/resumeMigration.
 * Block 16.B3b: remote execution (MigrationRequestOperation, commit, finalize).
 */
import type { PartitionStateManager } from '@helios/internal/partition/impl/PartitionStateManager';
import type { MigrationQueue } from '@helios/internal/partition/impl/MigrationQueue';
import { MigrationPlanner, type MigrationDecisionCallback } from '@helios/internal/partition/impl/MigrationPlanner';
import { MigrationInfo } from '@helios/internal/partition/MigrationInfo';
import { MigrationRequestOperation } from '@helios/internal/partition/impl/MigrationRequestOperation';
import { MigrationCommitOperation } from '@helios/internal/partition/impl/MigrationCommitOperation';
import type { PartitionReplica } from '@helios/internal/partition/PartitionReplica';
import type { PartitionContainer } from '@helios/internal/partition/impl/PartitionContainer';
import type { MigrationAwareService } from '@helios/internal/partition/MigrationAwareService';
import type { ServiceNamespace } from '@helios/internal/services/ServiceNamespace';
import type { Member } from '@helios/cluster/Member';

export interface MigrationManagerOptions {
    maxParallelMigrations?: number;
}

/**
 * Manages migration lifecycle — planning and remote execution.
 */
export class MigrationManager {
    private readonly _stateManager: PartitionStateManager;
    private readonly _migrationQueue: MigrationQueue;
    private readonly _planner: MigrationPlanner;
    private readonly _maxParallelMigrations: number;
    private _paused: boolean;

    constructor(stateManager: PartitionStateManager, migrationQueue: MigrationQueue, options?: MigrationManagerOptions) {
        this._stateManager = stateManager;
        this._migrationQueue = migrationQueue;
        this._planner = new MigrationPlanner();
        this._maxParallelMigrations = options?.maxParallelMigrations ?? 10;
        this._paused = false;
    }

    getMaxParallelMigrations(): number {
        return this._maxParallelMigrations;
    }

    /**
     * Clears the migration queue, computes new partition assignment via repartition,
     * plans migrations for each changed partition, prioritizes copies/shift-ups,
     * and enqueues the resulting migration tasks.
     *
     * @returns The list of planned MigrationInfo decisions (empty if paused or no changes).
     */
    triggerControlTask(currentMembers: Member[], excludedMembers: Member[]): MigrationInfo[] {
        if (this._paused) {
            return [];
        }

        // Clear existing queue
        this._migrationQueue.clear();

        // RedoPartitioningTask: compute new assignment
        const newAssignment = this._stateManager.repartition(currentMembers, excludedMembers);
        const partitionCount = this._stateManager.partitionCount;

        // Plan migrations for each partition that changed
        const allMigrations: MigrationInfo[] = [];

        for (let partitionId = 0; partitionId < partitionCount; partitionId++) {
            const partition = this._stateManager.getPartition(partitionId);
            const oldReplicas = partition.getReplicasCopy();
            const newReplicas = newAssignment[partitionId];

            // Skip if no change
            if (this._replicasEqual(oldReplicas, newReplicas)) continue;

            const partitionMigrations: MigrationInfo[] = [];
            const callback: MigrationDecisionCallback = {
                migrate(
                    source: PartitionReplica | null,
                    sourceCurrentReplicaIndex: number,
                    sourceNewReplicaIndex: number,
                    destination: PartitionReplica | null,
                    destinationCurrentReplicaIndex: number,
                    destinationNewReplicaIndex: number,
                ): void {
                    partitionMigrations.push(new MigrationInfo(
                        partitionId,
                        source,
                        destination,
                        sourceCurrentReplicaIndex,
                        sourceNewReplicaIndex,
                        destinationCurrentReplicaIndex,
                        destinationNewReplicaIndex,
                    ));
                },
            };

            this._planner.planMigrations(partitionId, oldReplicas, newReplicas, callback);
            this._planner.prioritizeCopiesAndShiftUps(partitionMigrations);
            allMigrations.push(...partitionMigrations);
        }

        // Enqueue migration tasks
        for (const migration of allMigrations) {
            this._migrationQueue.add({
                run(): void {
                    // In B.3a, tasks are local stubs — remote execution is in B.3b
                    migration.setStatus(2 /* SUCCESS */);
                },
            });
        }

        return allMigrations;
    }

    /** Drains and runs all queued migration tasks. */
    processQueue(): void {
        let task = this._migrationQueue.poll();
        while (task !== null) {
            task.run();
            this._migrationQueue.afterTaskCompletion(task);
            task = this._migrationQueue.poll();
        }
    }

    pauseMigration(): void {
        this._paused = true;
    }

    resumeMigration(): void {
        this._paused = false;
    }

    isMigrationPaused(): boolean {
        return this._paused;
    }

    /**
     * Execute a single migration: build a MigrationRequestOperation from the
     * container's namespaces and registered services, then return it.
     * The caller is responsible for sending it to the destination via OperationService.
     */
    executeMigration(
        migration: MigrationInfo,
        container: PartitionContainer,
        services: ReadonlyMap<string, MigrationAwareService>,
    ): MigrationRequestOperation {
        const namespaces: ServiceNamespace[] = container.getAllNamespaces()
            .map(name => ({ getServiceName: () => name }));
        return new MigrationRequestOperation(migration, namespaces, services);
    }

    /**
     * Create a MigrationCommitOperation for the given migration.
     * Uses infinite retry (Number.MAX_SAFE_INTEGER) per Finding 2.
     */
    createCommitOperation(migration: MigrationInfo): MigrationCommitOperation {
        return new MigrationCommitOperation(migration);
    }

    private _replicasEqual(a: (PartitionReplica | null)[], b: (PartitionReplica | null)[]): boolean {
        const len = Math.max(a.length, b.length);
        for (let i = 0; i < len; i++) {
            const ra = a[i] ?? null;
            const rb = b[i] ?? null;
            if (ra === null && rb === null) continue;
            if (ra === null || rb === null) return false;
            if (!ra.equals(rb)) return false;
        }
        return true;
    }
}
