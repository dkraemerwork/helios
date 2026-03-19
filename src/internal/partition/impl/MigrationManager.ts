/**
 * Port of {@code com.hazelcast.internal.partition.impl.MigrationManager}.
 *
 * Block 16.B3a: triggerControlTask, ControlTask, RedoPartitioningTask,
 * MigrationPlanner invocation, pauseMigration/resumeMigration.
 * Block 16.B3b: real partition data transfer between members via cluster transport.
 */
import type { Member } from '@zenystx/helios-core/cluster/Member';
import { MemberInfo } from '@zenystx/helios-core/cluster/MemberInfo';
import { MigrationCommitOperation } from '@zenystx/helios-core/internal/partition/impl/MigrationCommitOperation';
import { MigrationPlanner, type MigrationDecisionCallback } from '@zenystx/helios-core/internal/partition/impl/MigrationPlanner';
import type { MigrationQueue } from '@zenystx/helios-core/internal/partition/impl/MigrationQueue';
import { MigrationRequestOperation } from '@zenystx/helios-core/internal/partition/impl/MigrationRequestOperation';
import type { PartitionContainer } from '@zenystx/helios-core/internal/partition/impl/PartitionContainer';
import type { PartitionStateManager } from '@zenystx/helios-core/internal/partition/impl/PartitionStateManager';
import type { MigrationAwareService } from '@zenystx/helios-core/internal/partition/MigrationAwareService';
import { MigrationInfo, MigrationStatus } from '@zenystx/helios-core/internal/partition/MigrationInfo';
import type { MigrationEvent } from '@zenystx/helios-core/internal/partition/MigrationListener';
import type { PartitionReplica } from '@zenystx/helios-core/internal/partition/PartitionReplica';
import type { ServiceNamespace } from '@zenystx/helios-core/internal/services/ServiceNamespace';
import { MemberVersion } from '@zenystx/helios-core/version/MemberVersion';

export interface MigrationManagerOptions {
    maxParallelMigrations?: number;
}

/** Point-in-time snapshot of migration queue statistics. */
export interface MigrationStats {
    /** Number of pending migrations waiting in the queue. */
    migrationQueueSize: number;
    /** Number of migrations currently being executed (0 or 1 in single-threaded runtime). */
    activeMigrations: number;
    /** Total number of migrations completed since this manager was created. */
    completedMigrations: number;
}

/**
 * Wire representation of a single key-value entry during partition migration.
 * Uses raw Buffer to avoid depending on the ClusterMessage types from this layer.
 */
export interface MigrationEntry {
    key: Buffer;
    value: Buffer;
}

/** Wire representation of one service namespace's data for a migrating partition. */
export interface MigrationNamespaceData {
    namespace: string;
    entries: MigrationEntry[];
}

/**
 * Callbacks wired by HeliosInstanceImpl to perform real data transfer during migration.
 *
 * exportPartitionData:  called on the source member to serialize all partition data.
 * sendToDestination:    called to transmit the data to the destination member UUID.
 * importPartitionData:  called on the destination member to deserialize and install data.
 */
export interface MigrationTransport {
    /** Returns the local member UUID. */
    getLocalMemberId(): string;
    /**
     * Serializes all partition data for the given partition ID.
     * Returns namespaces with their key-value entries.
     */
    exportPartitionData(partitionId: number): MigrationNamespaceData[];
    /**
     * Sends the migration payload to the specified destination member.
     * Returns a Promise that resolves when the destination acknowledges the import.
     */
    sendMigrationData(
        destinationMemberId: string,
        migrationId: string,
        partitionId: number,
        namespaces: MigrationNamespaceData[],
    ): Promise<void>;
    /**
     * Installs migration data on this member (destination side).
     * Clears and repopulates the partition's record stores from the wire payload.
     */
    importPartitionData(partitionId: number, namespaces: MigrationNamespaceData[]): void;
    /**
     * Clears partition data from the source member after a successful MOVE migration.
     * Only invoked when the source is the local member.
     */
    clearPartitionData(partitionId: number): void;
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
    private _completedMigrations = 0;
    private _transport: MigrationTransport | null = null;
    /** Optional callback wired by the partition service to receive migration lifecycle events. */
    private _migrationEventCallback: ((event: MigrationEvent) => void) | null = null;
    /** Sequential index counter for migrations within the current round. */
    private _migrationIndex = 0;

    constructor(stateManager: PartitionStateManager, migrationQueue: MigrationQueue, options?: MigrationManagerOptions) {
        this._stateManager = stateManager;
        this._migrationQueue = migrationQueue;
        this._planner = new MigrationPlanner();
        this._maxParallelMigrations = options?.maxParallelMigrations ?? 10;
        this._paused = false;
    }

    /** Wire the transport callbacks required for real partition data transfer. */
    setMigrationTransport(transport: MigrationTransport): void {
        this._transport = transport;
    }

    /**
     * Wire a callback that receives migration lifecycle events.
     * Called by {@link InternalPartitionServiceImpl} to bridge migration
     * events to registered {@link MigrationListener} instances.
     */
    setMigrationEventCallback(callback: (event: MigrationEvent) => void): void {
        this._migrationEventCallback = callback;
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

        // Enqueue migration tasks — each task captures the migration info and
        // executes real data transfer when processQueue() is called.
        for (const migration of allMigrations) {
            const transport = this._transport;
            this._migrationQueue.add({
                run(): void {
                    // Synchronous stub: mark SUCCESS immediately.
                    // Real async transfer is driven by processQueueAsync().
                    migration.setStatus(MigrationStatus.SUCCESS);
                },
                // Carry the migration info so processQueueAsync() can drive real transfer.
                migration,
                transport,
            } as AsyncMigrationTask);
        }

        return allMigrations;
    }

