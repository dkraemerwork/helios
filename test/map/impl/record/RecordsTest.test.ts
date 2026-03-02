/**
 * Port of {@code com.hazelcast.map.impl.record.RecordsTest}.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import type { InternalSerializationService } from '@helios/internal/serialization/InternalSerializationService';
import type { Data } from '@helios/internal/serialization/Data';
import { HeapData } from '@helios/internal/serialization/impl/HeapData';
import { DataRecordWithStats } from '@helios/map/impl/record/DataRecordWithStats';
import { CachedDataRecordWithStats } from '@helios/map/impl/record/CachedDataRecordWithStats';
import { Records } from '@helios/map/impl/record/Records';

/**
 * Minimal serialization service for tests.
 * Uses JSON + HeapData (type=1) so shouldCache() returns true.
 */
class TestSerializationService implements InternalSerializationService {
    toData(obj: unknown): Data | null {
        if (obj === null || obj === undefined) return null;
        const json = JSON.stringify(obj);
        const utf8 = Buffer.from(json, 'utf8');
        const buf = Buffer.allocUnsafe(8 + utf8.length);
        buf.writeInt32BE(0, 0); // partition hash
        buf.writeInt32BE(1, 4); // type = 1 (not portable/json/compact → cacheable)
        utf8.copy(buf, 8);
        return new HeapData(buf);
    }

    toObject<T>(data: Data | null): T | null {
        if (data === null) return null;
        const bytes = data.toByteArray();
        if (bytes === null || bytes.length <= 8) return null;
        const json = bytes.slice(8).toString('utf8');
        return JSON.parse(json) as T;
    }

    writeObject(_out: unknown, _obj: unknown): void { throw new Error('not needed'); }
    readObject<T>(_inp: unknown): T { throw new Error('not needed'); }
    getClassLoader(): unknown { return null; }
}

describe('RecordsTest', () => {
    let serializationService: TestSerializationService;

    beforeEach(() => {
        serializationService = new TestSerializationService();
    });

    test('getValueOrCachedValue_whenRecordIsNotCachable_thenDoNotCache', () => {
        const objectPayload = 'foo';
        const dataPayload = serializationService.toData(objectPayload)!;
        const record = new DataRecordWithStats(dataPayload);
        const value = Records.getValueOrCachedValue(record, null as unknown as InternalSerializationService);
        // DataRecordWithStats does not cache → returns the Data directly
        expect(value).toBe(dataPayload);
    });

    test('getValueOrCachedValue_whenRecordIsCachedDataRecordWithStats_thenCache', () => {
        const objectPayload = 'foo';
        const dataPayload = serializationService.toData(objectPayload)!;
        const record = new CachedDataRecordWithStats(dataPayload);
        const firstDeserializedValue = Records.getValueOrCachedValue(record, serializationService);
        expect(firstDeserializedValue).toEqual(objectPayload);

        // Second call with null ss — should return cached value
        const secondDeserializedValue = Records.getValueOrCachedValue(record, null as unknown as InternalSerializationService);
        expect(secondDeserializedValue).toBe(firstDeserializedValue);
    });

    test('getValueOrCachedValue_whenRecordIsCachedDataRecord_thenCache', () => {
        const objectPayload = 'foo';
        const dataPayload = serializationService.toData(objectPayload)!;
        const record = new CachedDataRecordWithStats(dataPayload);
        const firstDeserializedValue = Records.getValueOrCachedValue(record, serializationService);
        expect(firstDeserializedValue).toEqual(objectPayload);

        const secondDeserializedValue = Records.getValueOrCachedValue(record, null as unknown as InternalSerializationService);
        expect(secondDeserializedValue).toBe(firstDeserializedValue);
    });

    test('givenCachedDataRecord_whenObjectDeserialized_thenReturnsDeserialized', () => {
        // Adapted from givenCachedDataRecord_whenThreadIsInside (Thread → plain object)
        const record = new CachedDataRecordWithStats();
        const objectPayload = { kind: 'marker' };
        const dataPayload = serializationService.toData(objectPayload)!;
        record.setValue(dataPayload);
        const cachedValue = Records.getValueOrCachedValue(record, serializationService);
        expect(cachedValue).toEqual(objectPayload);
    });

    test('givenCachedDataRecordValueIsObject_whenCachedValueIsCreated_thenGetCachedValueReturnsIt', () => {
        // Adapted from givenCachedDataRecordValueIsThread (Thread → plain object)
        const objectPayload = { kind: 'marker' };
        const dataPayload = serializationService.toData(objectPayload)!;
        const record = new CachedDataRecordWithStats(dataPayload);
        Records.getValueOrCachedValue(record, serializationService);
        const cachedValue = Records.getCachedValue(record);
        expect(cachedValue).toEqual(objectPayload);
    });
});
