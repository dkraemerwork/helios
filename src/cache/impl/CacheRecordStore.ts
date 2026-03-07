/**
 * Port of {@code com.hazelcast.cache.impl.CacheRecordStore}.
 * Single-partition key→value cache storage. Supports BINARY and OBJECT in-memory formats.
 */
import type { ICacheRecordStore } from '@zenystx/helios-core/cache/impl/ICacheRecordStore';
import { InMemoryFormat } from '@zenystx/helios-core/cache/impl/InMemoryFormat';
import { CacheDataRecord } from '@zenystx/helios-core/cache/impl/record/CacheDataRecord';
import { CacheObjectRecord } from '@zenystx/helios-core/cache/impl/record/CacheObjectRecord';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { SerializationService } from '@zenystx/helios-core/internal/serialization/SerializationService';

type AnyRecord = CacheDataRecord | CacheObjectRecord;

/**
 * Simple key identity based on byte-array equality of Data keys.
 * Uses a string key derived from the byte buffer as Map key.
 */
function dataKey(data: Data): string {
    const buf = data.toByteArray();
    if (!buf) return '';
    // Use a base64-like fingerprint as the Map key string
    return buf.toString('base64');
}

export class CacheRecordStore implements ICacheRecordStore {
    private readonly _format: InMemoryFormat;
    private readonly _ss: SerializationService;
    private readonly _records = new Map<string, AnyRecord>();
    /** Reverse map: stringKey → original Data key (for Data equality in BINARY format) */
    private readonly _dataKeys = new Map<string, Data>();

    constructor(format: InMemoryFormat, serializationService: SerializationService) {
        this._format = format;
        this._ss = serializationService;
    }

    get(key: Data, _expiryPolicy: unknown): unknown {
        const k = dataKey(key);
        const record = this._records.get(k);
        if (!record) return null;
        if (record.isExpiredAt(Date.now())) {
            this._records.delete(k);
            this._dataKeys.delete(k);
            return null;
        }
        record.incrementHits();
        record.setLastAccessTime(Date.now());

        if (this._format === InMemoryFormat.BINARY) {
            return (record as CacheDataRecord).getValue();
        } else {
            // OBJECT format
            return (record as CacheObjectRecord).getValue();
        }
    }

    put(key: Data, value: unknown, _expiryPolicy: unknown, _caller: unknown, _completionId: number): void {
        const k = dataKey(key);
        this._dataKeys.set(k, key);

        if (this._format === InMemoryFormat.BINARY) {
            const record = new CacheDataRecord();
            // Store as Data (serialize if it's not already Data)
            const dataValue = this._toData(value);
            record.setValue(dataValue);
            this._records.set(k, record);
        } else {
            // OBJECT format — deserialize if we receive Data
            const record = new CacheObjectRecord();
            const objValue = this._toObject(value);
            record.setValue(objValue);
            this._records.set(k, record);
        }
    }

    remove(key: Data, _expiryPolicy: unknown, _caller: unknown, _completionId: number): boolean {
        const k = dataKey(key);
        const existed = this._records.has(k);
        this._records.delete(k);
        this._dataKeys.delete(k);
        return existed;
    }

    contains(key: Data): boolean {
        const k = dataKey(key);
        const record = this._records.get(k);
        if (!record) return false;
        if (record.isExpiredAt(Date.now())) {
            this._records.delete(k);
            this._dataKeys.delete(k);
            return false;
        }
        return true;
    }

    size(): number { return this._records.size; }

    clear(): void {
        this._records.clear();
        this._dataKeys.clear();
    }

    setExpiryPolicy(keys: Set<Data>, expiryPolicyOrData: unknown, _caller: unknown): boolean {
        let changed = false;
        for (const key of keys) {
            const k = dataKey(key);
            const record = this._records.get(k);
            if (!record) continue;
            if (this._format === InMemoryFormat.BINARY) {
                const dataRecord = record as CacheDataRecord;
                const policyData = this._toData(expiryPolicyOrData);
                dataRecord.setExpiryPolicy(policyData);
            } else {
                const objRecord = record as CacheObjectRecord;
                const policyObj = this._toObject(expiryPolicyOrData);
                objRecord.setExpiryPolicy(policyObj);
            }
            changed = true;
        }
        return changed;
    }

    getExpiryPolicy(key: Data): unknown {
        const k = dataKey(key);
        const record = this._records.get(k);
        if (!record) return null;
        if (this._format === InMemoryFormat.BINARY) {
            return (record as CacheDataRecord).getExpiryPolicy();
        }
        return (record as CacheObjectRecord).getExpiryPolicy();
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private _toData(value: unknown): Data | null {
        if (value === null || value === undefined) return null;
        if (this._isData(value)) return value as Data;
        return this._ss.toData(value);
    }

    private _toObject(value: unknown): unknown {
        if (value === null || value === undefined) return null;
        if (this._isData(value)) return this._ss.toObject(value as Data);
        return value;
    }

    private _isData(value: unknown): boolean {
        return typeof value === 'object' && value !== null &&
               typeof (value as { toByteArray?: unknown }).toByteArray === 'function';
    }
}
