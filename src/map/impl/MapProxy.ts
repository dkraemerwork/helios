/**
 * Full IMap implementation — Block 7.4.
 * Block 12.A3: methods made async + MapDataStore field + lazy wiring.
 * Block 16.C4: core ops route through OperationService.invokeOnPartition().
 *
 * Wraps NodeEngine, OperationService, and MapContainerService to provide a typed,
 * user-facing distributed-map proxy with:
 *   - Operation-routed core ops (put, get, remove, set, delete, putIfAbsent, clear)
 *   - Predicate-based queries (keySet/values/entrySet with Predicate)
 *   - Aggregation (aggregate / aggregate with Predicate)
 *   - Entry listeners (addEntryListener / removeEntryListener)
 *   - Locking (lock / tryLock / unlock / isLocked)
 *   - Async variants (putAsync / getAsync / removeAsync)
 *   - MapStore integration (write-through / write-behind / load-on-miss)
 *
 * Port of com.hazelcast.map.impl.proxy.MapProxyImpl.
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
import { MapService } from '@helios/map/impl/MapService';
import type { Operation } from '@helios/spi/impl/operationservice/Operation';
import { PutOperation } from '@helios/map/impl/operation/PutOperation';
import { GetOperation } from '@helios/map/impl/operation/GetOperation';
import { RemoveOperation } from '@helios/map/impl/operation/RemoveOperation';
import { DeleteOperation } from '@helios/map/impl/operation/DeleteOperation';
import { SetOperation } from '@helios/map/impl/operation/SetOperation';
import { PutIfAbsentOperation } from '@helios/map/impl/operation/PutIfAbsentOperation';
import { ClearOperation } from '@helios/map/impl/operation/ClearOperation';

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
        if (this._mapDataStore.isWithStore()) return;
        if (this._mapStoreConfig === null || !this._mapStoreConfig.isEnabled()) return;

        if (this._mapStoreInitPromise !== null) {
            await this._mapStoreInitPromise;
            return;
        }

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

    // ── Operation routing helpers ─────────────────────────────────────────

    private async _invokeOnKeyPartition<T>(op: Operation, key: Data): Promise<T> {
        const partitionId = this._nodeEngine.getPartitionService().getPartitionId(key);
        const future = this._nodeEngine.getOperationService()
            .invokeOnPartition<T>(MapService.SERVICE_NAME, op, partitionId);
        return future.get();
    }

    private async _invokeOnPartition<T>(op: Operation, partitionId: number): Promise<T> {
        const future = this._nodeEngine.getOperationService()
            .invokeOnPartition<T>(MapService.SERVICE_NAME, op, partitionId);
        return future.get();
    }

    // ── Core point ops ────────────────────────────────────────────────────

    async put(key: K, value: V): Promise<V | null> {
        await this._ensureMapDataStore();
        const kd = this._toData(key);
        const vd = this._toData(value);
        const oldData = await this._invokeOnKeyPartition<Data | null>(
            new PutOperation(this._name, kd, vd, -1, -1), kd,
        );
        const oldValue = oldData !== null && oldData !== undefined ? this._toObject<V>(oldData) : null;
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
        const hadOld = this.containsKey(key);
        await this._invokeOnKeyPartition<void>(
            new SetOperation(this._name, kd, vd, -1, -1), kd,
        );
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
        const data = await this._invokeOnKeyPartition<Data | null>(
            new GetOperation(this._name, kd), kd,
        );
        if (data !== null && data !== undefined) {
            return this._toObject<V>(data);
        }
        // load-on-miss
        if (this._mapDataStore.isWithStore()) {
            const loaded = await this._mapDataStore.load(key);
            if (loaded !== null) {
                const loadedData = this._toData(loaded);
                await this._invokeOnKeyPartition<Data | null>(
                    new PutOperation(this._name, kd, loadedData, -1, -1), kd,
                );
                return loaded;
            }
        }
        return null;
    }

    async remove(key: K): Promise<V | null> {
        await this._ensureMapDataStore();
        const kd = this._toData(key);
        const oldData = await this._invokeOnKeyPartition<Data | null>(
            new RemoveOperation(this._name, kd), kd,
        );
        if (this._mapDataStore.isWithStore()) {
            await this._mapDataStore.remove(key, Date.now());
        }
        if (oldData === null || oldData === undefined) return null;
        const oldValue = this._toObject<V>(oldData);
        this._fireRemoved(key, oldValue);
        return oldValue;
    }

    async delete(key: K): Promise<void> {
        await this._ensureMapDataStore();
        const kd = this._toData(key);
        const removed = await this._invokeOnKeyPartition<boolean>(
            new DeleteOperation(this._name, kd), kd,
        );
        if (this._mapDataStore.isWithStore()) {
            await this._mapDataStore.remove(key, Date.now());
        }
        if (removed) {
            this._fireRemoved(key, null);
        }
    }

    containsKey(key: K): boolean {
        const kd = this._toData(key);
        const partitionId = this._nodeEngine.getPartitionService().getPartitionId(kd);
        const store = this._containerService.getOrCreateRecordStore(this._name, partitionId);
        return store.containsKey(kd);
    }

    containsValue(value: V): boolean {
        const vd = this._toData(value);
        for (const [, entryValue] of this._containerService.getAllEntries(this._name)) {
            if (this._dataEquals(vd, entryValue)) return true;
        }
        return false;
    }

    size(): number {
        let total = 0;
        const partitionCount = this._nodeEngine.getPartitionService().getPartitionCount();
        for (let i = 0; i < partitionCount; i++) {
            const store = this._containerService.getRecordStore(this._name, i);
            if (store !== null) total += store.size();
        }
        return total;
    }

    isEmpty(): boolean {
        return this.size() === 0;
    }

    async clear(): Promise<void> {
        await this._ensureMapDataStore();
        const partitionCount = this._nodeEngine.getPartitionService().getPartitionCount();
        const promises: Promise<void>[] = [];
        for (let i = 0; i < partitionCount; i++) {
            promises.push(this._invokeOnPartition<void>(new ClearOperation(this._name), i));
        }
        await Promise.all(promises);
        if (this._mapDataStore.isWithStore()) {
            await this._mapDataStore.clear();
        }
        this._fireCleared();
    }

    async putIfAbsent(key: K, value: V): Promise<V | null> {
        await this._ensureMapDataStore();
        const kd = this._toData(key);
        const vd = this._toData(value);
        const existing = await this._invokeOnKeyPartition<Data | null>(
            new PutIfAbsentOperation(this._name, kd, vd, -1, -1), kd,
        );
        if (existing !== null && existing !== undefined) {
            return this._toObject<V>(existing);
        }
        if (this._mapDataStore.isWithStore()) {
            await this._mapDataStore.add(key, value, Date.now());
        }
        return null;
    }

    async putAll(entries: Iterable<[K, V]>): Promise<void> {
        await this._ensureMapDataStore();
        const pairs: [K, V][] = Array.from(entries);
        for (const [k, v] of pairs) {
            await this.put(k, v);
        }
    }

    async getAll(keys: K[]): Promise<Map<K, V | null>> {
        await this._ensureMapDataStore();
        const result = new Map<K, V | null>();
        const missing: K[] = [];
        for (const k of keys) {
            const val = await this.get(k);
            if (val !== null) {
                result.set(k, val);
            } else {
                missing.push(k);
            }
        }
        if (missing.length > 0 && this._mapDataStore.isWithStore()) {
            const loaded = await this._mapDataStore.loadAll(missing);
            for (const [k, v] of loaded) {
                result.set(k, v);
                const kd = this._toData(k);
                const vd = this._toData(v);
                await this._invokeOnKeyPartition<Data | null>(
                    new PutOperation(this._name, kd, vd, -1, -1), kd,
                );
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
        for (const [kd, vd] of this._containerService.getAllEntries(this._name)) {
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
        for (const [kd, vd] of this._containerService.getAllEntries(this._name)) {
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
        for (const [kd, vd] of this._containerService.getAllEntries(this._name)) {
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
        for (const [kd, vd] of this._containerService.getAllEntries(this._name)) {
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

    private _dataEquals(a: Data, b: Data): boolean {
        const aBuf = a.toByteArray();
        const bBuf = b.toByteArray();
        if (aBuf === null || bBuf === null) return aBuf === bBuf;
        if (aBuf.length !== bBuf.length) return false;
        for (let i = 0; i < aBuf.length; i++) {
            if (aBuf[i] !== bBuf[i]) return false;
        }
        return true;
    }

    private _lockKey(key: K): string {
        return JSON.stringify(key);
    }

    private _makeEntry(k: K, v: V): QueryableEntry<K, V> {
        return {
            getKey: () => k,
            getValue: () => v,
            getAttributeValue: (attr: string) => {
                if (attr === '__key') return k;
                if (attr === 'this') return v;
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
