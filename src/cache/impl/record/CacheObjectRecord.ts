/**
 * Port of {@code com.hazelcast.cache.impl.record.CacheObjectRecord}.
 * Record that stores the value as a deserialized object (OBJECT in-memory format).
 */
import type { CacheRecord } from '@zenystx/core/cache/impl/record/CacheRecord';

export class CacheObjectRecord implements CacheRecord<unknown, unknown> {
    readonly TIME_NOT_AVAILABLE = -1 as const;

    private _value: unknown = null;
    private _expiryPolicy: unknown = null;
    private _creationTime = Date.now();
    private _lastAccessTime = -1;
    private _expirationTime = -1;
    private _hits = 0;

    getValue(): unknown { return this._value; }
    setValue(v: unknown): void { this._value = v; }

    getCreationTime(): number { return this._creationTime; }
    setCreationTime(t: number): void { this._creationTime = t; }

    getLastAccessTime(): number { return this._lastAccessTime; }
    setLastAccessTime(t: number): void { this._lastAccessTime = t; }

    getHits(): number { return this._hits; }
    setHits(h: number): void { this._hits = h; }
    incrementHits(): void { this._hits++; }

    getExpiryPolicy(): unknown { return this._expiryPolicy; }
    setExpiryPolicy(p: unknown): void { this._expiryPolicy = p; }

    getExpirationTime(): number { return this._expirationTime; }
    setExpirationTime(t: number): void { this._expirationTime = t; }

    isExpiredAt(now: number): boolean {
        return this._expirationTime >= 0 && now >= this._expirationTime;
    }
}
