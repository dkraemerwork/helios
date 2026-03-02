/**
 * Full IMap implementation — Block 7.4.
 * Block 12.A3: methods made async + MapDataStore field + lazy wiring.
 *
 * Wraps a RecordStore and NodeEngine to provide a typed, user-facing
 * distributed-map proxy with:
 *   - Predicate-based queries (keySet/values/entrySet with Predicate)
 *   - Aggregation (aggregate / aggregate with Predicate)
 *   - Entry listeners (addEntryListener / removeEntryListener)
 *   - Locking (lock / tryLock / unlock / isLocked)
 *   - Async variants (putAsync / getAsync / removeAsync)
 *   - Extended ops (set / delete / containsValue / replace / replaceIfSame)
 *   - MapStore integration (write-through / write-behind / load-on-miss)
 *
 * Port of com.hazelcast.map.impl.proxy.MapProxyImpl (single-node subset).
 */
import type { IMap } from '@helios/map/IMap';
import type { RecordStore } from '@helios/map/impl/recordstore/RecordStore';
import type { NodeEngine } from '@helios/spi/NodeEngine';
import type { MapContainerService } from '@helios/map/impl/MapContainerService';
import type { Data } from '@helios/internal/serialization/Data';
import type { Predicate } from '@helios/query/Predicate';
import type { Aggregator } from '@helios/aggregation/Aggregator';
import type { EntryListener } from '@helios/map/EntryListener';
import { EntryEventImpl } from '@helios/map/EntryListener';
import type { QueryableEntry } from '@helios/query/impl/QueryableEntry';
import type { MapDataStore } from '@helios/map/impl/mapstore/MapDataStore';
import { EmptyMapDataStore } from '@helios/map/impl/mapstore/EmptyMapDataStore';
import type { MapStoreConfig } from '@helios/config/MapStoreConfig';

/** Registration record stored per listenerId. */
interface ListenerEntry<K, V> {
    listener: EntryListener<K, V>;
    includeValue: boolean;
}

export class MapProxy<K, V> implements IMap<K, V> {
    private readonly _name: string;
    private readonly _store: RecordStore;
    private readonly _nodeEngine: NodeEngine;
    private readonly _containerService: MapContainerService;

    /** Active entry-listener registrations, keyed by registration ID. */
    private readonly _listeners = new Map<string, ListenerEntry<K, V>>();
    private _listenerCounter = 0;

    /** Set of serialized key strings that are currently locked. */
    private readonly _locks = new Set<string>();

    /** MapDataStore: wired lazily on first store-touching call. */
    private _mapDataStore: MapDataStore<K, V> = EmptyMapDataStore.empty<K, V>();

    /** MapStoreConfig for lazy wiring (null = no store configured). */
    private _mapStoreConfig: MapStoreConfig | null = null;

    /** Singleflight promise for MapDataStore initialization. */
    private _mapStoreInitPromise: Promise<void> | null = null;

    constructor(
        name: string,
        store: RecordStore,
        nodeEngine: NodeEngine,
        containerService: MapContainerService,
        mapStoreConfig?: MapStoreConfig,
    ) {
        this._name = name;
        this._store = store;
        this._nodeEngine = nodeEngine;
        this._containerService = containerService;
        this._mapStoreConfig = mapStoreConfig ?? null;
    }

    /** Lazily initialize MapDataStore on first store-touching call (singleflight). */
    private async _ensureMapDataStore(): Promise<void> {
        if (this._mapDataStore.isWithStore()) return; // already wired
        if (this._mapStoreConfig === null || !this._mapStoreConfig.isEnabled()) return; // no store

        if (this._mapStoreInitPromise !== null) {
            await this._mapStoreInitPromise;
            return;
        }

        // Create singleflight promise
        this._mapStoreInitPromise = (async () => {
            const store = await this._containerService.getOrCreateMapDataStore<K, V>(
                this._name,
                this._mapStoreConfig!,
            );
            this._mapDataStore = store;
        })();

        try {
            await this._mapStoreInitPromise;
        } finally {
            this._mapStoreInitPromise = null;
        }
    }

