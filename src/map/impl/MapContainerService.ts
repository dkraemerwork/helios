/**
 * Service registered under {@code MapService.SERVICE_NAME} in NodeEngine.
 *
 * Holds one {@link RecordStore} per (mapName, partitionId) pair.
 * In Phase 3 single-node operation, all records live in-process.
 * In Phase 4+ this will delegate to a cluster-aware partition table.
 *
 * Block 12.A3: Added getOrCreateMapDataStore + destroyMapStoreContext for
 * MapStore lifecycle management.
 *
 * Port of the partition-container lookup path in
 * {@code com.hazelcast.map.impl.MapServiceContextImpl}.
 */
import type { RecordStore } from '@helios/map/impl/recordstore/RecordStore';
import { DefaultRecordStore } from '@helios/map/impl/recordstore/DefaultRecordStore';
import type { MapDataStore } from '@helios/map/impl/mapstore/MapDataStore';
import { EmptyMapDataStore } from '@helios/map/impl/mapstore/EmptyMapDataStore';
import { MapStoreContext } from '@helios/map/impl/mapstore/MapStoreContext';
import type { MapStoreConfig } from '@helios/config/MapStoreConfig';
import type { NodeEngine } from '@helios/spi/NodeEngine';

export class MapContainerService {
    private readonly _stores = new Map<string, RecordStore>();

    /** Per-map MapStoreContext instances (created lazily via singleflight). */
    private readonly _mapStoreContexts = new Map<string, MapStoreContext<unknown, unknown>>();
    /** In-flight context init promises to prevent duplicate initialization. */
    private readonly _mapStoreContextInitPromises = new Map<string, Promise<MapStoreContext<unknown, unknown>>>();

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
    *getAllEntries(mapName: string): IterableIterator<readonly [import('@helios/internal/serialization/Data').Data, import('@helios/internal/serialization/Data').Data]> {
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
                    const recordStore = this.getOrCreateRecordStore(mapName, 0);
                    for (const [k, v] of initial) {
                        const kd = this._nodeEngine.toData(k);
                        const vd = this._nodeEngine.toData(v);
                        if (kd !== null && vd !== null) {
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
}
