/**
 * Port of {@code com.hazelcast.internal.partition.impl.InternalPartitionServiceImpl}.
 *
 * Manages the partition table lifecycle: assignment, membership-triggered rebalancing,
 * runtime state application from master, partition queries, and Hazelcast-parity
 * backup recovery (promotion-first repair, refill, partition-lost, anti-entropy,
 * replica sync, stale-rejoin fencing, and recovery observability).
 *
 * Block 21.0: This is the single production partition-service authority.
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
import { MAX_REPLICA_COUNT } from '@zenystx/helios-core/internal/partition/InternalPartition';

/**
 * Represents the partition runtime state received from the master.
 */
export interface PartitionRuntimeState {
    partitions: (PartitionReplica | null)[][];
    versions: number[];
}

/** Partition-lost event emitted when all replicas for a partition are gone. */
export interface PartitionLostEvent {
    partitionId: number;
    lostReplicaCount: number;
}

/** Promotion info: which partition was promoted and from which replica index. */
export interface PromotionInfo {
    partitionId: number;
    promotedFromIndex: number;
    promotedMemberUuid: string;
}

/** Refill target: partition needing backup refill and at which replica index. */
export interface RefillTarget {
    partitionId: number;
    replicaIndex: number;
}

/** Result of a member-removal repair operation. */
export interface RepairResult {
    promotions: PromotionInfo[];
    refillTargets: RefillTarget[];
    partitionsLost: PartitionLostEvent[];
}

/** Pending sync request metadata. */
export interface SyncRequestInfo {
    id: string;
    partitionId: number;
    replicaIndex: number;
    targetUuid: string;
    timeoutMs: number;
    retryCount: number;
    epoch: number;
}

/** Anti-entropy configuration. */
export interface AntiEntropyConfig {
    intervalMs: number;
    maxParallelSyncs: number;
}

/** Recovery configuration. */
export interface RecoveryConfig {
    antiEntropyIntervalMs: number;
    syncTimeoutMs: number;
    syncRetryLimit: number;
    maxParallelSyncs: number;
}

/** Recovery metrics. */
export interface RecoveryMetrics {
    promotionCount: number;
    refillBacklog: number;
    syncRetries: number;
    syncTimeouts: number;
    staleResponseRejects: number;
    partitionsLost: number;
}

type PartitionLostListener = (event: PartitionLostEvent) => void;

/** Map-scoped partition-lost event — Hazelcast MapPartitionLostEvent parity. */
export interface MapPartitionLostEvent {
    mapName: string;
    partitionId: number;
    lostReplicaCount: number;
}

type MapPartitionLostListener = (event: MapPartitionLostEvent) => void;

export class InternalPartitionServiceImpl {
    private readonly _stateManager: PartitionStateManager;
    private readonly _partitionCount: number;
    private readonly _migrationAwareServices = new Map<string, MigrationAwareService>();
    private _completedMigrations: MigrationInfo[] = [];
    private _initialized: boolean;

    // ── Recovery state (Block 21.0) ──────────────────────────────

    /** Partition table snapshots stored before repartition for stale-rejoin fencing. */
    private readonly _snapshots = new Map<string, PartitionTableView>();
    /** Partition-lost listeners keyed by registration ID. */
    private readonly _partitionLostListeners = new Map<string, PartitionLostListener>();
    /** Map-scoped partition-lost listeners: registrationId → { mapName, listener }. */
    private readonly _mapPartitionLostListeners = new Map<string, { mapName: string; listener: MapPartitionLostListener }>();
    /** Pending replica sync requests keyed by sync ID. */
    private readonly _pendingSyncRequests = new Map<string, SyncRequestInfo>();
    /** Fenced rejoining member UUIDs. */
    private readonly _rejoinFences = new Set<string>();
    /** Current sync session epoch — incremented on ownership changes to invalidate stale syncs. */
    private _syncEpoch = 0;
    /** Anti-entropy running flag. */
    private _antiEntropyRunning = false;
    /** Anti-entropy interval handle. */
    private _antiEntropyTimer: ReturnType<typeof setInterval> | null = null;
    /** Configured backup count from last firstArrangement. */
    private _backupCount = 0;

    /** Recovery metrics accumulators. */
    private _metrics: RecoveryMetrics = {
        promotionCount: 0,
        refillBacklog: 0,
        syncRetries: 0,
        syncTimeouts: 0,
        staleResponseRejects: 0,
        partitionsLost: 0,
    };

    /** Recovery config with sensible defaults. */
    private readonly _recoveryConfig: RecoveryConfig = {
        antiEntropyIntervalMs: 1000,
        syncTimeoutMs: 300_000,
        syncRetryLimit: 10,
        maxParallelSyncs: 20,
    };

