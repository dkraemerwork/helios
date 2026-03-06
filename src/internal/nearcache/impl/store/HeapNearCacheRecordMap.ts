/**
 * Port of {@code com.hazelcast.internal.nearcache.impl.store.HeapNearCacheRecordMap}.
 *
 * On-heap Map for Near Cache records with sampling-based eviction support.
 * Bun is single-threaded so all operations are straightforward (no CAS/locking).
 */
import type { NearCacheRecord } from '@zenystx/helios-core/internal/nearcache/NearCacheRecord';
import { READ_PERMITTED } from '@zenystx/helios-core/internal/nearcache/NearCacheRecord';

export interface EvictionListener<K, R> {
    onEvict(key: K, record: R, wasExpired: boolean): void;
}

export class HeapNearCacheRecordMap<K, R extends NearCacheRecord> {
    private readonly _map: Map<K, R>;

    constructor(initialCapacity = 16) {
        this._map = new Map<K, R>();
        void initialCapacity; // hint only — JS Map grows dynamically
    }

    size(): number { return this._map.size; }
    has(key: K): boolean { return this._map.has(key); }
    get(key: K): R | undefined { return this._map.get(key); }
    set(key: K, value: R): this { this._map.set(key, value); return this; }
    delete(key: K): boolean { return this._map.delete(key); }
    clear(): void { this._map.clear(); }
    keys(): IterableIterator<K> { return this._map.keys(); }
    entries(): IterableIterator<[K, R]> { return this._map.entries(); }
    values(): IterableIterator<R> { return this._map.values(); }
    forEach(cb: (value: R, key: K) => void): void { this._map.forEach(cb); }

    /**
     * If key is absent, call fn(key) and store the result.
     * Returns the (possibly newly created) record, or undefined if fn returned null/undefined.
     */
    applyIfAbsent(key: K, fn: (key: K) => R | null | undefined): R | undefined {
        if (!this._map.has(key)) {
            const result = fn(key);
            if (result != null) {
                this._map.set(key, result);
                return result;
            }
            return undefined;
        }
        return undefined;
    }

    /**
     * If key is present, call fn(key, record). If fn returns null/undefined, delete entry.
     * Returns the new record value (or null if deleted / not found).
     */
    applyIfPresent(key: K, fn: (key: K, record: R) => R | null | undefined): R | null {
        const existing = this._map.get(key);
        if (existing !== undefined) {
            const result = fn(key, existing);
            if (result == null) {
                this._map.delete(key);
                return null;
            }
            this._map.set(key, result);
            return result;
        }
        return null;
    }

    /**
     * Apply fn to the (possibly absent) record for key.
     * If fn returns null/undefined, delete the entry.
     * Returns the new record (or null if deleted).
     */
    apply(key: K, fn: (key: K, record: R | undefined) => R | null | undefined): R | null {
        const existing = this._map.get(key);
        const result = fn(key, existing);
        if (result == null) {
            this._map.delete(key);
            return null;
        }
        this._map.set(key, result);
        return result;
    }

    /**
     * Try to evict the record at accessor key.
     * Only evicts READ_PERMITTED records (not reserved ones).
     * Notifies evictionListener if provided.
     */
    tryEvict(accessorKey: K, evictionListener: EvictionListener<K, R> | null): boolean {
        const record = this._map.get(accessorKey);
        if (record === undefined || record.getReservationId() !== READ_PERMITTED) {
            return false;
        }
        this._map.delete(accessorKey);
        if (evictionListener !== null) {
            evictionListener.onEvict(accessorKey, record, false);
        }
        return true;
    }

    /**
     * Returns a random sample of up to sampleCount entries.
     * Used by sampling-based eviction strategies.
     */
    sample(sampleCount: number): Array<[K, R]> {
        const total = this._map.size;
        if (total === 0) return [];
        const n = Math.min(sampleCount, total);
        const entries = Array.from(this._map.entries());
        // Fisher-Yates partial shuffle for a random sample
        for (let i = 0; i < n; i++) {
            const j = i + Math.floor(Math.random() * (total - i));
            const tmp = entries[i];
            entries[i] = entries[j];
            entries[j] = tmp;
        }
        return entries.slice(0, n);
    }
}
