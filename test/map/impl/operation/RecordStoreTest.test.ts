/**
 * Unit tests for DefaultRecordStore — the in-memory per-partition map store.
 * Ported from com.hazelcast.map.impl.recordstore (operation unit tests, Block 3.2b).
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { DefaultRecordStore } from '@zenystx/helios-core/map/impl/recordstore/DefaultRecordStore';
import { TestSerializationService } from '@zenystx/helios-core/test-support/TestSerializationService';
import type { Data } from '@zenystx/helios-core/internal/serialization/Data';

describe('DefaultRecordStore', () => {
    let store: DefaultRecordStore;
    let ser: TestSerializationService;

    function k(s: string): Data { return ser.toData(s)!; }
    function v(x: unknown): Data { return ser.toData(x)!; }
    function obj(d: Data | null): unknown { return ser.toObject(d); }

    beforeEach(() => {
        store = new DefaultRecordStore();
        ser = new TestSerializationService();
    });

    test('put: returns null for new key', () => {
        expect(store.put(k('a'), v(1), -1, -1)).toBeNull();
    });

    test('put: returns old value for existing key', () => {
        store.put(k('a'), v(1), -1, -1);
        const old = store.put(k('a'), v(2), -1, -1);
        expect(old).not.toBeNull();
        expect(obj(old)).toBe(1);
    });

    test('get: returns stored value', () => {
        store.put(k('a'), v('hello'), -1, -1);
        expect(obj(store.get(k('a')))).toBe('hello');
    });

    test('get: returns null for missing key', () => {
        expect(store.get(k('missing'))).toBeNull();
    });

    test('remove: returns old value and removes entry', () => {
        store.put(k('a'), v(10), -1, -1);
        const old = store.remove(k('a'));
        expect(obj(old)).toBe(10);
        expect(store.get(k('a'))).toBeNull();
    });

    test('remove: returns null for missing key', () => {
        expect(store.remove(k('ghost'))).toBeNull();
    });

    test('delete: returns true when key existed', () => {
        store.put(k('x'), v(1), -1, -1);
        expect(store.delete(k('x'))).toBe(true);
        expect(store.containsKey(k('x'))).toBe(false);
    });

    test('delete: returns false when key missing', () => {
        expect(store.delete(k('nope'))).toBe(false);
    });

    test('containsKey: true for present, false for absent', () => {
        store.put(k('p'), v(5), -1, -1);
        expect(store.containsKey(k('p'))).toBe(true);
        expect(store.containsKey(k('q'))).toBe(false);
    });

    test('putIfAbsent: inserts when absent and returns null', () => {
        const old = store.putIfAbsent(k('n'), v('new'), -1, -1);
        expect(old).toBeNull();
        expect(obj(store.get(k('n')))).toBe('new');
    });

    test('putIfAbsent: returns existing value and does not overwrite', () => {
        store.put(k('e'), v('orig'), -1, -1);
        const old = store.putIfAbsent(k('e'), v('attempt'), -1, -1);
        expect(obj(old)).toBe('orig');
        expect(obj(store.get(k('e')))).toBe('orig');
    });

    test('set: stores value without returning old value', () => {
        store.set(k('s'), v('val'), -1, -1);
        expect(obj(store.get(k('s')))).toBe('val');
        expect(store.size()).toBe(1);
    });

    test('size and isEmpty', () => {
        expect(store.isEmpty()).toBe(true);
        expect(store.size()).toBe(0);
        store.put(k('a'), v(1), -1, -1);
        expect(store.size()).toBe(1);
        expect(store.isEmpty()).toBe(false);
    });

    test('clear: removes all entries', () => {
        store.put(k('a'), v(1), -1, -1);
        store.put(k('b'), v(2), -1, -1);
        store.clear();
        expect(store.size()).toBe(0);
        expect(store.isEmpty()).toBe(true);
    });

    test('putAll: stores multiple entries', () => {
        const entries: Array<[Data, Data]> = [
            [k('x'), v(10)],
            [k('y'), v(20)],
            [k('z'), v(30)],
        ];
        store.putAll(entries);
        expect(store.size()).toBe(3);
        expect(obj(store.get(k('x')))).toBe(10);
        expect(obj(store.get(k('y')))).toBe(20);
        expect(obj(store.get(k('z')))).toBe(30);
    });
});