    /** Supported replicated service names. */
    private static readonly SUPPORTED_SERVICES = ['map', 'queue', 'ringbuffer'];
    /** Explicitly unsupported (deferred) service names. */
    private static readonly UNSUPPORTED_SERVICES = ['cache', 'sql', 'transaction'];

    constructor(partitionCount: number = 271) {
        this._partitionCount = partitionCount;
        this._stateManager = new PartitionStateManager(partitionCount);
        this._initialized = false;
    }

    // ── PartitionService interface (R1: unified authority) ───────

    getPartitionCount(): number {
        return this._partitionCount;
    }

    getPartitionId(key: Data): number {
        return this._stateManager.getPartitionId(key);
    }

    getPartitionOwner(partitionId: number): PartitionReplica | null {
        return this._stateManager.getPartitionOwner(partitionId);
    }

    /** PartitionService.getPartitionOwner returns Address for SPI contract. */
    getPartitionOwnerAddress(partitionId: number): Address | null {
        return this._stateManager.getPartitionOwner(partitionId)?.address() ?? null;
    }

    isMigrating(partitionId: number): boolean {
        return this._stateManager.getPartition(partitionId).isMigrating();
    }

    // ── Partition table lifecycle ────────────────────────────────

    firstArrangement(members: Member[], _masterAddress: Address, backupCount: number = 0): void {
        this._backupCount = backupCount;
        this._stateManager.initializePartitionAssignments(members, backupCount);
        this._initialized = true;
    }

    memberAdded(currentMembers: Member[]): void {
        const newAssignment = this._stateManager.repartition(currentMembers, []);
        this._applyNewAssignment(newAssignment);
    }

    /**
     * Legacy member-removed: direct repartition without promotion-first semantics.
     * Kept for backward compatibility; prefer {@link memberRemovedWithRepair}.
     */
    memberRemoved(removedMember: Member, remainingMembers: Member[]): void {
        const newAssignment = this._stateManager.repartition(remainingMembers, [removedMember]);
        this._applyNewAssignment(newAssignment);
    }

    /**
     * Hazelcast-parity member removal with promotion-first repair pipeline.
     *
     * 1. Cancel sync requests targeting departed member
     * 2. Store snapshot for stale-rejoin fencing
     * 3. Remove departed member from partition table
     * 4. Promote surviving backups to owner where owner is missing
     * 5. Emit partition-lost for partitions with no surviving replicas
     * 6. Identify refill targets for empty backup slots
     * 7. Increment sync epoch to invalidate stale sync responses
     */
    memberRemovedWithRepair(removedMember: Member, remainingMembers: Member[]): RepairResult {
        const removedUuid = removedMember.getUuid();
        const promotions: PromotionInfo[] = [];
        const refillTargets: RefillTarget[] = [];
        const partitionsLost: PartitionLostEvent[] = [];

        // Step 1: Cancel sync requests targeting departed member
        this.cancelReplicaSyncRequestsTo(removedUuid);

        // Step 2: Store snapshot for fencing
        this.storeSnapshot(removedUuid);

        // Step 3: Fence the departing member
        this._rejoinFences.add(removedUuid);

        // Step 4: Remove departed member from all replica slots
        for (let pid = 0; pid < this._partitionCount; pid++) {
            const partition = this._stateManager.getPartition(pid);
            for (let r = 0; r < MAX_REPLICA_COUNT; r++) {
                const replica = partition.getReplica(r);
                if (replica && replica.uuid() === removedUuid) {
                    partition.setReplica(r, null);
                }
            }
        }

        // Step 5: Promote surviving backups where owner is missing
        for (let pid = 0; pid < this._partitionCount; pid++) {
            const partition = this._stateManager.getPartition(pid);
            const owner = partition.getReplica(0);

            if (owner === null) {
                // Find first surviving backup
                let promotedFromIndex = -1;
                for (let r = 1; r < MAX_REPLICA_COUNT; r++) {
                    const backup = partition.getReplica(r);
                    if (backup !== null) {
                        promotedFromIndex = r;
                        break;
                    }
                }

                if (promotedFromIndex >= 0) {
                    // Promote: swap backup into owner slot
                    partition.swapReplicas(0, promotedFromIndex);
                    const promoted = partition.getReplica(0)!;
                    promotions.push({
                        partitionId: pid,
                        promotedFromIndex,
                        promotedMemberUuid: promoted.uuid(),
                    });
                    this._metrics.promotionCount++;
                } else {
                    // No surviving replica — partition is lost
                    const event: PartitionLostEvent = {
                        partitionId: pid,
                        lostReplicaCount: MAX_REPLICA_COUNT,
                    };
                    partitionsLost.push(event);
                    this._emitPartitionLost(event);
                    this._metrics.partitionsLost++;
                }
            }
        }

        // Step 6: Identify refill targets (empty backup slots where capacity exists)
        const validUuids = new Set(remainingMembers.map(m => m.getUuid()));
        for (let pid = 0; pid < this._partitionCount; pid++) {
            const partition = this._stateManager.getPartition(pid);
            const owner = partition.getReplica(0);
            if (owner === null) continue; // Already lost

            for (let r = 1; r <= this._backupCount && r < MAX_REPLICA_COUNT; r++) {
                const backup = partition.getReplica(r);
                if (backup === null) {
                    // Check if there's a member not already assigned to this partition
                    const assigned = new Set<string>();
                    for (let ri = 0; ri < MAX_REPLICA_COUNT; ri++) {
                        const rep = partition.getReplica(ri);
                        if (rep) assigned.add(rep.uuid());
                    }
                    const hasCapacity = [...validUuids].some(uuid => !assigned.has(uuid));
                    if (hasCapacity) {
                        refillTargets.push({ partitionId: pid, replicaIndex: r });
                    }
                }
            }
        }

        // Step 7: Increment sync epoch
        this._syncEpoch++;
        this._metrics.refillBacklog = refillTargets.length;

        this._stateManager.updateStamp();
        return { promotions, refillTargets, partitionsLost };
    }

