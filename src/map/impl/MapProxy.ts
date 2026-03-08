/**
 * Full IMap implementation — Block 7.4.
 * Block 7.4a: production indexing (IndexRegistry, addIndex, indexed queries, index maintenance).
 * Block 12.A3: methods made async + MapDataStore field + lazy wiring.
 * Block 16.C4: core ops route through OperationService.invokeOnPartition().
 *
 * Wraps NodeEngine, OperationService, and MapContainerService to provide a typed,
 * user-facing distributed-map proxy with:
 *   - Operation-routed core ops (put, get, remove, set, delete, putIfAbsent, clear)
 *   - Predicate-based queries (keySet/values/entrySet with Predicate)
 *   - Indexed query execution when compatible index exists
 *   - Aggregation (aggregate / aggregate with Predicate)
 *   - Entry listeners (addEntryListener / removeEntryListener)
 *   - Locking (lock / tryLock / unlock / isLocked)
 *   - Async variants (putAsync / getAsync / removeAsync)
 *   - MapStore integration (write-through / write-behind / load-on-miss)
 *
 * Port of com.hazelcast.map.impl.proxy.MapProxyImpl.
 */
import type { Aggregator } from '@zenystx/helios-core/aggregation/Aggregator';
import type { IndexConfig } from '@zenystx/helios-core/config/IndexConfig';
import type { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import type { MapStoreConfig } from '@zenystx/helios-core/config/MapStoreConfig';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { EntryListener } from '@zenystx/helios-core/map/EntryListener';
import { EntryEventImpl } from '@zenystx/helios-core/map/EntryListener';
import type { IMap } from '@zenystx/helios-core/map/IMap';
import type { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService';
import { MapService } from '@zenystx/helios-core/map/impl/MapService';
import { EmptyMapDataStore } from '@zenystx/helios-core/map/impl/mapstore/EmptyMapDataStore';
import type { MapDataStore } from '@zenystx/helios-core/map/impl/mapstore/MapDataStore';
import { ClearOperation } from '@zenystx/helios-core/map/impl/operation/ClearOperation';
import { DeleteOperation } from '@zenystx/helios-core/map/impl/operation/DeleteOperation';
import { ExternalStoreClearOperation } from '@zenystx/helios-core/map/impl/operation/ExternalStoreClearOperation';
import { GetOperation } from '@zenystx/helios-core/map/impl/operation/GetOperation';
import { PutIfAbsentOperation } from '@zenystx/helios-core/map/impl/operation/PutIfAbsentOperation';
import { PutOperation } from '@zenystx/helios-core/map/impl/operation/PutOperation';
import { RemoveOperation } from '@zenystx/helios-core/map/impl/operation/RemoveOperation';
import { SetOperation } from '@zenystx/helios-core/map/impl/operation/SetOperation';
import type { RecordStore } from '@zenystx/helios-core/map/impl/recordstore/RecordStore';
import { IndexRegistryImpl } from '@zenystx/helios-core/query/impl/IndexRegistryImpl';
import { canonicalizeAttribute } from '@zenystx/helios-core/query/impl/IndexUtils';
import type { QueryableEntry } from '@zenystx/helios-core/query/impl/QueryableEntry';
import { IndexMatchHint } from '@zenystx/helios-core/query/impl/QueryContext';
import type { SortedIndex } from '@zenystx/helios-core/query/impl/SortedIndex';
import type { Predicate } from '@zenystx/helios-core/query/Predicate';
import type { Operation } from '@zenystx/helios-core/spi/impl/operationservice/Operation';
import type { NodeEngine } from '@zenystx/helios-core/spi/NodeEngine';

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

    /** Map-scoped partition-lost listeners keyed by registration ID. */
    private readonly _partitionLostListeners = new Map<string, (event: import('@zenystx/helios-core/internal/partition/impl/InternalPartitionServiceImpl').MapPartitionLostEvent) => void>();

    /** MapDataStore: wired lazily on first store-touching call. */
    private _mapDataStore: MapDataStore<K, V> = EmptyMapDataStore.empty<K, V>();

    /** MapStoreConfig for lazy wiring (null = no store configured). */
    private _mapStoreConfig: MapStoreConfig | null = null;

    /** Singleflight promise for MapDataStore initialization. */
    private _mapStoreInitPromise: Promise<void> | null = null;

    /** Index registry for this map — supports indexed query execution. */
    private readonly _indexRegistry = new IndexRegistryImpl();

    constructor(
        name: string,
        store: RecordStore,
        nodeEngine: NodeEngine,
        containerService: MapContainerService,
        mapStoreConfig?: MapStoreConfig,
        mapConfig?: MapConfig,
    ) {
        this._name = name;
        this._store = store;
        this._nodeEngine = nodeEngine;
        this._containerService = containerService;
        this._mapStoreConfig = mapStoreConfig ?? null;

        // Register MapStoreConfig in container service so operations on remote
        // owners can trigger lazy MapDataStore init (Block 21.2)
        if (this._mapStoreConfig !== null && this._mapStoreConfig.isEnabled()) {
            this._containerService.registerMapStoreConfig(name, this._mapStoreConfig);
        }

        // Bootstrap indexes from config
        if (mapConfig !== undefined) {
            for (const idxCfg of mapConfig.getIndexConfigs()) {
                this._indexRegistry.addIndex(idxCfg);
            }
        }
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

    // ── Indexing ──────────────────────────────────────────────────────────

    addIndex(indexConfig: IndexConfig): void {
        this._indexRegistry.addIndex(indexConfig);
        // Rebuild index from existing entries
        for (const [kd, vd] of this._containerService.getAllEntries(this._name)) {
            const k = this._toObject<K>(kd);
            const v = this._toObject<V>(vd);
            if (k === null || v === null) continue;
            const entryKey = this._indexKey(k);
            const entry = this._makeEntry(k, v);
            for (const attr of indexConfig.getAttributes()) {
                const canonical = canonicalizeAttribute(attr);
                const value = entry.getAttributeValue(canonical);
                const index = this._indexRegistry.getIndex(canonical, indexConfig.getType());
                if (index !== null) {
                    index.insert(value, entryKey);
                }
            }
        }
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
        const t0 = Date.now();
        const oldData = await this._invokeOnKeyPartition<Data | null>(
            new PutOperation(this._name, kd, vd, -1, -1), kd,
        );
        this._containerService.getOrCreateMapStats(this._name).incrementPutCount(Date.now() - t0);
        const oldValue = oldData !== null && oldData !== undefined ? this._toObject<V>(oldData) : null;
        // MapStore write now happens inside PutOperation on the partition owner
        // Index maintenance
        this._updateIndex(key, value, oldValue);
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
        const partitionId = this._partitionIdForKeyData(kd);
        // Read old value for index removal before overwrite
        const oldValue = await this._readCurrentValueByData(kd, partitionId);
        await this._invokeOnPartition<void>(new SetOperation(this._name, kd, vd, -1, -1), partitionId);
        // MapStore write now happens inside SetOperation on the partition owner
        this._containerService.getOrCreateMapStats(this._name).incrementSetCount();
        this._updateIndex(key, value, oldValue);
        if (oldValue === null) {
            this._fireAdded(key, value);
        } else {
            this._fireUpdated(key, value, null);
        }
    }

    async get(key: K): Promise<V | null> {
        await this._ensureMapDataStore();
        const kd = this._toData(key);
        const t0 = Date.now();
        // GetOperation now handles load-on-miss on the partition owner
        const data = await this._invokeOnKeyPartition<Data | null>(
            new GetOperation(this._name, kd), kd,
        );
        this._containerService.getOrCreateMapStats(this._name).incrementGetCount(Date.now() - t0);
        if (data !== null && data !== undefined) {
            return this._toObject<V>(data);
        }
        return null;
    }

    async remove(key: K): Promise<V | null> {
        await this._ensureMapDataStore();
        const kd = this._toData(key);
        const t0 = Date.now();
        const oldData = await this._invokeOnKeyPartition<Data | null>(
            new RemoveOperation(this._name, kd), kd,
        );
        this._containerService.getOrCreateMapStats(this._name).incrementRemoveCount(Date.now() - t0);
        // MapStore delete now happens inside RemoveOperation on the partition owner
        if (oldData === null || oldData === undefined) return null;
        const oldValue = this._toObject<V>(oldData);
        // Index maintenance
        if (oldValue !== null) {
            this._removeFromIndex(key, oldValue);
        }
        this._fireRemoved(key, oldValue);
        return oldValue;
    }

    async delete(key: K): Promise<void> {
        await this._ensureMapDataStore();
        const kd = this._toData(key);
        const partitionId = this._partitionIdForKeyData(kd);
        // Read old value for index removal before delete
        const oldValue = await this._readCurrentValueByData(kd, partitionId);
        const removed = await this._invokeOnPartition<boolean>(new DeleteOperation(this._name, kd), partitionId);
        // MapStore delete now happens inside DeleteOperation on the partition owner
        if (removed && oldValue !== null) {
            this._removeFromIndex(key, oldValue);
        }
        if (removed) {
            this._fireRemoved(key, null);
        }
    }

    containsKey(key: K): boolean {
        const kd = this._toData(key);
        const partitionId = this._partitionIdForKeyData(kd);
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
        const localAddress = this._nodeEngine.getLocalAddress();
        for (let i = 0; i < partitionCount; i++) {
            const owner = this._nodeEngine.getPartitionService().getPartitionOwner(i);
            if (owner !== null && !owner.equals(localAddress)) {
                continue;
            }
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
        // External store clear: flush remaining external entries via MapDataStore.clear()
        // This handles entries that exist in the external store but not in RecordStores
        // (e.g., pre-seeded data). ClearOperation handles per-partition record cleanup above.
        if (this._mapDataStore.isWithStore()) {
            const coordinationPartitionId = this._containerService.getMapCoordinationPartitionId(this._name);
            await this._invokeOnPartition<void>(new ExternalStoreClearOperation(this._name), coordinationPartitionId);
        }
        // Clear all index entries
        this._indexRegistry.clearIndexes();
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
        // MapStore write now happens inside PutIfAbsentOperation on the partition owner
        // Index the new entry (only reached when key was absent)
        this._addToIndex(key, value);
        return null;
    }

    async putAll(entries: Iterable<[K, V]>): Promise<void> {
        await this._ensureMapDataStore();
        const pairs: [K, V][] = Array.from(entries);
        // Each PutOperation handles MapStore write on the partition owner
        for (const [k, v] of pairs) {
            const kd = this._toData(k);
            const vd = this._toData(v);
            await this._invokeOnKeyPartition<Data | null>(
                new PutOperation(this._name, kd, vd, -1, -1), kd,
            );
            this._addToIndex(k, v);
        }
    }

    async getAll(keys: K[]): Promise<Map<K, V | null>> {
        await this._ensureMapDataStore();
        const result = new Map<K, V | null>();
        // Each get() now handles load-on-miss inside GetOperation on the partition owner
        for (const k of keys) {
            const val = await this.get(k);
            result.set(k, val);
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
        if (predicate !== undefined) {
            const indexedKeys = this._tryIndexScan(predicate);
            if (indexedKeys !== null) {
                return this._collectValuesByKeys(indexedKeys, predicate);
            }
        }
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
        if (predicate !== undefined) {
            const indexedKeys = this._tryIndexScan(predicate);
            if (indexedKeys !== null) {
                return this._collectKeysByKeys(indexedKeys, predicate);
            }
        }
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
        if (predicate !== undefined) {
            const indexedKeys = this._tryIndexScan(predicate);
            if (indexedKeys !== null) {
                return this._collectEntriesByKeys(indexedKeys, predicate);
            }
        }
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

    // ── Partition-lost listeners ──────────────────────────────────────────

    addPartitionLostListener(
        listener: (event: import('@zenystx/helios-core/internal/partition/impl/InternalPartitionServiceImpl').MapPartitionLostEvent) => void,
    ): string {
        const partitionService = this._nodeEngine.getPartitionService() as {
            onMapPartitionLost?: (mapName: string, listener: (event: import('@zenystx/helios-core/internal/partition/impl/InternalPartitionServiceImpl').MapPartitionLostEvent) => void) => string;
        };

        if (typeof partitionService.onMapPartitionLost === 'function') {
            const id = partitionService.onMapPartitionLost(this._name, listener);
            this._partitionLostListeners.set(id, listener);
            return id;
        }

        const id = crypto.randomUUID();
        this._partitionLostListeners.set(id, listener);
        return id;
    }

    removePartitionLostListener(listenerId: string): boolean {
        const partitionService = this._nodeEngine.getPartitionService() as {
            removeMapPartitionLostListener?: (listenerId: string) => boolean;
        };
        const removedLocal = this._partitionLostListeners.delete(listenerId);
        if (typeof partitionService.removeMapPartitionLostListener === 'function') {
            return partitionService.removeMapPartitionLostListener(listenerId) || removedLocal;
        }
        return removedLocal;
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

    // ── Index maintenance ────────────────────────────────────────────────

    private _indexKey(key: K): string {
        return JSON.stringify(key);
    }

    private _addToIndex(key: K, value: V): void {
        if (this._indexRegistry.getIndexes().length === 0) return;
        const entryKey = this._indexKey(key);
        const entry = this._makeEntry(key, value);
        this._indexRegistry.insertEntry(entryKey, (attr) => entry.getAttributeValue(attr));
    }

    private _removeFromIndex(key: K, value: V): void {
        if (this._indexRegistry.getIndexes().length === 0) return;
        const entryKey = this._indexKey(key);
        const entry = this._makeEntry(key, value);
        this._indexRegistry.removeEntry(entryKey, (attr) => entry.getAttributeValue(attr));
    }

    private _updateIndex(key: K, newValue: V, oldValue: V | null): void {
        if (this._indexRegistry.getIndexes().length === 0) return;
        if (oldValue !== null) {
            this._removeFromIndex(key, oldValue);
        }
        this._addToIndex(key, newValue);
    }

    /** Read the current value for a key without going through get() (no load-on-miss). */
    private async _readCurrentValue(key: K): Promise<V | null> {
        const kd = this._toData(key);
        const partitionId = this._partitionIdForKeyData(kd);
        return this._readCurrentValueByData(kd, partitionId);
    }

    private async _readCurrentValueByData(keyData: Data, partitionId: number): Promise<V | null> {
        const store = this._containerService.getOrCreateRecordStore(this._name, partitionId);
        const data = store.get(keyData);
        if (data === null) return null;
        return this._toObject<V>(data);
    }

    private _partitionIdForKeyData(keyData: Data): number {
        return this._nodeEngine.getPartitionService().getPartitionId(keyData);
    }

    // ── Indexed query helpers ────────────────────────────────────────────

    /**
     * Attempt to use an index to narrow the candidate set for the predicate.
     * Returns a set of candidate entry keys (JSON-serialized K), or null if no index applies.
     */
    private _tryIndexScan(predicate: Predicate<K, V>): ReadonlySet<string> | null {
        // Check for index-aware predicates by duck-typing their known properties
        const p = predicate as unknown as Record<string, unknown>;

        if (typeof p['attributeName'] !== 'string') return null;
        const attr = canonicalizeAttribute(p['attributeName'] as string);

        // EqualPredicate
        if ('value' in p && !('from' in p) && !('less' in p) && !('_values' in p) && !('expression' in p)) {
            const index = this._indexRegistry.matchIndex(attr, IndexMatchHint.PREFER_UNORDERED);
            if (index === null) return null;
            const keys = index.getEqual(p['value']);
            return keys instanceof Set ? keys : new Set(keys as string[]);
        }

        // InPredicate
        if ('_values' in p && Array.isArray(p['_values'])) {
            const index = this._indexRegistry.matchIndex(attr, IndexMatchHint.PREFER_UNORDERED);
            if (index === null) return null;
            const result = new Set<string>();
            for (const v of p['_values'] as unknown[]) {
                const keys = index.getEqual(v);
                if (keys instanceof Set) {
                    for (const k of keys) result.add(k);
                } else {
                    for (const k of keys as string[]) result.add(k);
                }
            }
            return result;
        }

        // BetweenPredicate
        if ('from' in p && 'to' in p) {
            const index = this._indexRegistry.matchIndex(attr, IndexMatchHint.PREFER_ORDERED);
            if (index === null || !('getBetween' in index)) return null;
            const sorted = index as SortedIndex;
            const keys = sorted.getBetween(p['from'], p['to']);
            return new Set(keys);
        }

        // GreaterLessPredicate
        if ('less' in p && 'equal' in p && 'value' in p) {
            const index = this._indexRegistry.matchIndex(attr, IndexMatchHint.PREFER_ORDERED);
            if (index === null || !('getGreaterThan' in index)) return null;
            const sorted = index as SortedIndex;
            const less = p['less'] as boolean;
            const equal = p['equal'] as boolean;
            const keys = less
                ? sorted.getLessThan(p['value'], equal)
                : sorted.getGreaterThan(p['value'], equal);
            return new Set(keys);
        }

        // LikePredicate (prefix only)
        if ('expression' in p && typeof p['expression'] === 'string') {
            const expr = p['expression'] as string;
            if (!expr.endsWith('%')) return null;
            const prefix = expr.slice(0, -1);
            // Only use index for simple prefix patterns (no wildcards in prefix)
            if (prefix.includes('%') || prefix.includes('_')) return null;
            const index = this._indexRegistry.matchIndex(attr, IndexMatchHint.PREFER_ORDERED);
            if (index === null || !('getByPrefix' in index)) return null;
            const sorted = index as SortedIndex;
            const keys = sorted.getByPrefix(prefix);
            return new Set(keys);
        }

        return null;
    }

    /** Collect values from candidate keys, applying predicate as final filter. */
    private _collectValuesByKeys(candidateKeys: ReadonlySet<string>, predicate: Predicate<K, V>): V[] {
        const result: V[] = [];
        for (const [kd, vd] of this._containerService.getAllEntries(this._name)) {
            const k = this._toObject<K>(kd);
            const v = this._toObject<V>(vd);
            if (k === null || v === null) continue;
            if (!candidateKeys.has(this._indexKey(k))) continue;
            if (predicate.apply(this._makeEntry(k, v))) {
                result.push(v);
            }
        }
        return result;
    }

    private _collectKeysByKeys(candidateKeys: ReadonlySet<string>, predicate: Predicate<K, V>): Set<K> {
        const result = new Set<K>();
        for (const [kd, vd] of this._containerService.getAllEntries(this._name)) {
            const k = this._toObject<K>(kd);
            const v = this._toObject<V>(vd);
            if (k === null || v === null) continue;
            if (!candidateKeys.has(this._indexKey(k))) continue;
            if (predicate.apply(this._makeEntry(k, v))) {
                result.add(k);
            }
        }
        return result;
    }

    private _collectEntriesByKeys(candidateKeys: ReadonlySet<string>, predicate: Predicate<K, V>): Map<K, V> {
        const result = new Map<K, V>();
        for (const [kd, vd] of this._containerService.getAllEntries(this._name)) {
            const k = this._toObject<K>(kd);
            const v = this._toObject<V>(vd);
            if (k === null || v === null) continue;
            if (!candidateKeys.has(this._indexKey(k))) continue;
            if (predicate.apply(this._makeEntry(k, v))) {
                result.set(k, v);
            }
        }
        return result;
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
