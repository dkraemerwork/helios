/**
 * Port of {@code com.hazelcast.cache.recordstore.CacheRecordStoreTest}.
 * Tests core get/put/remove/expiryPolicy on CacheRecordStore.
 */
import { CacheRecordStore } from '@zenystx/helios-core/cache/impl/CacheRecordStore';
import type { ICacheRecordStore } from '@zenystx/helios-core/cache/impl/ICacheRecordStore';
import { InMemoryFormat } from '@zenystx/helios-core/cache/impl/InMemoryFormat';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';
import { HeapData } from '@zenystx/helios-core/internal/serialization/impl/HeapData';
import type { SerializationService } from '@zenystx/helios-core/internal/serialization/SerializationService';
import { beforeEach, describe, expect, test } from 'bun:test';

const RECORD_COUNT = 50;

function makeSerializationService(): SerializationService {
    return {
        toData(obj: unknown): Data | null {
            if (obj === null || obj === undefined) return null;
            const json = JSON.stringify(obj);
            const buf = Buffer.from(json, 'utf8');
            const hdr = Buffer.alloc(8);
            return new HeapData(Buffer.concat([hdr, buf]));
        },
        toObject<T>(data: Data | null): T | null {
            if (data === null) return null;
            const bytes = data.toByteArray();
            if (!bytes || bytes.length <= 8) return null;
            const json = bytes.slice(8).toString('utf8');
            return JSON.parse(json) as T;
        },
        writeObject() {},
        readObject<T>(): T { return null as unknown as T; },
        getClassLoader() { return null; },
    };
}

function createCacheRecordStore(format: InMemoryFormat): ICacheRecordStore {
    const ss = makeSerializationService();
    return new CacheRecordStore(format, ss);
}

function toKey(ss: SerializationService, i: number): Data {
    return ss.toData(i)!;
}

describe('CacheRecordStoreTest', () => {
    let ss: SerializationService;

    beforeEach(() => {
        ss = makeSerializationService();
    });

    test('putObjectAndGetDataFromCacheRecordStore', () => {
        const store = createCacheRecordStore(InMemoryFormat.BINARY);
        for (let i = 0; i < RECORD_COUNT; i++) {
            store.put(toKey(ss, i), `value-${i}`, null, null, -1);
        }
        // In BINARY format, get() returns Data
        for (let i = 0; i < RECORD_COUNT; i++) {
            const result = store.get(toKey(ss, i), null);
            expect(result).not.toBeNull();
            // It should be Data-like (have toByteArray)
            expect(typeof (result as Data).toByteArray).toBe('function');
        }
    });

    test('putObjectAndGetObjectFromCacheRecordStore', () => {
        const store = createCacheRecordStore(InMemoryFormat.OBJECT);
        for (let i = 0; i < RECORD_COUNT; i++) {
            store.put(toKey(ss, i), `value-${i}`, null, null, -1);
        }
        // In OBJECT format, get() returns the deserialized object (string)
        for (let i = 0; i < RECORD_COUNT; i++) {
            const result = store.get(toKey(ss, i), null);
            expect(typeof result).toBe('string');
            expect(result).toBe(`value-${i}`);
        }
    });

    test('putObjectAndGetObjectExpiryPolicyFromCacheRecordStore', () => {
        const store = createCacheRecordStore(InMemoryFormat.OBJECT);
        const expiryPolicy = { type: 'ETERNAL' };
        for (let i = 0; i < RECORD_COUNT; i++) {
            const key = toKey(ss, i);
            store.put(key, `value-${i}`, null, null, -1);
            store.setExpiryPolicy(new Set([key]), expiryPolicy, null);
        }
        // In OBJECT format, getExpiryPolicy() returns the object
        for (let i = 0; i < RECORD_COUNT; i++) {
            const policy = store.getExpiryPolicy(toKey(ss, i));
            expect(policy).toEqual(expiryPolicy);
        }
    });

    test('putObjectAndGetDataExpiryPolicyFromCacheRecordStore', () => {
        const store = createCacheRecordStore(InMemoryFormat.BINARY);
        const expiryPolicy = { type: 'ETERNAL' };
        const expiryData = ss.toData(expiryPolicy)!;
        for (let i = 0; i < RECORD_COUNT; i++) {
            const key = toKey(ss, i);
            store.put(key, `value-${i}`, null, null, -1);
            store.setExpiryPolicy(new Set([key]), expiryData, null);
        }
        // In BINARY format, getExpiryPolicy() returns Data
        for (let i = 0; i < RECORD_COUNT; i++) {
            const policy = store.getExpiryPolicy(toKey(ss, i));
            expect(policy).not.toBeNull();
            expect(typeof (policy as Data).toByteArray).toBe('function');
        }
    });
});
