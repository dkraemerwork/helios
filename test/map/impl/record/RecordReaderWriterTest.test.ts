/**
 * Port of {@code com.hazelcast.map.impl.record.RecordReaderWriterTest}.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import type { Data } from '@zenystx/core/internal/serialization/Data';
import { HeapData } from '@zenystx/core/internal/serialization/impl/HeapData';
import { ByteArrayObjectDataOutput } from '@zenystx/core/internal/serialization/impl/ByteArrayObjectDataOutput';
import { ByteArrayObjectDataInput, BIG_ENDIAN } from '@zenystx/core/internal/serialization/impl/ByteArrayObjectDataInput';
import { RecordReaderWriter } from '@zenystx/core/map/impl/record/RecordReaderWriter';
import { DataRecordWithStats } from '@zenystx/core/map/impl/record/DataRecordWithStats';
import { ObjectRecordWithStats } from '@zenystx/core/map/impl/record/ObjectRecordWithStats';
import { Records } from '@zenystx/core/map/impl/record/Records';
import { ExpiryMetadataImpl } from '@zenystx/core/map/impl/recordstore/expiry/ExpiryMetadataImpl';
import type { ExpiryMetadata } from '@zenystx/core/map/impl/recordstore/expiry/ExpiryMetadata';

/** Create a HeapData with an integer payload (type=1, value=id). */
function makeData(id: number): Data {
    const buf = Buffer.allocUnsafe(12);
    buf.writeInt32BE(0, 0);
    buf.writeInt32BE(1, 4);
    buf.writeInt32BE(id, 8);
    return new HeapData(buf);
}

/** Minimal service stub — only writeData/readData are needed for record serialization. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nullService: any = {
    writeObject: () => { throw new Error('not needed'); },
    readObject: () => { throw new Error('not needed'); },
    toData: () => null,
    toObject: () => null,
    getClassLoader: () => null,
};

describe('RecordReaderWriterTest', () => {
    function newExpiryMetadata(): ExpiryMetadata {
        return new ExpiryMetadataImpl();
    }

    function writeReadAndGet(expectedRecord: DataRecordWithStats | ObjectRecordWithStats, dataValue: Data, _expiryMetadata: ExpiryMetadata): DataRecordWithStats {
        const out = new ByteArrayObjectDataOutput(256, nullService, BIG_ENDIAN);
        Records.writeRecord(out, expectedRecord, dataValue);
        const bytes = out.toByteArray();
        const inp = new ByteArrayObjectDataInput(bytes, nullService, BIG_ENDIAN);
        return Records.readRecord(inp) as DataRecordWithStats;
    }

    function populateRecord(record: DataRecordWithStats | ObjectRecordWithStats, expiryMetadata: ExpiryMetadata, dataValue: Data): void {
        record.setVersion(3);
        record.setLastUpdateTime(4);
        record.setLastAccessTime(5);
        record.setLastStoredTime(6);
        record.setCreationTime(8);
        record.setVersion(9);
        record.setHits(10);
        record.setValue(dataValue as never);

        expiryMetadata.setTtl(1);
        expiryMetadata.setMaxIdle(2);
        expiryMetadata.setExpirationTime(7);
    }

    test('data_record_with_stats_matching_reader_writer_id_is_data_record_with_stats_reader_writer_id', () => {
        expect(new DataRecordWithStats().getMatchingRecordReaderWriter()).toBe(RecordReaderWriter.DATA_RECORD_WITH_STATS_READER_WRITER);
    });

    test('object_record_with_stats_matching_reader_writer_id_is_data_record_with_stats_reader_writer_id', () => {
        expect(new ObjectRecordWithStats().getMatchingRecordReaderWriter()).toBe(RecordReaderWriter.DATA_RECORD_WITH_STATS_READER_WRITER);
    });

    test('written_and_read_data_record_with_stats_are_equal', () => {
        const expiryMetadata = newExpiryMetadata();
        const dataValue = makeData(11);
        const writtenRecord = new DataRecordWithStats();
        populateRecord(writtenRecord, expiryMetadata, dataValue);
        const readRecord = writeReadAndGet(writtenRecord, dataValue, expiryMetadata);
        expect(readRecord.equals(writtenRecord)).toBe(true);
    });

    test('written_and_read_object_record_with_stats_are_equal', () => {
        const expiryMetadata = newExpiryMetadata();
        const dataValue = makeData(11);
        const writtenRecord = new ObjectRecordWithStats();
        populateRecord(writtenRecord, expiryMetadata, dataValue);

        // ObjectRecord is written as DataRecordWithStats on disk
        const readRecord = writeReadAndGet(writtenRecord, dataValue, expiryMetadata);

        // Build equivalent DataRecordWithStats to compare with
        const equivalent = new DataRecordWithStats(dataValue);
        equivalent.setHits(writtenRecord.getHits());
        equivalent.setVersion(writtenRecord.getVersion());
        equivalent.setCreationTime(writtenRecord.getCreationTime());
        equivalent.setLastAccessTime(writtenRecord.getLastAccessTime());
        equivalent.setLastStoredTime(writtenRecord.getLastStoredTime());
        equivalent.setLastUpdateTime(writtenRecord.getLastUpdateTime());

        expect(readRecord.equals(equivalent)).toBe(true);
    });
});
