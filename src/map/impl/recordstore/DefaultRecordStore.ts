/**
 * Port of {@code com.hazelcast.map.impl.recordstore.DefaultRecordStore} (minimal).
 *
 * In-memory single-partition record store backed by a plain Map.
 * Keys are compared by their serialized byte representation (base64 string),
 * which is deterministic for all TestSerializationService-produced Data objects.
 *
 * Thread safety: Bun is single-threaded; no locking required.
 */
import type { MergeEntryStats, MergeableRecordStore } from '@zenystx/helios-core/internal/cluster/impl/SplitBrainMergeHandler';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { EntryProcessor, MapEntry } from '@zenystx/helios-core/map/EntryProcessor';
import { SimpleEntryView } from '@zenystx/helios-core/map/impl/SimpleEntryView';
import type { RecordStore } from '@zenystx/helios-core/map/impl/recordstore/RecordStore';

interface Entry {
    key: Data;
    value: Data;
    createdAt: number;
    lastAccessTime: number;
    lastUpdateTime: number;
    lastStoredTime: number;
    hits: number;
    version: number;
    ttl: number;
    maxIdle: number;
}

export class DefaultRecordStore implements RecordStore, MergeableRecordStore {
    /**
     * Keyed by the base64 representation of the Data payload.
     * This gives us content-equality semantics without referencing the Data.equals()
     * method on every lookup — sufficient for single-node in-process use.
     */
    private readonly _data = new Map<string, Entry>();

    // ── internal key helper ───────────────────────────────────────────────

    private _key(data: Data): string {
        const buf = data.toByteArray();
        return buf != null ? buf.toString('base64') : '';
    }

    private _normalizeDuration(value: number): number {
        return value <= 0 ? -1 : value;
    }

    private _expirationTime(entry: Entry): number {
        return entry.ttl > 0 ? entry.createdAt + entry.ttl : -1;
    }

    private _isExpired(entry: Entry, now: number): boolean {
        const expiredByTtl = entry.ttl > 0 && now >= entry.createdAt + entry.ttl;
        const expiredByIdle = entry.maxIdle > 0 && now >= entry.lastAccessTime + entry.maxIdle;
        return expiredByTtl || expiredByIdle;
    }

    private _getLiveEntry(key: Data, now = Date.now()): Entry | undefined {
        const cacheKey = this._key(key);
        const entry = this._data.get(cacheKey);
        if (entry === undefined) {
            return undefined;
        }
        if (this._isExpired(entry, now)) {
            this._data.delete(cacheKey);
            return undefined;
        }
        return entry;
    }

    private _newEntry(key: Data, value: Data, ttl: number, maxIdle: number, now: number): Entry {
        return {
            key,
            value,
            createdAt: now,
            lastAccessTime: now,
            lastUpdateTime: now,
            lastStoredTime: -1,
            hits: 0,
            version: 0,
            ttl: this._normalizeDuration(ttl),
            maxIdle: this._normalizeDuration(maxIdle),
        };
    }

    private _touchOnRead(entry: Entry, now: number): void {
        entry.hits += 1;
        entry.lastAccessTime = now;
    }

    private _updateEntry(entry: Entry, value: Data, ttl: number, maxIdle: number, now: number): void {
        entry.value = value;
        entry.lastUpdateTime = now;
        entry.lastAccessTime = now;
        entry.version += 1;
        entry.ttl = this._normalizeDuration(ttl);
        entry.maxIdle = this._normalizeDuration(maxIdle);
    }

    private _liveEntries(): Entry[] {
        const now = Date.now();
        const entries: Entry[] = [];
        for (const [cacheKey, entry] of this._data.entries()) {
            if (this._isExpired(entry, now)) {
                this._data.delete(cacheKey);
                continue;
            }
            entries.push(entry);
        }
        return entries;
    }

    // ── RecordStore interface ─────────────────────────────────────────────

    get(key: Data): Data | null {
        const now = Date.now();
        const entry = this._getLiveEntry(key, now);
        if (entry === undefined) return null;
        this._touchOnRead(entry, now);
        return entry.value;
    }

    put(key: Data, value: Data, ttl: number, maxIdle: number): Data | null {
        const k = this._key(key);
        const now = Date.now();
        const entry = this._getLiveEntry(key, now);
        if (entry === undefined) {
            this._data.set(k, this._newEntry(key, value, ttl, maxIdle, now));
            return null;
        }
        const old = entry.value;
        this._updateEntry(entry, value, ttl, maxIdle, now);
        return old;
    }

    set(key: Data, value: Data, ttl: number, maxIdle: number): void {
        this.put(key, value, ttl, maxIdle);
    }

    putIfAbsent(key: Data, value: Data, ttl: number, maxIdle: number): Data | null {
        const k = this._key(key);
        const now = Date.now();
        const existing = this._getLiveEntry(key, now);
        if (existing !== undefined) {
            return existing.value;
        }
        this._data.set(k, this._newEntry(key, value, ttl, maxIdle, now));
        return null;
    }

    replace(key: Data, value: Data, ttl: number, maxIdle: number): Data | null {
        const entry = this._getLiveEntry(key);
        if (entry === undefined) {
            return null;
        }
        const old = entry.value;
        this._updateEntry(entry, value, ttl, maxIdle, Date.now());
        return old;
    }

