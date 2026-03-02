/**
 * IMap wrapper that adds near-cache read-through and write-invalidation.
 *
 * Delegates all IMap methods to the underlying map proxy, intercepting:
 * - get() / getAsync(): check near-cache first, populate on miss
 * - put() / set() / remove() / delete() / clear(): invalidate near-cache
 * - putIfAbsent() / replace() / replaceIfSame() / putAll(): invalidate near-cache
 *
 * Block 12.A3: Updated to async signatures matching the updated IMap interface.
 * Phase 8: wires DefaultNearCache into HeliosInstanceImpl.getMap().
 */
import type { IMap } from '@helios/map/IMap';
import type { NearCache } from '@helios/internal/nearcache/NearCache';
import { CACHED_AS_NULL, NOT_CACHED } from '@helios/internal/nearcache/NearCache';
import { NOT_RESERVED } from '@helios/internal/nearcache/NearCacheRecord';
import type { Predicate } from '@helios/query/Predicate';
import type { Aggregator } from '@helios/aggregation/Aggregator';
import type { EntryListener } from '@helios/map/EntryListener';

export class NearCachedIMapWrapper<K, V> implements IMap<K, V> {
    private readonly _delegate: IMap<K, V>;
    private readonly _nearCache: NearCache<K, V>;

    constructor(delegate: IMap<K, V>, nearCache: NearCache<K, V>) {
        this._delegate = delegate;
        this._nearCache = nearCache;
    }

    getName(): string { return this._delegate.getName(); }

    // ── Near-cache-aware read path ──────────────────────────────────

    async get(key: K): Promise<V | null> {
        const cached = this._nearCache.get(key);
        if (cached === CACHED_AS_NULL) return null;
        if (cached !== NOT_CACHED) return cached as V;

        // Cache miss — reserve, fetch from backing store, publish
        const reservationId = this._nearCache.tryReserveForUpdate(key, null, 'READ_UPDATE');
        const value = await this._delegate.get(key);

        if (reservationId !== NOT_RESERVED) {
            this._nearCache.tryPublishReserved(key, value, reservationId, false);
        }

        return value;
    }

    async getAsync(key: K): Promise<V | null> {
        return this.get(key);
    }

    // ── Near-cache-aware write path (invalidate on mutation) ────────

    async put(key: K, value: V): Promise<V | null> {
        const old = await this._delegate.put(key, value);
        this._nearCache.invalidate(key);
        return old;
    }

    async set(key: K, value: V): Promise<void> {
        await this._delegate.set(key, value);
        this._nearCache.invalidate(key);
    }

    async remove(key: K): Promise<V | null> {
        const old = await this._delegate.remove(key);
        this._nearCache.invalidate(key);
        return old;
    }

    async delete(key: K): Promise<void> {
        await this._delegate.delete(key);
        this._nearCache.invalidate(key);
    }

    async clear(): Promise<void> {
        await this._delegate.clear();
        this._nearCache.clear();
    }

    async putIfAbsent(key: K, value: V): Promise<V | null> {
        const old = await this._delegate.putIfAbsent(key, value);
        this._nearCache.invalidate(key);
        return old;
    }

    async putAll(entries: Iterable<[K, V]>): Promise<void> {
        // Collect entries so we can iterate twice (once for delegate, once for invalidation)
        const collected = Array.from(entries);
        await this._delegate.putAll(collected);
        for (const [key] of collected) {
            this._nearCache.invalidate(key);
        }
    }

    async replace(key: K, value: V): Promise<V | null> {
        const old = await this._delegate.replace(key, value);
        this._nearCache.invalidate(key);
        return old;
    }

    async replaceIfSame(key: K, oldValue: V, newValue: V): Promise<boolean> {
        const replaced = await this._delegate.replaceIfSame(key, oldValue, newValue);
        if (replaced) {
            this._nearCache.invalidate(key);
        }
        return replaced;
    }

    async putAsync(key: K, value: V): Promise<V | null> {
        return this.put(key, value);
    }

    async removeAsync(key: K): Promise<V | null> {
        return this.remove(key);
    }

    // ── Pure delegation (no near-cache impact) ──────────────────────

    containsKey(key: K): boolean { return this._delegate.containsKey(key); }
    containsValue(value: V): boolean { return this._delegate.containsValue(value); }
    size(): number { return this._delegate.size(); }
    isEmpty(): boolean { return this._delegate.isEmpty(); }
    async getAll(keys: K[]): Promise<Map<K, V | null>> { return this._delegate.getAll(keys); }

    values(): V[];
    values(predicate: Predicate<K, V>): V[];
    values(predicate?: Predicate<K, V>): V[] {
        return predicate ? this._delegate.values(predicate) : this._delegate.values();
    }

    keySet(): Set<K>;
    keySet(predicate: Predicate<K, V>): Set<K>;
    keySet(predicate?: Predicate<K, V>): Set<K> {
        return predicate ? this._delegate.keySet(predicate) : this._delegate.keySet();
    }

    entrySet(): Map<K, V>;
    entrySet(predicate: Predicate<K, V>): Map<K, V>;
    entrySet(predicate?: Predicate<K, V>): Map<K, V> {
        return predicate ? this._delegate.entrySet(predicate) : this._delegate.entrySet();
    }

    aggregate<R>(aggregator: Aggregator<[K, V], R>, predicate?: Predicate<K, V>): R {
        return predicate
            ? this._delegate.aggregate(aggregator, predicate)
            : this._delegate.aggregate(aggregator);
    }

    addEntryListener(listener: EntryListener<K, V>, includeValue?: boolean): string {
        return this._delegate.addEntryListener(listener, includeValue);
    }

    removeEntryListener(listenerId: string): boolean {
        return this._delegate.removeEntryListener(listenerId);
    }

    lock(key: K): void { this._delegate.lock(key); }
    tryLock(key: K): boolean { return this._delegate.tryLock(key); }
    unlock(key: K): void { this._delegate.unlock(key); }
    isLocked(key: K): boolean { return this._delegate.isLocked(key); }

    // ── Near-cache accessor ─────────────────────────────────────────

    /** Returns the underlying near-cache for observability / stats. */
    getNearCache(): NearCache<K, V> {
        return this._nearCache;
    }
}
