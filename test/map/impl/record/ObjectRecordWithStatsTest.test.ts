/**
 * Port of {@code com.hazelcast.map.impl.record.ObjectRecordWithStatsTest}.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { DataRecordWithStats } from '@zenystx/helios-core/map/impl/record/DataRecordWithStats';
import { ObjectRecordWithStats } from '@zenystx/helios-core/map/impl/record/ObjectRecordWithStats';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';

function mockData(id: number): Data {
    const buf = Buffer.allocUnsafe(12);
    buf.writeInt32BE(0, 0);
    buf.writeInt32BE(1, 4);
    buf.writeInt32BE(id, 8);
    return new HeapData(buf);
}

describe('ObjectRecordWithStatsTest', () => {
    const VALUE = {};

    let record: ObjectRecordWithStats;
    let recordSameAttributes: ObjectRecordWithStats;
    let recordOtherLastStoredTime: ObjectRecordWithStats;
    let recordOtherKeyAndValue: ObjectRecordWithStats;
    let dataRecord: DataRecordWithStats;

    beforeEach(() => {
        const key = mockData(1);
        const otherValue = {};

        record = new ObjectRecordWithStats(VALUE);

        recordSameAttributes = new ObjectRecordWithStats();
        recordSameAttributes.setValue(VALUE);

        recordOtherLastStoredTime = new ObjectRecordWithStats(VALUE);
        recordOtherLastStoredTime.onStore();

        recordOtherKeyAndValue = new ObjectRecordWithStats();
        recordOtherKeyAndValue.setValue(otherValue);

        dataRecord = new DataRecordWithStats();
        dataRecord.setValue(key);
    });

    test('testGetValue', () => {
        expect(record.getValue()).toBe(VALUE);
        expect(recordSameAttributes.getValue()).toBe(VALUE);
        expect(recordOtherKeyAndValue.getValue()).not.toBe(VALUE);
    });

    test('testGetCosts', () => {
        expect(record.getCost()).toBe(0);
    });

    test('testEquals', () => {
        expect(record.equals(record)).toBe(true);
        expect(record.equals(recordSameAttributes)).toBe(true);

        expect(record.equals(null)).toBe(false);
        expect(record.equals(new Object())).toBe(false);

        expect(record.equals(dataRecord)).toBe(false);
        expect(record.equals(recordOtherLastStoredTime)).toBe(false);
        expect(record.equals(recordOtherKeyAndValue)).toBe(false);
    });

    test('testHashCode', () => {
        expect(record.hashCode()).toBe(record.hashCode());
        expect(record.hashCode()).toBe(recordSameAttributes.hashCode());

        expect(record.hashCode()).not.toBe(dataRecord.hashCode());
        expect(record.hashCode()).not.toBe(recordOtherLastStoredTime.hashCode());
        expect(record.hashCode()).not.toBe(recordOtherKeyAndValue.hashCode());
    });
});
