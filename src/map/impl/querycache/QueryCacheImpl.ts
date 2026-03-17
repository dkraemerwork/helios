/**
 * Port of Hazelcast's QueryCache implementation.
 *
 * Maintains an in-memory subset of IMap entries matching a predicate.
 * Event-driven updates keep the cache synchronized.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { Predicate } from '@zenystx/helios-core/query/Predicate';
import type { QueryCache, QueryCacheEntryListener } from '@zenystx/helios-core/map/QueryCache';
import type { QueryCacheConfig } from '@zenystx/helios-core/config/QueryCacheConfig';

interface SerializationBridge {
    toData(obj: unknown): Data | null;
    toObject<T>(data: Data): T;
}

interface MapDataSource {
    getAllEntries(mapName: string): IterableIterator<readonly [Data, Data]>;
}

interface CacheEntry<K, V> {
    key: Data;
    keyObj: K;
    value: Data;
    valueObj: V;
}

export class QueryCacheImpl<K, V> implements QueryCache<K, V> {
    private readonly _name: string;
    private readonly _mapName: string;
    private readonly _config: QueryCacheConfig;
    private readonly _predicate: Predicate;
    private readonly _cache = new Map<string, CacheEntry<K, V>>();
    private readonly _serialization: SerializationBridge;
    private readonly _dataSource: MapDataSource;
    private readonly _listeners = new Map<string, QueryCacheEntryListener<K, V>>();
    private _destroyed = false;

    constructor(
        name: string,
        mapName: string,
        config: QueryCacheConfig,
        predicate: Predicate,
        serialization: SerializationBridge,
        dataSource: MapDataSource,
    ) {
        this._name = name;
        this._mapName = mapName;
        this._config = config;
        this._predicate = predicate;
        this._serialization = serialization;
        this._dataSource = dataSource;
    }

    /** Populate the cache from the source map. */
    async populate(): Promise<void> {
        this._cache.clear();
        for (const [keyData, valueData] of this._dataSource.getAllEntries(this._mapName)) {
            const keyObj = this._serialization.toObject<K>(keyData);
            const valueObj = this._serialization.toObject<V>(valueData);
            const entry = this._makeQueryableEntry(keyObj, valueObj);
            if (this._predicate.apply(entry)) {
                const keyStr = this._dataKeyString(keyData);
                this._cache.set(keyStr, { key: keyData, keyObj, value: valueData, valueObj });
            }
        }
    }

    /** Handle a map event (put/remove). Keeps the cache synchronized. */
    onMapEvent(
        type: 'put' | 'remove' | 'evict',
        keyData: Data,
        oldValueData: Data | null,
        newValueData: Data | null,
    ): void {
        if (this._destroyed) return;
        const keyStr = this._dataKeyString(keyData);
        const keyObj = this._serialization.toObject<K>(keyData);

        if (type === 'remove' || type === 'evict') {
            const existing = this._cache.get(keyStr);
            if (existing) {
                this._cache.delete(keyStr);
                for (const listener of this._listeners.values()) {
                    if (type === 'remove') {
                        listener.entryRemoved?.(keyObj, existing.valueObj);
                    } else {
                        listener.entryEvicted?.(keyObj, existing.valueObj);
                    }
                }
            }
            return;
        }

        // PUT
        if (newValueData === null) return;
        const newValueObj = this._serialization.toObject<V>(newValueData);
        const entry = this._makeQueryableEntry(keyObj, newValueObj);
        const matches = this._predicate.apply(entry);
        const existing = this._cache.get(keyStr);

        if (matches) {
            this._cache.set(keyStr, { key: keyData, keyObj, value: newValueData, valueObj: newValueObj });

            // Enforce eviction max size (LRU-like: evict the first/oldest entry)
            if (this._cache.size > this._config.getEvictionMaxSize()) {
                const firstKey = this._cache.keys().next().value;
                if (firstKey !== undefined) {
                    const evicted = this._cache.get(firstKey);
                    this._cache.delete(firstKey);
                    if (evicted) {
                        for (const listener of this._listeners.values()) {
                            listener.entryEvicted?.(evicted.keyObj, evicted.valueObj);
                        }
                    }
                }
            }

            for (const listener of this._listeners.values()) {
                if (existing) {
                    listener.entryUpdated?.(keyObj, existing.valueObj, newValueObj);
                } else {
                    listener.entryAdded?.(keyObj, newValueObj);
                }
            }
        } else if (existing) {
            // Entry no longer matches predicate — remove from cache
            this._cache.delete(keyStr);
            for (const listener of this._listeners.values()) {
                listener.entryRemoved?.(keyObj, existing.valueObj);
            }
        }
    }

    get(key: K): V | null {
        const keyData = this._serialization.toData(key);
        if (!keyData) return null;
        return this._cache.get(this._dataKeyString(keyData))?.valueObj ?? null;
    }

    containsKey(key: K): boolean {
        const keyData = this._serialization.toData(key);
        if (!keyData) return false;
        return this._cache.has(this._dataKeyString(keyData));
    }

    containsValue(value: V): boolean {
        for (const entry of this._cache.values()) {
            if (entry.valueObj === value) return true;
        }
        return false;
    }

    isEmpty(): boolean { return this._cache.size === 0; }
    size(): number { return this._cache.size; }

    keySet(): Set<K>;
    keySet(predicate: Predicate<K, V>): Set<K>;
    keySet(predicate?: Predicate<K, V>): Set<K> {
        const result = new Set<K>();
        for (const entry of this._cache.values()) {
            if (!predicate || predicate.apply(this._makeQueryableEntry(entry.keyObj, entry.valueObj))) {
                result.add(entry.keyObj);
            }
        }
        return result;
    }

    values(): V[];
    values(predicate: Predicate<K, V>): V[];
    values(predicate?: Predicate<K, V>): V[] {
        const result: V[] = [];
        for (const entry of this._cache.values()) {
            if (!predicate || predicate.apply(this._makeQueryableEntry(entry.keyObj, entry.valueObj))) {
                result.push(entry.valueObj);
            }
        }
        return result;
    }

    entrySet(): Set<[K, V]>;
    entrySet(predicate: Predicate<K, V>): Set<[K, V]>;
    entrySet(predicate?: Predicate<K, V>): Set<[K, V]> {
        const result = new Set<[K, V]>();
        for (const entry of this._cache.values()) {
            if (!predicate || predicate.apply(this._makeQueryableEntry(entry.keyObj, entry.valueObj))) {
                result.add([entry.keyObj, entry.valueObj]);
            }
        }
        return result;
    }

    async recreate(): Promise<void> {
        await this.populate();
    }

    async destroy(): Promise<void> {
        this._destroyed = true;
        this._cache.clear();
        this._listeners.clear();
    }

    getName(): string { return this._name; }

    addEntryListener(listener: QueryCacheEntryListener<K, V>, _includeValue?: boolean): string {
        const id = crypto.randomUUID();
        this._listeners.set(id, listener);
        return id;
    }

    removeEntryListener(listenerId: string): boolean {
        return this._listeners.delete(listenerId);
    }

    private _dataKeyString(data: Data): string {
        const bytes = data.toByteArray();
        if (!bytes) return '';
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    private _makeQueryableEntry(keyObj: K, valueObj: V) {
        return {
            getKey: () => keyObj,
            getValue: () => valueObj,
            getAttributeValue: (attr: string) => {
                if (attr === '__key') return keyObj as unknown;
                if (attr === 'this') return valueObj as unknown;
                if (typeof valueObj === 'object' && valueObj !== null) {
                    const parts = attr.split('.');
                    let current: unknown = valueObj;
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
}