    // ── Identification ────────────────────────────────────────────────────

    getName(): string {
        return this._name;
    }

    // ── Core point ops ────────────────────────────────────────────────────

    async put(key: K, value: V): Promise<V | null> {
        await this._ensureMapDataStore();
        const kd = this._toData(key);
        const vd = this._toData(value);
        const oldData = this._store.put(kd, vd, -1, -1);
        const oldValue = oldData !== null ? this._toObject<V>(oldData) : null;
        if (this._mapDataStore.isWithStore()) {
            await this._mapDataStore.add(key, value, Date.now());
        }
        if (oldValue === null) {
            this._fireAdded(key, value);
        } else {
            this._fireUpdated(key, value, oldValue);
        }
        return oldValue;
    }

    async set(key: K, value: V): Promise<void> {
        await this._ensureMapDataStore();
        const kd = this._toData(key);
        const vd = this._toData(value);
        const hadOld = this._store.containsKey(kd);
        this._store.set(kd, vd, -1, -1);
        if (this._mapDataStore.isWithStore()) {
            await this._mapDataStore.add(key, value, Date.now());
        }
        if (!hadOld) {
            this._fireAdded(key, value);
        } else {
            this._fireUpdated(key, value, null);
        }
    }

    async get(key: K): Promise<V | null> {
        await this._ensureMapDataStore();
        const kd = this._toData(key);
        const data = this._store.get(kd);
        if (data !== null) {
            return this._toObject<V>(data);
        }
        // load-on-miss
        if (this._mapDataStore.isWithStore()) {
            const loaded = await this._mapDataStore.load(key);
            if (loaded !== null) {
                // back-fill cache — use store.put with no TTL
                this._store.put(kd, this._toData(loaded), -1, -1);
                return loaded;
            }
        }
        return null;
    }

    async remove(key: K): Promise<V | null> {
        await this._ensureMapDataStore();
        const kd = this._toData(key);
        const oldData = this._store.remove(kd);
        if (this._mapDataStore.isWithStore()) {
            await this._mapDataStore.remove(key, Date.now());
        }
        if (oldData === null) return null;
        const oldValue = this._toObject<V>(oldData);
        this._fireRemoved(key, oldValue);
        return oldValue;
    }

    async delete(key: K): Promise<void> {
        await this._ensureMapDataStore();
        const kd = this._toData(key);
        const removed = this._store.delete(kd);
        if (this._mapDataStore.isWithStore()) {
            await this._mapDataStore.remove(key, Date.now());
        }
        if (removed) {
            this._fireRemoved(key, null);
        }
    }

    containsKey(key: K): boolean {
        return this._store.containsKey(this._toData(key));
    }

    containsValue(value: V): boolean {
        return this._store.containsValue(this._toData(value));
    }

    size(): number {
        return this._store.size();
    }

    isEmpty(): boolean {
        return this._store.isEmpty();
    }

    async clear(): Promise<void> {
        await this._ensureMapDataStore();
        this._store.clear();
        if (this._mapDataStore.isWithStore()) {
            await this._mapDataStore.clear();
        }
        this._fireCleared();
    }

    async putIfAbsent(key: K, value: V): Promise<V | null> {
        await this._ensureMapDataStore();
        const kd = this._toData(key);
        const vd = this._toData(value);
        const existing = this._store.putIfAbsent(kd, vd, -1, -1);
        if (existing !== null) {
            return this._toObject<V>(existing);
        }
        // key was absent — added, sync to store
        if (this._mapDataStore.isWithStore()) {
            await this._mapDataStore.add(key, value, Date.now());
        }
        return null;
    }

    async putAll(entries: Iterable<[K, V]>): Promise<void> {
        await this._ensureMapDataStore();
        const pairs: [K, V][] = Array.from(entries);
        for (const [k, v] of pairs) {
            this._store.put(this._toData(k), this._toData(v), -1, -1);
        }
        if (this._mapDataStore.isWithStore()) {
            for (const [k, v] of pairs) {
                await this._mapDataStore.add(k, v, Date.now());
            }
        }
    }