    // ── Partition-lost events (R5) ──────────────────────────────

    onPartitionLost(listener: PartitionLostListener): string {
        const id = crypto.randomUUID();
        this._partitionLostListeners.set(id, listener);
        return id;
    }

    removePartitionLostListener(listenerId: string): boolean {
        return this._partitionLostListeners.delete(listenerId);
    }

    private _emitPartitionLost(event: PartitionLostEvent): void {
        for (const listener of this._partitionLostListeners.values()) {
            listener(event);
        }
        // Emit to all registered map-scoped listeners
        for (const entry of this._mapPartitionLostListeners.values()) {
            entry.listener({
                mapName: entry.mapName,
                partitionId: event.partitionId,
                lostReplicaCount: event.lostReplicaCount,
            });
        }
    }

    // ── Map-scoped partition-lost events (R5/R8 parity) ────────

    onMapPartitionLost(mapName: string, listener: MapPartitionLostListener): string {
        const id = crypto.randomUUID();
        this._mapPartitionLostListeners.set(id, { mapName, listener });
        return id;
    }

    removeMapPartitionLostListener(listenerId: string): boolean {
        return this._mapPartitionLostListeners.delete(listenerId);
    }

    // ── Sync request management (R7) ────────────────────────────

    cancelReplicaSyncRequestsTo(memberUuid: string): void {
        for (const [id, info] of this._pendingSyncRequests) {
            if (info.targetUuid === memberUuid) {
                this._pendingSyncRequests.delete(id);
            }
        }
    }

    getPendingSyncRequests(): SyncRequestInfo[] {
        return [...this._pendingSyncRequests.values()];
    }

    registerSyncRequest(partitionId: number, replicaIndex: number, targetUuid: string): string {
        const id = crypto.randomUUID();
        this._pendingSyncRequests.set(id, {
            id,
            partitionId,
            replicaIndex,
            targetUuid,
            timeoutMs: this._recoveryConfig.syncTimeoutMs,
            retryCount: 0,
            epoch: this._syncEpoch,
        });
        return id;
    }

    getSyncRequestInfo(syncId: string): SyncRequestInfo | null {
        return this._pendingSyncRequests.get(syncId) ?? null;
    }

    completeSyncRequest(syncId: string, _versions: bigint[]): boolean {
        const info = this._pendingSyncRequests.get(syncId);
        if (!info) return false;

        // Reject stale: epoch must match current
        if (info.epoch !== this._syncEpoch) {
            this._pendingSyncRequests.delete(syncId);
            this._metrics.staleResponseRejects++;
            return false;
        }

        this._pendingSyncRequests.delete(syncId);
        return true;
    }

    // ── Snapshot management (R2/R4 stale-rejoin fencing) ────────

    storeSnapshot(memberUuid: string): void {
        this._snapshots.set(memberUuid, this._stateManager.toPartitionTableView());
    }

    getSnapshot(memberUuid: string): PartitionTableView | null {
        return this._snapshots.get(memberUuid) ?? null;
    }

