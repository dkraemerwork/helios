/**
 * Port of {@code com.hazelcast.map.impl.record.DataRecordWithStatsTest}.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import type { Data } from '@zenystx/core/internal/serialization/Data';
import { DataRecordWithStats } from '@zenystx/core/map/impl/record/DataRecordWithStats';
import { ObjectRecordWithStats } from '@zenystx/core/map/impl/record/ObjectRecordWithStats';
import { HeapData } from '@zenystx/core/internal/serialization/impl/HeapData';

/** Create a minimal Data stub with a unique non-empty payload. */
function mockData(id: number): Data {
    // 8-byte header (partition hash + type) + 4 bytes payload
    const buf = Buffer.allocUnsafe(12);
    buf.writeInt32BE(0, 0);   // partition hash
    buf.writeInt32BE(1, 4);   // type = 1
    buf.writeInt32BE(id, 8);  // unique payload
    return new HeapData(buf);
}

describe('DataRecordWithStatsTest', () => {
    const VALUE: Data = mockData(1);

    let record: DataRecordWithStats;
    let recordSameAttributes: DataRecordWithStats;
    let recordOtherKeyAndValue: DataRecordWithStats;
    let objectRecord: ObjectRecordWithStats;

    beforeEach(() => {
        const otherKey = mockData(2);

        record = new DataRecordWithStats(VALUE);

        recordSameAttributes = new DataRecordWithStats();
        recordSameAttributes.setValue(VALUE);

        recordOtherKeyAndValue = new DataRecordWithStats();
        recordOtherKeyAndValue.setValue(otherKey);

        objectRecord = new ObjectRecordWithStats();
        objectRecord.setValue(new Object());
    });

    test('testGetValue', () => {
        expect(record.getValue()).toBe(VALUE);
        expect(recordSameAttributes.getValue()).toBe(VALUE);
        expect(recordOtherKeyAndValue.getValue()).not.toBe(VALUE);
    });

    test('testGetCosts', () => {
        expect(record.getCost()).toBeGreaterThan(0);
        expect(recordSameAttributes.getCost()).toBeGreaterThan(0);
        expect(recordOtherKeyAndValue.getCost()).toBeGreaterThan(0);
    });

    test('testEquals', () => {
        expect(record.equals(record)).toBe(true);
        expect(record.equals(recordSameAttributes)).toBe(true);

        expect(record.equals(null)).toBe(false);
        expect(record.equals(new Object())).toBe(false);

        expect(record.equals(objectRecord)).toBe(false);
        expect(record.equals(recordOtherKeyAndValue)).toBe(false);
    });

    test('testHashCode', () => {
        expect(record.hashCode()).toBe(record.hashCode());
        expect(record.hashCode()).toBe(recordSameAttributes.hashCode());

        expect(record.hashCode()).not.toBe(objectRecord.hashCode());
        expect(record.hashCode()).not.toBe(recordOtherKeyAndValue.hashCode());
    });
});
