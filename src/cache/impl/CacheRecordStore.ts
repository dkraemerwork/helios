/**
 * Port of {@code com.hazelcast.cache.impl.CacheRecordStore}.
 * Single-partition key→value cache storage. Supports BINARY and OBJECT in-memory formats.
 *
 * Fires {@link CacheEntryEvent}s through an injected {@link CacheListenerRegistry}
 * on put (CREATED / UPDATED), remove (REMOVED), and expiry (EXPIRED).
 */
import type { ICacheRecordStore } from '@zenystx/helios-core/cache/impl/ICacheRecordStore';
import { InMemoryFormat } from '@zenystx/helios-core/cache/impl/InMemoryFormat';
import { CacheDataRecord } from '@zenystx/helios-core/cache/impl/record/CacheDataRecord';
import { CacheObjectRecord } from '@zenystx/helios-core/cache/impl/record/CacheObjectRecord';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import type { SerializationService } from '@zenystx/helios-core/internal/serialization/SerializationService';
import { CacheEntryEventType } from './CacheEntryEvent.js';
import type { CacheListenerRegistry } from './CacheListenerRegistry.js';

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
    private readonly _cacheName: string;
    private readonly _registry: CacheListenerRegistry | null;

    constructor(
        format: InMemoryFormat,
        serializationService: SerializationService,
        cacheName = '',
        registry: CacheListenerRegistry | null = null,
    ) {
        this._format = format;
        this._ss = serializationService;
        this._cacheName = cacheName;
        this._registry = registry;
    }

    get(key: Data, _expiryPolicy: unknown): unknown {
        const k = dataKey(key);
        const record = this._records.get(k);
        if (!record) return null;
        if (record.isExpiredAt(Date.now())) {
            // Fire EXPIRED event before removing
            this._fireExpired(key, record);
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
        const isUpdate = this._records.has(k);
        const oldRecord = isUpdate ? this._records.get(k)! : null;

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

        const newRecord = this._records.get(k)!;

        if (isUpdate) {
            this._fireUpdated(key, newRecord, oldRecord);
        } else {
            this._fireCreated(key, newRecord);
        }
    }

    remove(key: Data, _expiryPolicy: unknown, _caller: unknown, _completionId: number): boolean {
        const k = dataKey(key);
        const record = this._records.get(k);
        const existed = record !== undefined;
        if (existed) {
            this._fireRemoved(key, record!);
        }
        this._records.delete(k);
        this._dataKeys.delete(k);
        return existed;
    }

    contains(key: Data): boolean {
        const k = dataKey(key);
        const record = this._records.get(k);
        if (!record) return false;
        if (record.isExpiredAt(Date.now())) {
            this._fireExpired(key, record);
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

    // ── Event helpers ─────────────────────────────────────────────────────────

    private _fireCreated(key: Data, record: AnyRecord): void {
        if (!this._registry || this._registry.isEmpty()) return;
        this._registry.fireEvent({
            key,
            value: this._recordValue(record),
            oldValue: null,
            eventType: CacheEntryEventType.CREATED,
            source: this._cacheName,
        });
    }

    private _fireUpdated(key: Data, newRecord: AnyRecord, oldRecord: AnyRecord | null): void {
        if (!this._registry || this._registry.isEmpty()) return;
        this._registry.fireEvent({
            key,
            value: this._recordValue(newRecord),
            oldValue: oldRecord !== null ? this._recordValue(oldRecord) : null,
            eventType: CacheEntryEventType.UPDATED,
            source: this._cacheName,
        });
    }

    private _fireRemoved(key: Data, record: AnyRecord): void {
        if (!this._registry || this._registry.isEmpty()) return;
        this._registry.fireEvent({
            key,
            value: null,
            oldValue: this._recordValue(record),
            eventType: CacheEntryEventType.REMOVED,
            source: this._cacheName,
        });
    }

    private _fireExpired(key: Data, record: AnyRecord): void {
        if (!this._registry || this._registry.isEmpty()) return;
        this._registry.fireEvent({
            key,
            value: null,
            oldValue: this._recordValue(record),
            eventType: CacheEntryEventType.EXPIRED,
            source: this._cacheName,
        });
    }

    private _recordValue(record: AnyRecord): unknown {
        if (this._format === InMemoryFormat.BINARY) {
            return (record as CacheDataRecord).getValue();
        }
        return (record as CacheObjectRecord).getValue();
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