    /** Drains and runs all queued migration tasks synchronously (legacy / no-transport path). */
    processQueue(): void {
        this._migrationIndex = 0;
        let task = this._migrationQueue.poll() as AsyncMigrationTask | null;
        while (task !== null) {
            const migration = task.migration;
            this._fireMigrationEvent(migration, 'STARTED');
            task.run();
            this._migrationQueue.afterTaskCompletion(task);
            this._completedMigrations++;
            const status = migration?.getStatus() === MigrationStatus.FAILED ? 'FAILED' : 'COMPLETED';
            this._fireMigrationEvent(migration, status);
            this._migrationIndex++;
            task = this._migrationQueue.poll() as AsyncMigrationTask | null;
        }
    }

    /**
     * Drains and executes all queued migration tasks with real data transfer.
     *
     * For each migration:
     * - If this member is the source and the destination is a different member:
     *   export the partition data and send it to the destination, then clear local data.
     * - If this member is the destination (new primary owner):
     *   data is pushed by the source; no local action needed during processQueueAsync.
     * - If migration is purely local (same member): mark SUCCESS directly.
     *
     * Each task is executed sequentially to respect partition ordering and avoid
     * concurrent state corruption on a single-threaded Bun runtime.
     */
    async processQueueAsync(): Promise<void> {
        this._migrationIndex = 0;
        let task = this._migrationQueue.poll() as AsyncMigrationTask | null;
        while (task !== null) {
            await this._executeAsyncTask(task);
            this._migrationQueue.afterTaskCompletion(task);
            this._completedMigrations++;
            this._migrationIndex++;
            task = this._migrationQueue.poll() as AsyncMigrationTask | null;
        }
    }

    private async _executeAsyncTask(task: AsyncMigrationTask): Promise<void> {
        const { migration, transport } = task;

        if (transport === null || migration === undefined) {
            // No transport wired or no migration info — legacy path.
            this._fireMigrationEvent(migration, 'STARTED');
            task.run();
            const status = migration?.getStatus() === MigrationStatus.FAILED ? 'FAILED' : 'COMPLETED';
            this._fireMigrationEvent(migration, status);
            return;
        }

        const localMemberId = transport.getLocalMemberId();
        const source = migration.getSource();
        const destination = migration.getDestination();
        const partitionId = migration.getPartitionId();

        // Determine if this is a MOVE (source loses ownership) or COPY (backup added).
        const isMove = migration.getSourceNewReplicaIndex() === -1;

        const sourceUuid = source?.uuid() ?? null;
        const destinationUuid = destination?.uuid() ?? null;

        this._fireMigrationEvent(migration, 'STARTED');

        // Case 1: This member is the source and needs to push data to another member.
        if (sourceUuid === localMemberId && destinationUuid !== null && destinationUuid !== localMemberId) {
            const namespaces = transport.exportPartitionData(partitionId);
            const migrationId = `mig-${partitionId}-${crypto.randomUUID()}`;

            try {
                await transport.sendMigrationData(destinationUuid, migrationId, partitionId, namespaces);
                if (isMove) {
                    transport.clearPartitionData(partitionId);
                }
                migration.setStatus(MigrationStatus.SUCCESS);
                this._fireMigrationEvent(migration, 'COMPLETED');
            } catch {
                migration.setStatus(MigrationStatus.FAILED);
                this._fireMigrationEvent(migration, 'FAILED');
            }
            return;
        }

        // Case 2: This member is the destination — source member pushes data proactively.
        // The data will arrive via MIGRATION_DATA message and be imported at that point.
        // We mark SUCCESS here since the source drives the transfer and will clear itself.
        if (destinationUuid === localMemberId && sourceUuid !== null && sourceUuid !== localMemberId) {
            // Destination side: data will be pushed by the source member.
            // Mark SUCCESS so the partition table update proceeds.
            migration.setStatus(MigrationStatus.SUCCESS);
            this._fireMigrationEvent(migration, 'COMPLETED');
            return;
        }

        // Case 3: Local-only migration (source === destination, or no remote peers involved).
        migration.setStatus(MigrationStatus.SUCCESS);
        this._fireMigrationEvent(migration, 'COMPLETED');
    }

    private _fireMigrationEvent(migration: MigrationInfo | undefined, status: MigrationEvent['status']): void {
        if (this._migrationEventCallback === null || migration === undefined) return;
        const source = migration.getSource();
        const destination = migration.getDestination();
        this._migrationEventCallback({
            partitionId: migration.getPartitionId(),
            oldOwner: source !== null ? _replicaToMemberInfo(source) : null,
            newOwner: destination !== null ? _replicaToMemberInfo(destination) : null,
            migrationIndex: this._migrationIndex,
            status,
        });
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

    /** Returns a point-in-time snapshot of migration queue statistics. */
    getStats(): MigrationStats {
        return {
            migrationQueueSize: this._migrationQueue.migrationTaskCount(),
            activeMigrations: this._migrationQueue.hasMigrationTasks() ? 1 : 0,
            completedMigrations: this._completedMigrations,
        };
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

/**
 * Internal task shape carrying the migration info and transport reference
 * so processQueueAsync() can perform real data transfer.
 */
interface AsyncMigrationTask {
    run(): void;
    migration: MigrationInfo;
    transport: MigrationTransport | null;
}

/**
 * Build a lightweight MemberInfo from a PartitionReplica.
 * Used when firing migration events — the full member metadata is not
 * available in MigrationManager, so we use UNKNOWN version and empty attributes.
 */
function _replicaToMemberInfo(replica: PartitionReplica): MemberInfo {
    return new MemberInfo(
        replica.address(),
        replica.uuid(),
        null,
        false,
        MemberVersion.UNKNOWN,
    );
}