    removeIfSame(key: Data, value: Data): boolean {
        const entry = this._getLiveEntry(key);
        if (entry === undefined || !entry.value.equals(value)) {
            return false;
        }
        this._data.delete(this._key(key));
        return true;
    }

    remove(key: Data): Data | null {
        const k = this._key(key);
        const existing = this._getLiveEntry(key);
        if (existing === undefined) return null;
        this._data.delete(k);
        return existing.value;
    }

    delete(key: Data): boolean {
        return this.remove(key) !== null;
    }

    containsKey(key: Data): boolean {
        return this._getLiveEntry(key) !== undefined;
    }

    containsValue(value: Data): boolean {
        for (const entry of this._liveEntries()) {
            if (entry.value.equals(value)) return true;
        }
        return false;
    }

    putAll(entries: ReadonlyArray<readonly [Data, Data]>): void {
        for (const [k, v] of entries) {
            this.put(k, v, -1, -1);
        }
    }

    getAll(keys: ReadonlyArray<Data>): Array<readonly [Data, Data | null]> {
        return keys.map(k => [k, this.get(k)] as const);
    }

    executeOnKey<R>(key: Data, processor: EntryProcessor<R>): R | null {
        const k = this._key(key);
        const now = Date.now();
        const existing = this._getLiveEntry(key, now);
        let currentValue: Data | null = existing?.value ?? null;
        let newValue: Data | null | undefined;

        const entry: MapEntry = {
            getKey: () => key,
            getValue: () => currentValue,
            setValue: (v: Data | null) => {
                newValue = v;
                currentValue = v;
            },
            exists: () => currentValue !== null,
        };

        const result = processor.process(entry);

        if (newValue !== undefined) {
            if (newValue === null) {
                this._data.delete(k);
            } else {
                if (existing === undefined) {
                    this._data.set(k, this._newEntry(key, newValue, -1, -1, now));
                } else {
                    this._updateEntry(existing, newValue, existing.ttl, existing.maxIdle, now);
                }
            }
        } else if (existing !== undefined) {
            this._touchOnRead(existing, now);
        }

        return result;
    }

    executeOnEntries<R>(processor: EntryProcessor<R>): Array<readonly [Data, R | null]> {
        const results: Array<readonly [Data, R | null]> = [];
        // Snapshot to avoid modifying the map while iterating.
        const snapshot = this._liveEntries().map((entry) => [this._key(entry.key), entry] as const);
        for (const [strKey, existing] of snapshot) {
            const { key, value } = existing;
            let currentValue: Data | null = value;
            let newValue: Data | null | undefined;

            const entry: MapEntry = {
                getKey: () => key,
                getValue: () => currentValue,
                setValue: (v: Data | null) => {
                    newValue = v;
                    currentValue = v;
                },
                exists: () => currentValue !== null,
            };

            const result = processor.process(entry);

            if (newValue !== undefined) {
                if (newValue === null) {
                    this._data.delete(strKey);
                } else {
                    this._updateEntry(existing, newValue, existing.ttl, existing.maxIdle, Date.now());
                }
            } else {
                this._touchOnRead(existing, Date.now());
            }

            results.push([key, result]);
        }
        return results;
    }

    evict(key: Data): boolean {
        return this.delete(key);
    }

    getEntryView(key: Data): SimpleEntryView<Data, Data> | null {
        const now = Date.now();
        const entry = this._getLiveEntry(key, now);
        if (entry === undefined) {
            return null;
        }
        this._touchOnRead(entry, now);
        const view = new SimpleEntryView(entry.key, entry.value);
        const keyBytes = entry.key.toByteArray()?.length ?? 0;
        const valueBytes = entry.value.toByteArray()?.length ?? 0;
        return view
            .setCost(keyBytes + valueBytes)
            .setCreationTime(entry.createdAt)
            .setExpirationTime(this._expirationTime(entry))
            .setHits(entry.hits)
            .setLastAccessTime(entry.lastAccessTime)
            .setLastStoredTime(entry.lastStoredTime)
            .setLastUpdateTime(entry.lastUpdateTime)
            .setVersion(entry.version)
            .setTtl(entry.ttl)
            .setMaxIdle(entry.maxIdle);
    }

    getEntryStats(key: Data): MergeEntryStats | null {
        const entry = this._data.get(this._key(key));
        if (entry === undefined) return null;
        return {
            hits: entry.hits,
            creationTime: entry.createdAt,
            lastAccessTime: entry.lastAccessTime,
            lastUpdateTime: entry.lastUpdateTime,
            expirationTime: this._expirationTime(entry),
            version: entry.version,
        };
    }

    setTtl(key: Data, ttl: number): boolean {
        const entry = this._getLiveEntry(key);
        if (entry === undefined) {
            return false;
        }
        entry.ttl = this._normalizeDuration(ttl);
        entry.lastUpdateTime = Date.now();
        entry.version += 1;
        return true;
    }

    size(): number {
        return this._liveEntries().length;
    }

    isEmpty(): boolean {
        return this.size() === 0;
    }

    clear(): void {
        this._data.clear();
    }

    entries(): IterableIterator<readonly [Data, Data]> {
        const liveEntries = this._liveEntries();
        return (function* (entries: Entry[]) {
            for (const { key, value } of entries) {
                yield [key, value] as const;
            }
        })(liveEntries);
    }
}