    removeSnapshot(memberUuid: string): void {
        this._snapshots.delete(memberUuid);
    }

    // ── Stale-rejoin fencing ────────────────────────────────────

    isRejoiningMemberFenced(memberUuid: string): boolean {
        return this._rejoinFences.has(memberUuid);
    }

    clearRejoinFence(memberUuid: string): void {
        this._rejoinFences.delete(memberUuid);
        this._snapshots.delete(memberUuid);
    }

    // ── Anti-entropy lifecycle (R6) ─────────────────────────────

    startAntiEntropy(): void {
        if (this._antiEntropyRunning) return;
        this._antiEntropyRunning = true;
        // Production scheduling — runs periodically
        this._antiEntropyTimer = setInterval(() => {
            this._runAntiEntropyCycle();
        }, this._recoveryConfig.antiEntropyIntervalMs);
    }

    stopAntiEntropy(): void {
        this._antiEntropyRunning = false;
        if (this._antiEntropyTimer !== null) {
            clearInterval(this._antiEntropyTimer);
            this._antiEntropyTimer = null;
        }
    }

    isAntiEntropyRunning(): boolean {
        return this._antiEntropyRunning;
    }

    getAntiEntropyConfig(): AntiEntropyConfig {
        return {
            intervalMs: this._recoveryConfig.antiEntropyIntervalMs,
            maxParallelSyncs: this._recoveryConfig.maxParallelSyncs,
        };
    }

    private _runAntiEntropyCycle(): void {
        // Placeholder for runtime cycle — in production this generates
        // PartitionBackupReplicaAntiEntropyOp for each local partition's backups
        // and dispatches them via OperationService.
    }

    // ── Shutdown and demotion ───────────────────────────────────

    shutdown(): void {
        this.stopAntiEntropy();
        this._pendingSyncRequests.clear();
        this._rejoinFences.clear();
    }

    onDemotion(): void {
        this.stopAntiEntropy();
        this._pendingSyncRequests.clear();
        this._syncEpoch++;
    }

    // ── Recovery config and observability (R8A) ─────────────────

    getRecoveryConfig(): RecoveryConfig {
        return { ...this._recoveryConfig };
    }

    getRecoveryMetrics(): RecoveryMetrics {
        return { ...this._metrics };
    }

    getDegradedPartitionCount(): number {
        let count = 0;
        for (let pid = 0; pid < this._partitionCount; pid++) {
            const partition = this._stateManager.getPartition(pid);
            const owner = partition.getReplica(0);
            if (owner === null) {
                count++;
                continue;
            }
            // Check if any expected backup slot is empty
            for (let r = 1; r <= this._backupCount && r < MAX_REPLICA_COUNT; r++) {
                if (partition.getReplica(r) === null) {
                    count++;
                    break;
                }
            }
        }
        return count;
    }

    isClusterSafe(): boolean {
        return this.getDegradedPartitionCount() === 0 && this._initialized;
    }

    // ── Service-state replication closure (R8) ──────────────────

    getSupportedReplicatedServices(): string[] {
        return [...InternalPartitionServiceImpl.SUPPORTED_SERVICES];
    }

    getUnsupportedReplicatedServices(): string[] {
        return [...InternalPartitionServiceImpl.UNSUPPORTED_SERVICES];
    }

    // ── Existing API preserved ──────────────────────────────────

    isInitialized(): boolean {
        return this._initialized;
    }

    getPartition(partitionId: number): InternalPartitionImpl {
        return this._stateManager.getPartition(partitionId);
    }

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

    applyCompletedMigrations(migrations: readonly MigrationInfo[]): boolean {
        for (const migration of migrations) {
            const partitionId = migration.getPartitionId();
            const partition = this._stateManager.getPartition(partitionId);
            const currentVersion = partition.version();
            const initialVersion = migration.getInitialPartitionVersion();

            if (initialVersion !== currentVersion) {
                return false;
            }

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

    clearCompletedMigrations(): void {
        this._completedMigrations = [];
    }

    getCompletedMigrations(): readonly MigrationInfo[] {
        return this._completedMigrations;
    }

    onMigrationFailure(partitionId: number, replicaCount: number): void {
        const partition = this._stateManager.getPartition(partitionId);
        partition.setVersion(partition.version() + replicaCount + 1);
        this._stateManager.updateStamp();
    }

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

    private _applyNewAssignment(newAssignment: (PartitionReplica | null)[][]): void {
        for (let i = 0; i < this._partitionCount; i++) {
            const partition = this._stateManager.getPartition(i);
            partition.setReplicas(newAssignment[i]);
        }
        this._stateManager.updateStamp();
    }
}
