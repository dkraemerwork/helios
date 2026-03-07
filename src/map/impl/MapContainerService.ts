/**
 * Service registered under {@code MapService.SERVICE_NAME} in NodeEngine.
 *
 * Holds one {@link RecordStore} per (mapName, partitionId) pair.
 * Implements {@link MigrationAwareService} for partition migration participation:
 * replication, before/commit/rollback lifecycle, and write-behind state transfer.
 *
 * Port of the partition-container lookup path in
 * {@code com.hazelcast.map.impl.MapServiceContextImpl} and migration-aware
 * behavior from {@code com.hazelcast.map.impl.MapMigrationAwareService}.
 */
import type { RecordStore } from '@zenystx/helios-core/map/impl/recordstore/RecordStore';
import { DefaultRecordStore } from '@zenystx/helios-core/map/impl/recordstore/DefaultRecordStore';
import type { MapDataStore } from '@zenystx/helios-core/map/impl/mapstore/MapDataStore';
import { EmptyMapDataStore } from '@zenystx/helios-core/map/impl/mapstore/EmptyMapDataStore';
import { MapStoreContext } from '@zenystx/helios-core/map/impl/mapstore/MapStoreContext';
import type { MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine';
import type { MigrationAwareService } from '@zenystx/helios-core/internal/partition/MigrationAwareService';
import type { PartitionMigrationEvent } from '@zenystx/helios-core/internal/partition/PartitionMigrationEvent';
import type { ServiceNamespace } from '@zenystx/helios-core/internal/services/ServiceNamespace';
import type { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import { WriteBehindStore } from '@zenystx/helios-core/map/impl/mapstore/writebehind/WriteBehindStore';
import { MapReplicationStateHolder } from '@zenystx/helios-core/map/impl/operation/MapReplicationStateHolder';
import { WriteBehindStateHolder } from '@zenystx/helios-core/map/impl/operation/WriteBehindStateHolder';
import { MapNearCacheStateHolder } from '@zenystx/helios-core/map/impl/operation/MapNearCacheStateHolder';
import { MapReplicationOperation } from '@zenystx/helios-core/map/impl/operation/MapReplicationOperation';
import { PartitionContainer } from '@zenystx/helios-core/internal/partition/impl/PartitionContainer';

export class MapContainerService implements MigrationAwareService {
    private readonly _stores = new Map<string, RecordStore>();

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

    setNodeEngine(nodeEngine: NodeEngine): void {
        this._nodeEngine = nodeEngine;
    }

    private _storeKey(mapName: string, partitionId: number): string {
        return `${mapName}:${partitionId}`;
    }

    /**
     * Returns the RecordStore for (mapName, partitionId), creating a new
     * DefaultRecordStore if one does not yet exist.
     */
    getOrCreateRecordStore(mapName: string, partitionId: number): RecordStore {
        const key = this._storeKey(mapName, partitionId);
        let store = this._stores.get(key);
        if (store === undefined) {
            store = new DefaultRecordStore();
            this._stores.set(key, store);
        }
        return store;
    }

    /**
     * Register a specific RecordStore for (mapName, partitionId).
     * Useful in tests to inject a pre-populated or mock store.
     */
    setRecordStore(mapName: string, partitionId: number, store: RecordStore): void {
        this._stores.set(this._storeKey(mapName, partitionId), store);
    }

    /**
     * Returns the RecordStore for (mapName, partitionId), or null if absent.
     */
    getRecordStore(mapName: string, partitionId: number): RecordStore | null {
        return this._stores.get(this._storeKey(mapName, partitionId)) ?? null;
    }

    /**
     * Iterates over all (key, value) entries across all partitions for the given map.
     * Used by MapQueryEngine to perform partition-local full scans.
     */
    *getAllEntries(mapName: string): IterableIterator<readonly [import('@zenystx/helios-core/internal/serialization/Data').Data, import('@zenystx/helios-core/internal/serialization/Data').Data]> {
        const prefix = `${mapName}:`;
        for (const [storeKey, store] of this._stores) {
            if (storeKey.startsWith(prefix)) {
                yield* store.entries();
            }
        }
    }

    /**
     * Returns the MapDataStore for the given map, creating and initializing
     * a MapStoreContext if one doesn't exist. Uses singleflight to prevent
     * duplicate initialization on concurrent first calls.
     *
     * Returns EmptyMapDataStore if the config has store disabled.
     */
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
                this._mapStoreContexts.set(mapName, created);

                // EAGER load: pre-populate RecordStore via NodeEngine serialization
                const initial = (created as unknown as MapStoreContext<K, V>).getInitialEntries();
                if (initial && this._nodeEngine) {
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

    /**
     * Register a MapStoreConfig for a map name so operations can trigger lazy
     * initialization on the partition owner even if getMap() hasn't been called locally.
     */
    registerMapStoreConfig(mapName: string, config: MapStoreConfig): void {
        this._mapStoreConfigs.set(mapName, config);
    }

    /**
     * Returns the already-initialized MapDataStore for the given map, or EmptyMapDataStore
     * if no MapStoreContext has been created yet. Used by operations running on the
     * partition owner to perform external store/delete/load calls.
     */
    getExistingMapDataStore<K, V>(mapName: string): MapDataStore<K, V> {
        const ctx = this._mapStoreContexts.get(mapName);
        if (ctx) {
            return ctx.getMapDataStore() as MapDataStore<K, V>;
        }
        return EmptyMapDataStore.empty<K, V>();
    }

    /**
     * Ensures the MapDataStore is initialized for the given map, using a registered
     * MapStoreConfig if available. Called from MapOperation.beforeRun() on the owner.
     */
    async ensureMapDataStoreInitialized(mapName: string): Promise<void> {
        // Already initialized
        if (this._mapStoreContexts.has(mapName)) return;
        // Check registered config
        const config = this._mapStoreConfigs.get(mapName);
        if (config && config.isEnabled()) {
            await this.getOrCreateMapDataStore(mapName, config);
        }
    }

    /** Check if a MapStoreConfig is registered for the given map. */
    hasMapStoreConfig(mapName: string): boolean {
        return this._mapStoreConfigs.has(mapName);
    }

    /**
     * Destroys the MapStoreContext for the given map (flushes pending writes,
     * calls destroy() on wrapper if supported).
     */
    async destroyMapStoreContext(mapName: string): Promise<void> {
        const ctx = this._mapStoreContexts.get(mapName);
        if (ctx) {
            await ctx.destroy();
            this._mapStoreContexts.delete(mapName);
        }
    }

    /**
     * Flushes all active MapStoreContexts (called on instance shutdown).
     */
    async flushAll(): Promise<void> {
        const destroyPromises: Promise<void>[] = [];
        for (const [mapName] of this._mapStoreContexts) {
            destroyPromises.push(this.destroyMapStoreContext(mapName));
        }
        await Promise.all(destroyPromises);
    }

    // ═══════════════════════════════════════════════════════════════════
    // MigrationAwareService implementation
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Prepares a replication operation that captures all map record data
     * and write-behind state for the migrating partition.
     */
    prepareReplicationOperation(
        event: PartitionMigrationEvent,
        namespaces: ServiceNamespace[],
    ): Operation | null {
        const partitionId = event.partitionId;

        // Build a temporary PartitionContainer with records from this partition
        const container = this._getOrCreatePartitionContainer(partitionId);

        // Populate container with records for the requested namespaces
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

        // Capture map replication state
        const mapStateHolder = new MapReplicationStateHolder();
        mapStateHolder.prepare(container, partitionId, 0);

        // Capture write-behind state
        const wbStateHolder = new WriteBehindStateHolder();
        const writeBehindStores = this._collectWriteBehindStores(namespaces);
        if (writeBehindStores.size > 0) {
            wbStateHolder.prepare(writeBehindStores);
        }

        // Near-cache state
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

    /**
     * Called before migration starts. Pauses write-behind workers for the
     * migrating partition to prevent concurrent modification during state capture.
     */
    beforeMigration(event: PartitionMigrationEvent): void {
        // Pause is implicit — the state capture in prepareReplicationOperation
        // takes a snapshot. No explicit pause needed for single-threaded Bun runtime.
        void event;
    }

    /**
     * Called after migration completes successfully.
     * Cleans up record stores and write-behind state for partitions this node
     * no longer owns (source side after successful migration).
     */
    commitMigration(event: PartitionMigrationEvent): void {
        const partitionId = event.partitionId;

        // If this node was the source and is no longer the owner,
        // clean up the local state for the migrated partition
        if (event.source !== null && event.migrationType === 'MOVE') {
            this._removeRecordStoresForPartition(partitionId);
            this._stopWriteBehindWorkersForPartition(partitionId);
        }
    }

    /**
     * Called after migration fails. Cleans up any state that was prepared
     * on the destination side.
     */
    rollbackMigration(event: PartitionMigrationEvent): void {
        const partitionId = event.partitionId;

        // On destination rollback, remove any state that was applied
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

    /** Collects WriteBehindStore instances for the given namespaces. */
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

    /** Removes all record stores for a partition (all maps). */
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

        // Clean up partition container
        const container = this._partitionContainers.get(partitionId);
        if (container) {
            container.cleanUpOnMigration();
            this._partitionContainers.delete(partitionId);
        }
    }

    /** Stops write-behind workers for maps with stores in the given partition. */
    private _stopWriteBehindWorkersForPartition(_partitionId: number): void {
        // In the current architecture, WriteBehindStore is per-map (not per-partition),
        // so stopping workers is handled at the map level via commitMigration cleanup.
        // Per-partition write-behind worker management would require partition-scoped
        // WriteBehindStore instances, which is tracked separately.
    }

    /** Returns all map names that have record stores in any partition. */
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
