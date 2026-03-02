/**
 * Port of {@code com.hazelcast.cache.impl.DeferredValueTest}.
 */
import { describe, expect, test, beforeEach } from 'bun:test';
import { DeferredValue } from '@helios/cache/impl/DeferredValue';
import type { SerializationService } from '@helios/internal/serialization/SerializationService';
import type { Data } from '@helios/internal/serialization/Data';
import { HeapData } from '@helios/internal/serialization/impl/HeapData';

// Minimal serialization service that JSON-encodes values
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

describe('DeferredValueTest', () => {
    let serializationService: SerializationService;
    let expected: string;
    let serializedValue: Data;
    let valueSet: Set<string>;
    let deferredSet: Set<DeferredValue<string>>;
    let adaptedSet: Set<string>;

    beforeEach(() => {
        serializationService = makeSerializationService();
        expected = 'hello-test-' + Math.random().toString(36).slice(2);
        serializedValue = serializationService.toData(expected)!;

        valueSet = new Set(['1', '2', '3']);
        deferredSet = DeferredValue.concurrentSetOfValues(valueSet);
        adaptedSet = DeferredValue.asPassThroughSet(deferredSet, serializationService);
    });

    test('testValue_isSame_whenConstructedWithValue', () => {
        const deferredValue = DeferredValue.withValue(expected);
        expect(deferredValue.get(serializationService)).toBe(expected);
    });

    test('testValue_whenConstructedWithSerializedValue', () => {
        const deferredValue = DeferredValue.withSerializedValue(serializedValue);
        expect(deferredValue.get(serializationService)).toBe(expected);
    });

    test('testSerializedValue_isSame_whenConstructedWithSerializedValue', () => {
        const deferredValue = DeferredValue.withSerializedValue(serializedValue);
        expect(deferredValue.getSerializedValue(serializationService)).toBe(serializedValue);
    });

    test('testSerializedValue_whenConstructedWithValue', () => {
        const deferredValue = DeferredValue.withValue(expected);
        const serialized = deferredValue.getSerializedValue(serializationService);
        // The serialized form should round-trip to the same value
        const back = serializationService.toObject<string>(serialized!);
        expect(back).toBe(expected);
    });

    test('testEquals_WithValue', () => {
        const v1 = DeferredValue.withValue(expected);
        const v2 = DeferredValue.withValue(expected);
        expect(v1.equals(v2)).toBe(true);
    });

    test('testEquals_WithSerializedValue', () => {
        const v1 = DeferredValue.withSerializedValue(serializedValue);
        const v2 = DeferredValue.withSerializedValue(serializedValue);
        expect(v1.equals(v2)).toBe(true);
    });

    test('testEquals_WithValueAndSerializedValue_throwsIllegalArgument', () => {
        const v1 = DeferredValue.withValue(expected);
        const v2 = DeferredValue.withSerializedValue(serializedValue);
        expect(() => v1.equals(v2)).toThrow();
    });

    test('testNullValue_returnsNull', () => {
        const deferredValue = DeferredValue.withNullValue<string>();
        expect(deferredValue.getSerializedValue(serializationService)).toBeNull();
        expect(deferredValue.get(serializationService)).toBeNull();
    });

    test('testCopy_whenNullValue', () => {
        const nullValue = DeferredValue.withNullValue<string>();
        const copy = nullValue.shallowCopy();
        expect(copy.getSerializedValue(serializationService)).toBeNull();
        expect(copy.get(serializationService)).toBeNull();
    });

    test('testCopy_whenSerializedValue', () => {
        const v1 = DeferredValue.withSerializedValue<string>(serializedValue);
        const v2 = v1.shallowCopy();
        expect(v1.equals(v2)).toBe(true);
    });

    test('testCopy_whenValue', () => {
        const v1 = DeferredValue.withValue(expected);
        const v2 = v1.shallowCopy();
        expect(v1.equals(v2)).toBe(true);
    });

    test('test_setOfValues', () => {
        expect(deferredSet.has(DeferredValue.withValue('1'))).toBe(true);
        expect(deferredSet.has(DeferredValue.withValue('2'))).toBe(true);
        expect(deferredSet.has(DeferredValue.withValue('3'))).toBe(true);
        expect(deferredSet.has(DeferredValue.withValue('4'))).toBe(false);
    });

    test('test_adaptedSet_basicOps', () => {
        // initial state: 1, 2, 3
        expect(adaptedSet.size).toBe(3);
        expect(adaptedSet.has('1')).toBe(true);

        // add '4'
        adaptedSet.add('4');
        expect(deferredSet.has(DeferredValue.withValue('4'))).toBe(true);

        // delete '1'
        adaptedSet.delete('1');
        expect(deferredSet.has(DeferredValue.withValue('1'))).toBe(false);

        // iterate
        const vals: string[] = [];
        for (const v of adaptedSet) vals.push(v);
        expect(vals.length).toBe(3); // 2, 3, 4

        // clear
        adaptedSet.clear();
        expect(adaptedSet.size).toBe(0);
        expect(deferredSet.size).toBe(0);
    });
});
