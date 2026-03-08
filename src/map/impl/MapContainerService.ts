/**
 * Service registered under {@code MapService.SERVICE_NAME} in NodeEngine.
 *
 * Holds one {@link RecordStore} per (mapName, partitionId) pair.
 * Implements {@link MigrationAwareService} for partition migration participation:
 * replication, before/commit/rollback lifecycle, and write-behind state transfer.
 *
 * Block 21.3 additions:
 * - Staged beforePromotion → state install → finalize promotion flow
 * - Partition ownership epoch fencing on promotion/handoff
 * - Owner traffic gating until finalize publishes new epoch
 * - Coordinated clustered EAGER load (one loadAllKeys per map, no duplicates)
 * - Coordinated clustered clear (owner-only external deletes)
 * - Graceful shutdown flush/handoff for write-behind queues
 *
 * Port of the partition-container lookup path in
 * {@code com.hazelcast.map.impl.MapServiceContextImpl} and migration-aware
 * behavior from {@code com.hazelcast.map.impl.MapMigrationAwareService}.
 */
import type { MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import type { StoreLatencyTracker } from '@zenystx/helios-core/diagnostics/StoreLatencyTracker';
import { LocalMapStatsImpl } from '@zenystx/helios-core/internal/monitor/impl/LocalMapStatsImpl';
import { PartitionContainer } from '@zenystx/helios-core/internal/partition/impl/PartitionContainer';
import type { MigrationAwareService } from '@zenystx/helios-core/internal/partition/MigrationAwareService';
import type { ReplicationNamespaceState } from '@zenystx/helios-core/internal/partition/operation/PartitionReplicaSyncResponse';
import type { PartitionMigrationEvent } from '@zenystx/helios-core/internal/partition/PartitionMigrationEvent';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { ServiceNamespace } from '@zenystx/helios-core/internal/services/ServiceNamespace';
import { EmptyMapDataStore } from '@zenystx/helios-core/map/impl/mapstore/EmptyMapDataStore';
import type { MapDataStore } from '@zenystx/helios-core/map/impl/mapstore/MapDataStore';
import { MapStoreContext } from '@zenystx/helios-core/map/impl/mapstore/MapStoreContext';
import { WriteBehindStore } from '@zenystx/helios-core/map/impl/mapstore/writebehind/WriteBehindStore';
import { MapNearCacheStateHolder } from '@zenystx/helios-core/map/impl/operation/MapNearCacheStateHolder';
import { MapReplicationOperation } from '@zenystx/helios-core/map/impl/operation/MapReplicationOperation';
import { MapReplicationStateHolder } from '@zenystx/helios-core/map/impl/operation/MapReplicationStateHolder';
import { WriteBehindStateHolder } from '@zenystx/helios-core/map/impl/operation/WriteBehindStateHolder';
import { DefaultRecordStore } from '@zenystx/helios-core/map/impl/recordstore/DefaultRecordStore';
import type { RecordStore } from '@zenystx/helios-core/map/impl/recordstore/RecordStore';
import type { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine';

/**
 * Epoch-fenced promotion record for a partition. Tracks the ownership epoch,
 * source/target member identity, and promotion state.
 */
export interface PromotionRecord {
    readonly partitionId: number;
    readonly epoch: number;
    readonly sourceUuid: string;
    readonly targetUuid: string;
    readonly state: 'before' | 'installing' | 'finalized';
}

/**
 * Coordinated EAGER load epoch. Tracks in-progress coordinated loads to prevent
 * duplicate loadAllKeys sweeps on join/rebalance.
 */
export interface EagerLoadEpoch {
    readonly mapName: string;
    readonly epoch: number;
    readonly startedAt: number;
    readonly completedPartitions: Set<number>;
    readonly assignedPartitions: Set<number>;
}

export class MapContainerService implements MigrationAwareService {
    private readonly _stores = new Map<string, RecordStore>();

    /** Per-map LocalMapStatsImpl instances, keyed by map name. */
    private readonly _mapStats = new Map<string, LocalMapStatsImpl>();

    /** Optional store latency tracker — injected by HeliosInstanceImpl when monitoring is enabled. */
    private _storeLatencyTracker: StoreLatencyTracker | null = null;

    /** Per-map MapStoreContext instances (created lazily via singleflight). */
    private readonly _mapStoreContexts = new Map<string, MapStoreContext<unknown, unknown>>();
    /** In-flight context init promises to prevent duplicate initialization. */
    private readonly _mapStoreContextInitPromises = new Map<string, Promise<MapStoreContext<unknown, unknown>>>();

    /** Registered MapStoreConfigs per map name — used by operations to trigger lazy init on the owner. */
    private readonly _mapStoreConfigs = new Map<string, MapStoreConfig>();

    /** Per-partition containers used for migration replication. */
    private readonly _partitionContainers = new Map<number, PartitionContainer>();

    /** Optional NodeEngine for EAGER load serialization. */
    private _nodeEngine: NodeEngine | null = null;

    // ═══════════════════════════════════════════════════════════════════
    // Block 21.3: Epoch fencing and staged promotion state
    // ═══════════════════════════════════════════════════════════════════

    /** Per-partition ownership epoch. Incremented on each finalized promotion. */
    private readonly _partitionEpochs = new Map<number, number>();

    /**
     * Per-partition pending promotion records. When a promotion is pending,
     * owner traffic and external MapStore writes are fenced until finalize.
     */
    private readonly _pendingPromotions = new Map<number, PromotionRecord>();

    /**
     * Partitions whose owner traffic is fenced. External MapStore writes/loads/deletes
     * are rejected for fenced partitions. The old owner is also fenced so it stops
     * new partition work and drops late flushes, retries, acks, and completions.
     */
    private readonly _fencedPartitions = new Set<number>();

    /**
     * Partitions whose old owner has been explicitly fenced (retired epoch).
     * Late flushes, retries, acks, and offloaded completions from the retired
     * epoch are dropped.
     */
    private readonly _retiredOwnerPartitions = new Set<number>();

    // ═══════════════════════════════════════════════════════════════════
    // Block 21.3: Coordinated EAGER load state
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Active EAGER load epochs per map. Ensures one coordinated load epoch
     * survives member join/rebalance without a second full loadAllKeys sweep.
     */
    private readonly _eagerLoadEpochs = new Map<string, EagerLoadEpoch>();

    /** Global EAGER load epoch counter. */
    private _eagerLoadEpochCounter = 0;

    setNodeEngine(nodeEngine: NodeEngine): void {
        this._nodeEngine = nodeEngine;
    }

    private _storeKey(mapName: string, partitionId: number): string {
        return `${mapName}:${partitionId}`;
    }

    // ═══════════════════════════════════════════════════════════════════
    // RecordStore access
    // ═══════════════════════════════════════════════════════════════════

    getOrCreateRecordStore(mapName: string, partitionId: number): RecordStore {
        const key = this._storeKey(mapName, partitionId);
        let store = this._stores.get(key);
        if (store === undefined) {
            store = new DefaultRecordStore();
            this._stores.set(key, store);
        }
        return store;
    }

    setRecordStore(mapName: string, partitionId: number, store: RecordStore): void {
        this._stores.set(this._storeKey(mapName, partitionId), store);
    }

    getRecordStore(mapName: string, partitionId: number): RecordStore | null {
        return this._stores.get(this._storeKey(mapName, partitionId)) ?? null;
    }

    getPartitionNamespaces(partitionId: number): string[] {
        const suffix = `:${partitionId}`;
        const names: string[] = [];
        for (const key of this._stores.keys()) {
            if (key.endsWith(suffix)) {
                names.push(key.slice(0, key.length - suffix.length));
            }
        }
        return names;
    }

    collectPartitionNamespaceStates(partitionId: number, namespaces?: readonly string[]): ReplicationNamespaceState[] {
        const targetNamespaces = namespaces === undefined
            ? this.getPartitionNamespaces(partitionId)
            : [...namespaces];
        const states: ReplicationNamespaceState[] = [];

        for (const namespace of targetNamespaces) {
            const store = this.getRecordStore(namespace, partitionId);
            const entries: Array<readonly [Data, Data]> = [];
            let estimatedSizeBytes = 0;

            if (store !== null) {
                for (const [key, value] of store.entries()) {
                    entries.push([key, value]);
                    estimatedSizeBytes += (key.toByteArray()?.length ?? 0) + (value.toByteArray()?.length ?? 0);
                }
            }

            states.push({ namespace, entries, estimatedSizeBytes });
        }

        return states;
    }

    getOrCreatePartitionContainer(partitionId: number): PartitionContainer {
        return this._getOrCreatePartitionContainer(partitionId);
    }

    applyReplicaSyncState(partitionId: number, states: readonly ReplicationNamespaceState[]): void {
        const container = this._getOrCreatePartitionContainer(partitionId);

        for (const state of states) {
            const recordStore = this.getOrCreateRecordStore(state.namespace, partitionId);
            recordStore.clear();

            const partitionStore = container.getRecordStore(state.namespace);
            partitionStore.clear();

            for (const [key, value] of state.entries) {
                recordStore.put(key, value, -1, -1);
                partitionStore.put(key, value, -1, -1);
            }
        }
    }

    *getAllEntries(mapName: string): IterableIterator<readonly [import('@zenystx/helios-core/internal/serialization/Data').Data, import('@zenystx/helios-core/internal/serialization/Data').Data]> {
        const prefix = `${mapName}:`;
        for (const [storeKey, store] of this._stores) {
            if (storeKey.startsWith(prefix)) {
                yield* store.entries();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // MapDataStore lifecycle
    // ═══════════════════════════════════════════════════════════════════

    async getOrCreateMapDataStore<K, V>(
        mapName: string,
        mapStoreConfig: MapStoreConfig,
    ): Promise<MapDataStore<K, V>> {
        if (!mapStoreConfig.isEnabled()) {
            return EmptyMapDataStore.empty<K, V>();
        }

        const existing = this._mapStoreContexts.get(mapName);
        if (existing) {
            return existing.getMapDataStore() as MapDataStore<K, V>;
        }

        let inFlight = this._mapStoreContextInitPromises.get(mapName);
        if (!inFlight) {
            inFlight = (async () => {
                const created = await MapStoreContext.create<K, V>(mapName, mapStoreConfig) as unknown as MapStoreContext<unknown, unknown>;
                if (this._storeLatencyTracker !== null) {
                    created.setLatencyTracker(this._storeLatencyTracker);
                }
                this._mapStoreContexts.set(mapName, created);

                // EAGER load: pre-populate RecordStore via NodeEngine serialization
                const initial = (created as unknown as MapStoreContext<K, V>).getInitialEntries();
                if (initial && this._nodeEngine) {
                    this._applyEagerEntries(mapName, initial as Map<unknown, unknown>);
                }

                return created;
            })();
            this._mapStoreContextInitPromises.set(mapName, inFlight);
        }

        let ctx: MapStoreContext<unknown, unknown>;
        try {
            ctx = await inFlight;
        } finally {
            this._mapStoreContextInitPromises.delete(mapName);
        }

        return ctx.getMapDataStore() as MapDataStore<K, V>;
    }

    registerMapStoreConfig(mapName: string, config: MapStoreConfig): void {
        this._mapStoreConfigs.set(mapName, config);
    }

    getExistingMapDataStore<K, V>(mapName: string): MapDataStore<K, V> {
        const ctx = this._mapStoreContexts.get(mapName);
        if (ctx) {
            return ctx.getMapDataStore() as MapDataStore<K, V>;
        }
        return EmptyMapDataStore.empty<K, V>();
    }

    async ensureMapDataStoreInitialized(mapName: string): Promise<void> {
        if (this._mapStoreContexts.has(mapName)) return;
        const config = this._mapStoreConfigs.get(mapName);
        if (config && config.isEnabled()) {
            await this.getOrCreateMapDataStore(mapName, config);
        }
    }

    hasMapStoreConfig(mapName: string): boolean {
        return this._mapStoreConfigs.has(mapName);
    }

    async destroyMapStoreContext(mapName: string): Promise<void> {
        const ctx = this._mapStoreContexts.get(mapName);
        if (ctx) {
            await ctx.destroy();
            this._mapStoreContexts.delete(mapName);
        }
    }

    async flushAll(): Promise<void> {
        const destroyPromises: Promise<void>[] = [];
        for (const [mapName] of this._mapStoreContexts) {
            destroyPromises.push(this.destroyMapStoreContext(mapName));
        }
        await Promise.all(destroyPromises);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Block 21.3: Partition ownership epoch fencing
    // ═══════════════════════════════════════════════════════════════════

    /** Returns the current ownership epoch for a partition. */
    getPartitionEpoch(partitionId: number): number {
        return this._partitionEpochs.get(partitionId) ?? 0;
    }

    /**
     * Validates that a message/operation matches the current epoch and expected
     * source/target. Returns false if the epoch, owner, or expected target no
     * longer match — the caller must reject the operation.
     */
    validateEpoch(partitionId: number, expectedEpoch: number, expectedOwnerUuid?: string): boolean {
        const currentEpoch = this.getPartitionEpoch(partitionId);
        if (expectedEpoch !== currentEpoch) return false;
        if (expectedOwnerUuid !== undefined) {
            const promo = this._pendingPromotions.get(partitionId);
            if (promo && promo.targetUuid !== expectedOwnerUuid) return false;
        }
        return true;
    }

    /**
     * Returns true if the partition is currently fenced — no owner traffic or
     * external MapStore operations should execute.
     */
    isPartitionFenced(partitionId: number): boolean {
        return this._fencedPartitions.has(partitionId);
    }

    /**
     * Returns true if the partition's old owner has been retired — late flushes,
     * retries, acks, and offloaded completions from the old epoch should be dropped.
     */
    isOldOwnerRetired(partitionId: number): boolean {
        return this._retiredOwnerPartitions.has(partitionId);
    }

    ensureExternalMapStoreOperationAllowed(partitionId: number): void {
        if (this.isPartitionFenced(partitionId)) {
            throw new Error(`Partition ${partitionId} is fenced for external MapStore work`);
        }
    }

    getMapCoordinationPartitionId(mapName: string): number {
        if (!this._nodeEngine) {
            return 0;
        }
        const data = this._nodeEngine.toData(`__mapstore_coord__:${mapName}`);
        if (data === null) {
            return 0;
        }
        return this._nodeEngine.getPartitionService().getPartitionId(data);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Block 21.3: Staged promotion flow
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Stage 1: beforePromotion. Prepares the partition for ownership transfer.
     * Fences the partition so no owner traffic or external writes execute.
     * Fences the old owner so it stops new work and drops late completions.
     */
    beforePromotion(partitionId: number, sourceUuid: string, targetUuid: string): PromotionRecord {
        const currentEpoch = this.getPartitionEpoch(partitionId);
        const record: PromotionRecord = {
            partitionId,
            epoch: currentEpoch,
            sourceUuid,
            targetUuid,
            state: 'before',
        };
        this._pendingPromotions.set(partitionId, record);
        this._fencedPartitions.add(partitionId);
        this._retiredOwnerPartitions.add(partitionId);
        return record;
    }

    /**
     * Stage 2: installState. Installs replicated state on the promoted target.
     * The partition remains fenced during installation.
     */
    installPromotionState(partitionId: number): PromotionRecord | null {
        const record = this._pendingPromotions.get(partitionId);
        if (!record || record.state !== 'before') return null;
        const updated: PromotionRecord = { ...record, state: 'installing' };
        this._pendingPromotions.set(partitionId, updated);
        return updated;
    }

    /**
     * Stage 3: finalizePromotion. Publishes the new ownership epoch and unfences
     * the partition, allowing owner traffic to resume on the new owner.
     * The old owner fence remains — late operations from the retired epoch are dropped.
     */
    finalizePromotion(partitionId: number, expectedSourceUuid: string, expectedTargetUuid: string): number {
        const record = this._pendingPromotions.get(partitionId);
        if (record) {
            // Validate source/target identity
            if (record.sourceUuid !== expectedSourceUuid || record.targetUuid !== expectedTargetUuid) {
                return -1; // Reject: identity mismatch
            }
        }

        // Increment ownership epoch
        const newEpoch = (this._partitionEpochs.get(partitionId) ?? 0) + 1;
        this._partitionEpochs.set(partitionId, newEpoch);

        // Unfence the partition for owner traffic
        this._fencedPartitions.delete(partitionId);
        this._pendingPromotions.delete(partitionId);

        // Old owner stays retired — late operations from old epoch are still dropped
        return newEpoch;
    }

    /** Returns the pending promotion record for a partition, if any. */
    getPendingPromotion(partitionId: number): PromotionRecord | null {
        return this._pendingPromotions.get(partitionId) ?? null;
    }

    /**
     * Clears the retired-owner fence for a partition. Called when the old owner
     * has been fully cleaned up or has departed.
     */
    clearRetiredOwner(partitionId: number): void {
        this._retiredOwnerPartitions.delete(partitionId);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Block 21.3: Coordinated clustered EAGER load
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Begins a coordinated EAGER load epoch for a map. Returns the epoch or
     * the existing active epoch if one is already in progress.
     * Prevents duplicate loadAllKeys sweeps on join/rebalance.
     */
    beginEagerLoadEpoch(mapName: string, assignedPartitions: number[]): EagerLoadEpoch {
        const existing = this._eagerLoadEpochs.get(mapName);
        if (existing) {
            // Reuse existing epoch — survives join/rebalance
            return existing;
        }

        const epoch: EagerLoadEpoch = {
            mapName,
            epoch: ++this._eagerLoadEpochCounter,
            startedAt: Date.now(),
            completedPartitions: new Set<number>(),
            assignedPartitions: new Set(assignedPartitions),
        };
        this._eagerLoadEpochs.set(mapName, epoch);
        return epoch;
    }

    /**
     * Marks a partition as completed in the active EAGER load epoch.
     * Returns true if the entire load epoch is now complete.
     */
    markEagerLoadPartitionComplete(mapName: string, partitionId: number): boolean {
        const epoch = this._eagerLoadEpochs.get(mapName);
        if (!epoch) return false;

        epoch.completedPartitions.add(partitionId);

        if (epoch.completedPartitions.size >= epoch.assignedPartitions.size) {
            this._eagerLoadEpochs.delete(mapName);
            return true;
        }
        return false;
    }

    /** Returns the active EAGER load epoch for a map, if any. */
    getEagerLoadEpoch(mapName: string): EagerLoadEpoch | null {
        return this._eagerLoadEpochs.get(mapName) ?? null;
    }

    /** Returns true if an EAGER load is in progress for this map. */
    isEagerLoadInProgress(mapName: string): boolean {
        return this._eagerLoadEpochs.has(mapName);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Block 21.3: Graceful shutdown handoff
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Graceful shutdown: flushes all write-behind queues and destroys all
     * MapStoreContexts. Returns the number of entries flushed.
     */
    async gracefulShutdownFlush(): Promise<number> {
        let flushedCount = 0;
        for (const [, ctx] of this._mapStoreContexts) {
            const ds = ctx.getMapDataStore();
            if (ds instanceof WriteBehindStore && ds.hasPendingWrites()) {
                flushedCount++;
            }
        }
        await this.flushAll();
        // Clear all fencing state on shutdown
        this._fencedPartitions.clear();
        this._retiredOwnerPartitions.clear();
        this._pendingPromotions.clear();
        this._eagerLoadEpochs.clear();
        return flushedCount;
    }

    // ═══════════════════════════════════════════════════════════════════
    // MigrationAwareService implementation
    // ═══════════════════════════════════════════════════════════════════

    prepareReplicationOperation(
        event: PartitionMigrationEvent,
        namespaces: ServiceNamespace[],
    ): Operation | null {
        const partitionId = event.partitionId;

        const container = this._getOrCreatePartitionContainer(partitionId);

        for (const ns of namespaces) {
            const mapName = ns.getServiceName();
            const rs = this.getRecordStore(mapName, partitionId);
            if (rs && rs.size() > 0) {
                const destRs = container.getRecordStore(mapName);
                destRs.clear();
                for (const [key, value] of rs.entries()) {
                    destRs.put(key, value, -1, -1);
                }
            }
        }

        const mapStateHolder = new MapReplicationStateHolder();
        mapStateHolder.prepare(container, partitionId, 0);

        const wbStateHolder = new WriteBehindStateHolder();
        const writeBehindStores = this._collectWriteBehindStores(namespaces);
        if (writeBehindStores.size > 0) {
            wbStateHolder.prepare(writeBehindStores);
        }

        const ncStateHolder = new MapNearCacheStateHolder();

        if (mapStateHolder.mapData.size === 0 && wbStateHolder.delayedEntries.size === 0) {
            return null;
        }

        return new MapReplicationOperation(
            partitionId,
            0,
            mapStateHolder,
            wbStateHolder,
            ncStateHolder,
        ) as unknown as Operation;
    }

    beforeMigration(event: PartitionMigrationEvent): void {
        // Fence the partition during migration to prevent concurrent MapStore operations
        this._fencedPartitions.add(event.partitionId);
    }

    commitMigration(event: PartitionMigrationEvent): void {
        const partitionId = event.partitionId;

        // Unfence the partition after successful migration
        this._fencedPartitions.delete(partitionId);

        if (event.source !== null && event.migrationType === 'MOVE') {
            this._removeRecordStoresForPartition(partitionId);
            this._stopWriteBehindWorkersForPartition(partitionId);
            // Increment epoch to fence the old owner
            const newEpoch = (this._partitionEpochs.get(partitionId) ?? 0) + 1;
            this._partitionEpochs.set(partitionId, newEpoch);
        }
    }

    rollbackMigration(event: PartitionMigrationEvent): void {
        const partitionId = event.partitionId;

        // Unfence the partition after rollback
        this._fencedPartitions.delete(partitionId);

        if (event.destination !== null) {
            this._removeRecordStoresForPartition(partitionId);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // Migration helpers
    // ═══════════════════════════════════════════════════════════════════

    private _getOrCreatePartitionContainer(partitionId: number): PartitionContainer {
        let container = this._partitionContainers.get(partitionId);
        if (!container) {
            container = new PartitionContainer(partitionId);
            this._partitionContainers.set(partitionId, container);
        }
        return container;
    }

    private _collectWriteBehindStores(
        namespaces: ServiceNamespace[],
    ): Map<string, WriteBehindStore<unknown, unknown>> {
        const stores = new Map<string, WriteBehindStore<unknown, unknown>>();
        for (const ns of namespaces) {
            const mapName = ns.getServiceName();
            const ctx = this._mapStoreContexts.get(mapName);
            if (ctx) {
                const dataStore = ctx.getMapDataStore();
                if (dataStore instanceof WriteBehindStore) {
                    stores.set(mapName, dataStore);
                }
            }
        }
        return stores;
    }

    private _removeRecordStoresForPartition(partitionId: number): void {
        const suffix = `:${partitionId}`;
        const keysToRemove: string[] = [];
        for (const key of this._stores.keys()) {
            if (key.endsWith(suffix)) {
                keysToRemove.push(key);
            }
        }
        for (const key of keysToRemove) {
            const store = this._stores.get(key);
            if (store) {
                store.clear();
            }
            this._stores.delete(key);
        }

        const container = this._partitionContainers.get(partitionId);
        if (container) {
            container.cleanUpOnMigration();
            this._partitionContainers.delete(partitionId);
        }
    }

    private _stopWriteBehindWorkersForPartition(_partitionId: number): void {
        // WriteBehindStore is per-map (not per-partition) in the current architecture.
        // Worker lifecycle is managed at the map level via commitMigration cleanup.
    }

    /** Applies EAGER-loaded entries to owned partition RecordStores. */
    private _applyEagerEntries(mapName: string, initial: Map<unknown, unknown>): void {
        if (!this._nodeEngine) return;
        const ps = this._nodeEngine.getPartitionService();
        for (const [k, v] of initial) {
            const kd = this._nodeEngine.toData(k);
            const vd = this._nodeEngine.toData(v);
            if (kd !== null && vd !== null) {
                const partitionId = ps.getPartitionId(kd);
                const recordStore = this.getOrCreateRecordStore(mapName, partitionId);
                recordStore.put(kd, vd, -1, -1);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // Per-map statistics
    // ═══════════════════════════════════════════════════════════════

    /** Returns the LocalMapStatsImpl for a map, creating it lazily if absent. */
    getOrCreateMapStats(mapName: string): LocalMapStatsImpl {
        let stats = this._mapStats.get(mapName);
        if (stats === undefined) {
            stats = new LocalMapStatsImpl();
            this._mapStats.set(mapName, stats);
        }
        return stats;
    }

    /** Returns a snapshot of all per-map stats keyed by map name. */
    getAllMapStats(): Map<string, import('@zenystx/helios-core/internal/monitor/impl/LocalMapStatsImpl').LocalMapStats> {
        const result = new Map<string, import('@zenystx/helios-core/internal/monitor/impl/LocalMapStatsImpl').LocalMapStats>();
        for (const [name, stats] of this._mapStats) {
            result.set(name, stats.toSnapshot());
        }
        return result;
    }

    /**
     * Attach a StoreLatencyTracker. Propagates to all existing MapStoreContexts and
     * will be applied to contexts created in the future.
     */
    setStoreLatencyTracker(tracker: StoreLatencyTracker | null): void {
        this._storeLatencyTracker = tracker;
        for (const ctx of this._mapStoreContexts.values()) {
            ctx.setLatencyTracker(tracker);
        }
    }

    getMapNames(): string[] {
        const names = new Set<string>();
        for (const key of this._stores.keys()) {
            const colonIdx = key.lastIndexOf(':');
            if (colonIdx >= 0) {
                names.add(key.substring(0, colonIdx));
            }
        }
        return [...names];
    }
}
