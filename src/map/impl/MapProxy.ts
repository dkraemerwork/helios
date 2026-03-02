/**
 * Full IMap implementation — Block 7.4.
 *
 * Wraps a RecordStore and NodeEngine to provide a typed, user-facing
 * distributed-map proxy with:
 *   - Predicate-based queries (keySet/values/entrySet with Predicate)
 *   - Aggregation (aggregate / aggregate with Predicate)
 *   - Entry listeners (addEntryListener / removeEntryListener)
 *   - Locking (lock / tryLock / unlock / isLocked)
 *   - Async variants (putAsync / getAsync / removeAsync)
 *   - Extended ops (set / delete / containsValue / replace / replaceIfSame)
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

    constructor(
        name: string,
        store: RecordStore,
        nodeEngine: NodeEngine,
        containerService: MapContainerService,
    ) {
        this._name = name;
        this._store = store;
        this._nodeEngine = nodeEngine;
        this._containerService = containerService;
    }

    // ── Identification ────────────────────────────────────────────────────

    getName(): string {
        return this._name;
    }

    // ── Core point ops ────────────────────────────────────────────────────

    put(key: K, value: V): V | null {
        const kd = this._toData(key);
        const vd = this._toData(value);
        const oldData = this._store.put(kd, vd, -1, -1);
        const oldValue = oldData !== null ? this._toObject<V>(oldData) : null;
        if (oldValue === null) {
            this._fireAdded(key, value);
        } else {
            this._fireUpdated(key, value, oldValue);
        }
        return oldValue;
    }

    set(key: K, value: V): void {
        const kd = this._toData(key);
        const vd = this._toData(value);
        const hadOld = this._store.containsKey(kd);
        this._store.set(kd, vd, -1, -1);
        if (!hadOld) {
            this._fireAdded(key, value);
        } else {
            this._fireUpdated(key, value, null);
        }
    }

    get(key: K): V | null {
        const kd = this._toData(key);
        const data = this._store.get(kd);
        return data !== null ? this._toObject<V>(data) : null;
    }

    remove(key: K): V | null {
        const kd = this._toData(key);
        const oldData = this._store.remove(kd);
        if (oldData === null) return null;
        const oldValue = this._toObject<V>(oldData);
        this._fireRemoved(key, oldValue);
        return oldValue;
    }

    delete(key: K): void {
        const kd = this._toData(key);
        const removed = this._store.delete(kd);
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

    clear(): void {
        this._store.clear();
        this._fireCleared();
    }

    putIfAbsent(key: K, value: V): V | null {
        const kd = this._toData(key);
        const vd = this._toData(value);
        const existing = this._store.putIfAbsent(kd, vd, -1, -1);
        return existing !== null ? this._toObject<V>(existing) : null;
    }

    putAll(entries: Iterable<[K, V]>): void {
        const dataPairs: [Data, Data][] = [];
        for (const [k, v] of entries) {
            dataPairs.push([this._toData(k), this._toData(v)]);
        }
        this._store.putAll(dataPairs);
    }

    getAll(keys: K[]): Map<K, V | null> {
        const keyDatas = keys.map(k => this._toData(k));
        const results = this._store.getAll(keyDatas);
        const map = new Map<K, V | null>();
        for (let i = 0; i < keys.length; i++) {
            const vData = results[i][1];
            map.set(keys[i], vData !== null ? this._toObject<V>(vData) : null);
        }
        return map;
    }

    replace(key: K, value: V): V | null {
        if (!this.containsKey(key)) return null;
        return this.put(key, value);
    }

    replaceIfSame(key: K, oldValue: V, newValue: V): boolean {
        const current = this.get(key);
        if (current === null) return false;
        // Use structural equality for objects, strict equality for primitives
        if (!this._equals(current, oldValue)) return false;
        this.put(key, newValue);
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

    putAsync(key: K, value: V): Promise<V | null> {
        return Promise.resolve(this.put(key, value));
    }

    getAsync(key: K): Promise<V | null> {
        return Promise.resolve(this.get(key));
    }

    removeAsync(key: K): Promise<V | null> {
        return Promise.resolve(this.remove(key));
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