    async getAll(keys: K[]): Promise<Map<K, V | null>> {
        await this._ensureMapDataStore();
        const result = new Map<K, V | null>();
        const missing: K[] = [];
        for (const k of keys) {
            const kd = this._toData(k);
            const data = this._store.get(kd);
            if (data !== null) {
                result.set(k, this._toObject<V>(data));
            } else {
                missing.push(k);
            }
        }
        if (missing.length > 0 && this._mapDataStore.isWithStore()) {
            const loaded = await this._mapDataStore.loadAll(missing);
            for (const [k, v] of loaded) {
                result.set(k, v);
                this._store.put(this._toData(k), this._toData(v), -1, -1);
            }
            for (const k of missing) {
                if (!result.has(k)) result.set(k, null);
            }
        } else {
            for (const k of missing) result.set(k, null);
        }
        return result;
    }

    async replace(key: K, value: V): Promise<V | null> {
        if (!this.containsKey(key)) return null;
        return this.put(key, value);
    }

    async replaceIfSame(key: K, oldValue: V, newValue: V): Promise<boolean> {
        const current = await this.get(key);
        if (current === null) return false;
        if (!this._equals(current, oldValue)) return false;
        await this.put(key, newValue);
        return true;
    }

    // ── Predicate-based query methods ─────────────────────────────────────

    values(): V[];
    values(predicate: Predicate<K, V>): V[];
    values(predicate?: Predicate<K, V>): V[] {
        const result: V[] = [];
        for (const [kd, vd] of this._store.entries()) {
            const k = this._toObject<K>(kd);
            const v = this._toObject<V>(vd);
            if (k === null || v === null) continue;
            if (predicate === undefined || predicate.apply(this._makeEntry(k, v))) {
                result.push(v);
            }
        }
        return result;
    }

    keySet(): Set<K>;
    keySet(predicate: Predicate<K, V>): Set<K>;
    keySet(predicate?: Predicate<K, V>): Set<K> {
        const result = new Set<K>();
        for (const [kd, vd] of this._store.entries()) {
            const k = this._toObject<K>(kd);
            const v = this._toObject<V>(vd);
            if (k === null || v === null) continue;
            if (predicate === undefined || predicate.apply(this._makeEntry(k, v))) {
                result.add(k);
            }
        }
        return result;
    }

    entrySet(): Map<K, V>;
    entrySet(predicate: Predicate<K, V>): Map<K, V>;
    entrySet(predicate?: Predicate<K, V>): Map<K, V> {
        const result = new Map<K, V>();
        for (const [kd, vd] of this._store.entries()) {
            const k = this._toObject<K>(kd);
            const v = this._toObject<V>(vd);
            if (k === null || v === null) continue;
            if (predicate === undefined || predicate.apply(this._makeEntry(k, v))) {
                result.set(k, v);
            }
        }
        return result;
    }

    // ── Aggregation ───────────────────────────────────────────────────────

    aggregate<R>(aggregator: Aggregator<[K, V], R>): R;
    aggregate<R>(aggregator: Aggregator<[K, V], R>, predicate: Predicate<K, V>): R;
    aggregate<R>(aggregator: Aggregator<[K, V], R>, predicate?: Predicate<K, V>): R {
        for (const [kd, vd] of this._store.entries()) {
            const k = this._toObject<K>(kd);
            const v = this._toObject<V>(vd);
            if (k === null || v === null) continue;
            if (predicate === undefined || predicate.apply(this._makeEntry(k, v))) {
                aggregator.accumulate([k, v]);
            }
        }
        aggregator.onAccumulationFinished();
        aggregator.onCombinationFinished();
        return aggregator.aggregate();
    }

    // ── Entry listeners ───────────────────────────────────────────────────

