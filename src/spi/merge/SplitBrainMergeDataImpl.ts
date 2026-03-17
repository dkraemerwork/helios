/**
 * Concrete implementation of {@link SplitBrainMergeData}.
 * Wraps a record's key, value, and all stats needed by merge policies.
 */
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { SplitBrainMergeData } from './MergingValue';

export class SplitBrainMergeDataImpl implements SplitBrainMergeData {
    private readonly _key: Data;
    private readonly _value: Data | null;
    private readonly _hits: number;
    private readonly _creationTime: number;
    private readonly _lastAccessTime: number;
    private readonly _lastUpdateTime: number;
    private readonly _expirationTime: number;
    private readonly _version: number;

    constructor(
        key: Data,
        value: Data | null,
        hits: number = 0,
        creationTime: number = 0,
        lastAccessTime: number = 0,
        lastUpdateTime: number = 0,
        expirationTime: number = Number.MAX_SAFE_INTEGER,
        version: number = 0,
    ) {
        this._key = key;
        this._value = value;
        this._hits = hits;
        this._creationTime = creationTime;
        this._lastAccessTime = lastAccessTime;
        this._lastUpdateTime = lastUpdateTime;
        this._expirationTime = expirationTime;
        this._version = version;
    }

    getKey(): Data { return this._key; }
    getDeserializedKey<K>(): K { return this._key as unknown as K; }
    getValue(): Data | null { return this._value; }
    getDeserializedValue<V>(): V | null { return this._value as unknown as V; }
    getHits(): number { return this._hits; }
    getCreationTime(): number { return this._creationTime; }
    getLastAccessTime(): number { return this._lastAccessTime; }
    getLastUpdateTime(): number { return this._lastUpdateTime; }
    getExpirationTime(): number { return this._expirationTime; }
    getVersion(): number { return this._version; }
}
