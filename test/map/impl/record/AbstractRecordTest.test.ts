/**
 * Port of {@code com.hazelcast.map.impl.record.AbstractRecordTest}.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { Record } from '@zenystx/core/map/impl/record/Record';
import { ObjectRecordWithStats } from '@zenystx/core/map/impl/record/ObjectRecordWithStats';
import { SystemClock } from '@zenystx/core/internal/util/time/Clock';

describe('AbstractRecordTest', () => {
    const VALUE = {};

    let record: ObjectRecordWithStats;
    let recordSameAttributes: ObjectRecordWithStats;
    let recordOtherVersion: ObjectRecordWithStats;
    let recordOtherCreationTime: ObjectRecordWithStats;
    let recordOtherHits: ObjectRecordWithStats;
    let recordOtherLastAccessTime: ObjectRecordWithStats;
    let recordOtherLastUpdateTime: ObjectRecordWithStats;

    beforeEach(() => {
        record = new ObjectRecordWithStats(VALUE);

        recordSameAttributes = new ObjectRecordWithStats();
        recordSameAttributes.setValue(VALUE);

        recordOtherVersion = new ObjectRecordWithStats(VALUE);
        recordOtherVersion.setVersion(42);

        recordOtherCreationTime = new ObjectRecordWithStats(VALUE);
        recordOtherCreationTime.setCreationTime(SystemClock.nowMillis());

        recordOtherHits = new ObjectRecordWithStats(VALUE);
        recordOtherHits.setHits(23);

        recordOtherLastAccessTime = new ObjectRecordWithStats(VALUE);
        recordOtherLastAccessTime.setLastAccessTime(SystemClock.nowMillis());

        recordOtherLastUpdateTime = new ObjectRecordWithStats(VALUE);
        recordOtherLastUpdateTime.setLastUpdateTime(SystemClock.nowMillis() + 10000);
    });

    test('testGetCachedValueUnsafe', () => {
        expect(record.getCachedValueUnsafe()).toBe(Record.NOT_CACHED);
    });

    test('testSetSequence_doesNothing', () => {
        expect(record.getSequence()).toBe(Record.UNSET);
        record.setSequence(1250293);
        expect(record.getSequence()).toBe(Record.UNSET);
    });

    test('testEquals', () => {
        expect(record.equals(record)).toBe(true);
        expect(record.equals(recordSameAttributes)).toBe(true);

        expect(record.equals(null)).toBe(false);
        expect(record.equals({})).toBe(false);

        expect(record.equals(recordOtherVersion)).toBe(false);
        expect(record.equals(recordOtherCreationTime)).toBe(false);
        expect(record.equals(recordOtherHits)).toBe(false);
        expect(record.equals(recordOtherLastAccessTime)).toBe(false);
        expect(record.equals(recordOtherLastUpdateTime)).toBe(false);
    });

    test('testHashCode', () => {
        expect(record.hashCode()).toBe(record.hashCode());
        expect(record.hashCode()).toBe(recordSameAttributes.hashCode());

        // Differences in fields (version, creationTime, hits, etc.) guarantee different hash codes
        expect(record.hashCode()).not.toBe(recordOtherVersion.hashCode());
        expect(record.hashCode()).not.toBe(recordOtherCreationTime.hashCode());
        expect(record.hashCode()).not.toBe(recordOtherHits.hashCode());
        expect(record.hashCode()).not.toBe(recordOtherLastAccessTime.hashCode());
        expect(record.hashCode()).not.toBe(recordOtherLastUpdateTime.hashCode());
    });
});
