/**
 * Port of {@code com.hazelcast.cache.impl.record.CacheDataRecord}.
 * Record that stores the value in serialized {@code Data} form (BINARY in-memory format).
 */
import type { Data } from '@helios/internal/serialization/Data';
import type { CacheRecord } from '@helios/cache/impl/record/CacheRecord';

export class CacheDataRecord implements CacheRecord<Data, Data> {
    readonly TIME_NOT_AVAILABLE = -1 as const;

    private _value: Data | null = null;
    private _expiryPolicy: Data | null = null;
    private _creationTime = Date.now();
    private _lastAccessTime = -1;
    private _expirationTime = -1;
    private _hits = 0;

    getValue(): Data | null { return this._value; }
    setValue(v: Data | null): void { this._value = v; }

    getCreationTime(): number { return this._creationTime; }
    setCreationTime(t: number): void { this._creationTime = t; }

    getLastAccessTime(): number { return this._lastAccessTime; }
    setLastAccessTime(t: number): void { this._lastAccessTime = t; }

    getHits(): number { return this._hits; }
    setHits(h: number): void { this._hits = h; }
    incrementHits(): void { this._hits++; }

    getExpiryPolicy(): Data | null { return this._expiryPolicy; }
    setExpiryPolicy(p: Data | null): void { this._expiryPolicy = p; }

    getExpirationTime(): number { return this._expirationTime; }
    setExpirationTime(t: number): void { this._expirationTime = t; }

    isExpiredAt(now: number): boolean {
        return this._expirationTime >= 0 && now >= this._expirationTime;
    }
}
