/**
 * Port of {@code com.hazelcast.map.impl.record.Records}.
 *
 * Factory and helper methods for {@link Record} objects.
 */
import type { Record } from './Record';
import { Record as RecordNS } from './Record';
import { RecordReaderWriter } from './RecordReaderWriter';
import { DataRecordWithStats } from './DataRecordWithStats';
import { ObjectRecordWithStats } from './ObjectRecordWithStats';
import { SimpleRecord } from './SimpleRecord';
import { SimpleRecordWithLRUEviction } from './SimpleRecordWithLRUEviction';
import { SimpleRecordWithLFUEviction } from './SimpleRecordWithLFUEviction';
import type { Data } from '@helios/internal/serialization/Data';
import type { SerializationService } from '@helios/internal/serialization/SerializationService';
import type { ByteArrayObjectDataOutput } from '@helios/internal/serialization/impl/ByteArrayObjectDataOutput';
import type { ByteArrayObjectDataInput } from '@helios/internal/serialization/impl/ByteArrayObjectDataInput';
import type { ExpiryMetadata } from '../recordstore/expiry/ExpiryMetadata';
import { NULL_EXPIRY_METADATA } from '../recordstore/expiry/ExpiryMetadata';
import { ExpiryMetadataImpl } from '../recordstore/expiry/ExpiryMetadataImpl';

// ──────────────────────────────────────────────────────────────────────────────
// Wire up RecordReaderWriter implementations (done once at module load time)
// ──────────────────────────────────────────────────────────────────────────────

RecordReaderWriter._register(
    RecordReaderWriter.DATA_RECORD_WITH_STATS_READER_WRITER,
    (out, record, dataValue) => {
        out.writeData(dataValue);
        out.writeInt(record.getRawCreationTime());
        out.writeInt(record.getRawLastAccessTime());
        out.writeInt(record.getRawLastUpdateTime());
        out.writeInt(record.getHits());
        out.writeInt(record.getVersion());
        out.writeInt(record.getRawLastStoredTime());
    },
    (inp) => {
        const record = new DataRecordWithStats();
        record.setValue(inp.readData());
        record.setRawCreationTime(inp.readInt());
        record.setRawLastAccessTime(inp.readInt());
        record.setRawLastUpdateTime(inp.readInt());
        record.setHits(inp.readInt());
        record.setVersion(inp.readInt());
        record.setRawLastStoredTime(inp.readInt());
        return record;
    },
);

RecordReaderWriter._register(
    RecordReaderWriter.SIMPLE_DATA_RECORD_READER_WRITER,
    (out, record, dataValue) => {
        out.writeData(dataValue);
        out.writeInt(record.getVersion());
    },
    (inp) => {
        const record = new SimpleRecord();
        record.setValue(inp.readData());
        record.setVersion(inp.readInt());
        return record;
    },
);

RecordReaderWriter._register(
    RecordReaderWriter.SIMPLE_DATA_RECORD_WITH_LRU_EVICTION_READER_WRITER,
    (out, record, dataValue) => {
        out.writeData(dataValue);
        out.writeInt(record.getVersion());
        out.writeInt(record.getRawLastAccessTime());
    },
    (inp) => {
        const record = new SimpleRecordWithLRUEviction();
        record.setValue(inp.readData());
        record.setVersion(inp.readInt());
        record.setRawLastAccessTime(inp.readInt());
        return record;
    },
);

RecordReaderWriter._register(
    RecordReaderWriter.SIMPLE_DATA_RECORD_WITH_LFU_EVICTION_READER_WRITER,
    (out, record, dataValue) => {
        out.writeData(dataValue);
        out.writeInt(record.getVersion());
        out.writeInt(record.getHits());
    },
    (inp) => {
        const record = new SimpleRecordWithLFUEviction();
        record.setValue(inp.readData());
        record.setVersion(inp.readInt());
        record.setHits(inp.readInt());
        return record;
    },
);

// ──────────────────────────────────────────────────────────────────────────────

export class Records {
    private constructor() {}

    static writeRecord(out: ByteArrayObjectDataOutput, record: Record<unknown>, dataValue: Data): void {
        const rw = record.getMatchingRecordReaderWriter();
        out.writeByte(rw.getId());
        rw.writeRecord(out, record, dataValue);
    }

    static readRecord(inp: ByteArrayObjectDataInput): Record<unknown> {
        const id = inp.readByte();
        return RecordReaderWriter.getById(id).readRecord(inp);
    }

    static writeExpiry(out: ByteArrayObjectDataOutput, expiryMetadata: ExpiryMetadata): void {
        const hasExpiry = expiryMetadata.hasExpiry();
        out.writeBoolean(hasExpiry);
        if (hasExpiry) {
            expiryMetadata.write(out);
        }
    }

    static readExpiry(inp: ByteArrayObjectDataInput): ExpiryMetadata {
        const hasExpiry = inp.readBoolean();
        if (!hasExpiry) return NULL_EXPIRY_METADATA;
        const metadata = new ExpiryMetadataImpl();
        metadata.read(inp);
        return metadata;
    }

    static copyMetadataFrom(fromRecord: Record<unknown> | null, toRecord: Record<unknown>): void {
        if (fromRecord == null) return;
        toRecord.setHits(fromRecord.getHits());
        toRecord.setVersion(fromRecord.getVersion());
        toRecord.setCreationTime(fromRecord.getCreationTime());
        toRecord.setLastAccessTime(fromRecord.getLastAccessTime());
        toRecord.setLastStoredTime(fromRecord.getLastStoredTime());
        toRecord.setLastUpdateTime(fromRecord.getLastUpdateTime());
    }

    /**
     * Returns the cached deserialized value from the record, guarding against
     * accidental exposure of internal mutex markers.
     */
    static getCachedValue(record: Record<unknown>): unknown {
        return record.getCachedValueUnsafe();
    }

    /**
     * Returns cached value where appropriate, otherwise the raw value.
     * Caching is supported only for non-Portable, non-JSON, non-Compact Data.
     *
     * Single-threaded simplification: no Thread-as-mutex pattern.
     */
    static getValueOrCachedValue(record: Record<unknown>, ss: SerializationService | null): unknown {
        const cached = record.getCachedValueUnsafe();
        if (cached === RecordNS.NOT_CACHED) {
            // Record does not support caching at all (e.g. DataRecordWithStats)
            return record.getValue();
        }
        if (cached !== null) {
            // Already cached
            return cached;
        }
        // cached === null → not yet cached
        const value = record.getValue();
        if (!Records.shouldCache(value)) {
            return value;
        }
        // Single-threaded: deserialize and cache directly
        const deserialized = ss!.toObject<unknown>(value as Data);
        record.casCachedValue(null, deserialized);
        return deserialized;
    }

    static shouldCache(value: unknown): boolean {
        if (value == null) return false;
        if (typeof value === 'object' && 'isPortable' in value) {
            const data = value as Data;
            return !(data.isPortable() || data.isJson() || data.isCompact());
        }
        return false;
    }

    // Kept for compatibility with ObjectRecordWithStats serialization
    static _getAsDataRecord(fromRecord: Record<unknown>, dataValue: Data): DataRecordWithStats {
        const toRecord = new DataRecordWithStats(dataValue);
        Records.copyMetadataFrom(fromRecord, toRecord);
        return toRecord;
    }
}