    addEntryListener(listener: EntryListener<K, V>, includeValue = true): string {
        const id = `listener-${++this._listenerCounter}`;
        this._listeners.set(id, { listener, includeValue });
        return id;
    }

    removeEntryListener(listenerId: string): boolean {
        return this._listeners.delete(listenerId);
    }

    // ── Locking ───────────────────────────────────────────────────────────

    lock(key: K): void {
        this._locks.add(this._lockKey(key));
    }

    tryLock(key: K): boolean {
        const lk = this._lockKey(key);
        if (this._locks.has(lk)) return false;
        this._locks.add(lk);
        return true;
    }

    unlock(key: K): void {
        this._locks.delete(this._lockKey(key));
    }

    isLocked(key: K): boolean {
        return this._locks.has(this._lockKey(key));
    }

    // ── Async variants ────────────────────────────────────────────────────

    async putAsync(key: K, value: V): Promise<V | null> {
        return this.put(key, value);
    }

    async getAsync(key: K): Promise<V | null> {
        return this.get(key);
    }

    async removeAsync(key: K): Promise<V | null> {
        return this.remove(key);
    }

    // ── MapDataStore access ───────────────────────────────────────────────

    /** Inject a MapDataStore directly (used by tests and MapContainerService). */
    setMapDataStore(store: MapDataStore<K, V>): void {
        this._mapDataStore = store;
    }

    // ── Private helpers ───────────────────────────────────────────────────

    private _toData(obj: unknown): Data {
        const data = this._nodeEngine.toData(obj);
        if (data === null) throw new Error('Cannot serialize null key/value');
        return data;
    }

    private _toObject<T>(data: Data): T | null {
        return this._nodeEngine.toObject<T>(data);
    }

    private _lockKey(key: K): string {
        // Stable string representation for lock tracking
        return JSON.stringify(key);
    }

    private _makeEntry(k: K, v: V): QueryableEntry<K, V> {
        return {
            getKey: () => k,
            getValue: () => v,
            getAttributeValue: (attr: string) => {
                if (attr === '__key') return k;
                if (attr === 'this') return v;
                // Resolve nested properties on the value object (e.g. "age", "address.city")
                if (v !== null && v !== undefined && typeof v === 'object') {
                    const parts = attr.split('.');
                    let current: unknown = v;
                    for (const part of parts) {
                        if (current === null || current === undefined || typeof current !== 'object') {
                            return null;
                        }
                        current = (current as Record<string, unknown>)[part];
                    }
                    return current ?? null;
                }
                return null;
            },
        };
    }

    private _equals(a: unknown, b: unknown): boolean {
        if (a === b) return true;
        // Deep equality for plain objects/arrays via JSON (sufficient for primitive-value maps)
        try {
            return JSON.stringify(a) === JSON.stringify(b);
        } catch {
            return false;
        }
    }

    // ── Listener firing ───────────────────────────────────────────────────

    private _fireAdded(key: K, value: V): void {
        for (const { listener, includeValue } of this._listeners.values()) {
            if (listener.entryAdded) {
                listener.entryAdded(
                    new EntryEventImpl(this._name, key, includeValue ? value : null, null, 'ADDED'),
                );
            }
        }
    }

    private _fireUpdated(key: K, value: V, oldValue: V | null): void {
        for (const { listener, includeValue } of this._listeners.values()) {
            if (listener.entryUpdated) {
                listener.entryUpdated(
                    new EntryEventImpl(this._name, key, includeValue ? value : null, oldValue, 'UPDATED'),
                );
            }
        }
    }

    private _fireRemoved(key: K, oldValue: V | null): void {
        for (const { listener, includeValue } of this._listeners.values()) {
            if (listener.entryRemoved) {
                listener.entryRemoved(
                    new EntryEventImpl(this._name, key, null, includeValue ? oldValue : null, 'REMOVED'),
                );
            }
        }
    }

    private _fireCleared(): void {
        for (const { listener } of this._listeners.values()) {
            if (listener.mapCleared) {
                listener.mapCleared();
            }
        }
    }
}
