/**
 * Block 7.4 — MapProxy full IMap contract tests.
 * Block 12.A3: Updated to use async IMap methods.
 *
 * Tests: predicate queries, aggregation, entry listeners, locking, async ops,
 * and all new IMap methods added in Block 7.4.
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { MapProxy } from '@helios/map/impl/MapProxy';
import { DefaultRecordStore } from '@helios/map/impl/recordstore/DefaultRecordStore';
import { MapContainerService } from '@helios/map/impl/MapContainerService';
import { TestNodeEngine } from '@helios/test-support/TestNodeEngine';
import type { IMap } from '@helios/map/IMap';
import type { Predicate } from '@helios/query/Predicate';
import type { Aggregator } from '@helios/aggregation/Aggregator';
import type { EntryListener } from '@helios/map/EntryListener';
import type { QueryableEntry } from '@helios/query/impl/QueryableEntry';

// ── helpers ────────────────────────────────────────────────────────────────

/** Creates a Predicate that accepts entries whose value === expected. */
function valuePredicate<K, V>(expected: V): Predicate<K, V> {
    return {
        apply(entry: QueryableEntry<K, V>): boolean {
            return entry.getValue() === expected;
        },
    };
}

/** Creates a Predicate that accepts entries whose key === expected. */
function keyPredicate<K, V>(expected: K): Predicate<K, V> {
    return {
        apply(entry: QueryableEntry<K, V>): boolean {
            return entry.getKey() === expected;
        },
    };
}

/** Simple sum aggregator over [string, number] entries. */
class SumAggregator implements Aggregator<[string, number], number> {
    private _sum = 0;
    accumulate(input: [string, number]): void { this._sum += input[1]; }
    onAccumulationFinished(): void {}
    combine(_other: Aggregator<unknown, unknown>): void {}
    onCombinationFinished(): void {}
    aggregate(): number { return this._sum; }
}

// ── fixture ───────────────────────────────────────────────────────────────

function makeProxy(): IMap<string, number> {
    const store = new DefaultRecordStore();
    const ne = new TestNodeEngine();
    const cs = new MapContainerService();
    cs.setRecordStore('test', 0, store);
    return new MapProxy<string, number>('test', store, ne, cs);
}

// ── tests ─────────────────────────────────────────────────────────────────

describe('MapProxy — base operations', () => {
    let map: IMap<string, number>;

    beforeEach(() => { map = makeProxy(); });

    test('getName returns map name', () => {
        expect(map.getName()).toBe('test');
    });

    test('put/get round-trip', async () => {
        expect(await map.put('a', 1)).toBeNull();
        expect(await map.get('a')).toBe(1);
    });

    test('put returns old value on update', async () => {
        await map.put('a', 1);
        expect(await map.put('a', 2)).toBe(1);
    });

    test('get returns null for missing key', async () => {
        expect(await map.get('missing')).toBeNull();
    });

    test('remove returns old value', async () => {
        await map.put('a', 1);
        expect(await map.remove('a')).toBe(1);
        expect(await map.get('a')).toBeNull();
    });

    test('containsKey', async () => {
        await map.put('a', 1);
        expect(map.containsKey('a')).toBe(true);
        expect(map.containsKey('b')).toBe(false);
    });

    test('size and isEmpty', async () => {
        expect(map.isEmpty()).toBe(true);
        await map.put('a', 1);
        expect(map.size()).toBe(1);
        expect(map.isEmpty()).toBe(false);
    });

    test('clear empties the map', async () => {
        await map.put('a', 1);
        await map.clear();
        expect(map.size()).toBe(0);
    });

    test('putIfAbsent', async () => {
        expect(await map.putIfAbsent('a', 1)).toBeNull();
        expect(await map.putIfAbsent('a', 99)).toBe(1);
        expect(await map.get('a')).toBe(1);
    });

    test('putAll and getAll', async () => {
        await map.putAll([['a', 1], ['b', 2]]);
        const result = await map.getAll(['a', 'b', 'c']);
        expect(result.get('a')).toBe(1);
        expect(result.get('b')).toBe(2);
        expect(result.get('c')).toBeNull();
    });
});

describe('MapProxy — new ops (set, delete, containsValue, replace)', () => {
    let map: IMap<string, number>;

    beforeEach(() => { map = makeProxy(); });

    test('set puts without returning old value', async () => {
        await map.set('a', 10);
        expect(await map.get('a')).toBe(10);
    });

    test('set overwrites existing entry', async () => {
        await map.put('a', 5);
        await map.set('a', 10);
        expect(await map.get('a')).toBe(10);
    });

    test('delete removes entry', async () => {
        await map.put('a', 1);
        await map.delete('a');
        expect(map.containsKey('a')).toBe(false);
    });

    test('delete on missing key is a no-op', async () => {
        await expect(map.delete('missing')).resolves.toBeUndefined();
    });

    test('containsValue returns true when value exists', async () => {
        await map.put('a', 42);
        expect(map.containsValue(42)).toBe(true);
    });

    test('containsValue returns false when value absent', async () => {
        await map.put('a', 1);
        expect(map.containsValue(99)).toBe(false);
    });

    test('replace returns previous value', async () => {
        await map.put('a', 1);
        expect(await map.replace('a', 2)).toBe(1);
        expect(await map.get('a')).toBe(2);
    });

    test('replace on missing key returns null and makes no change', async () => {
        expect(await map.replace('missing', 1)).toBeNull();
        expect(map.containsKey('missing')).toBe(false);
    });

    test('replaceIfSame replaces when old value matches', async () => {
        await map.put('a', 1);
        expect(await map.replaceIfSame('a', 1, 99)).toBe(true);
        expect(await map.get('a')).toBe(99);
    });

    test('replaceIfSame does not replace when old value does not match', async () => {
        await map.put('a', 1);
        expect(await map.replaceIfSame('a', 99, 5)).toBe(false);
        expect(await map.get('a')).toBe(1);
    });
});

describe('MapProxy — keySet / values / entrySet', () => {
    let map: IMap<string, number>;

    beforeEach(async () => {
        map = makeProxy();
        await map.put('a', 1);
        await map.put('b', 2);
        await map.put('c', 3);
    });

    test('keySet() returns all keys', () => {
        const ks = map.keySet();
        expect(ks.size).toBe(3);
        expect(ks.has('a')).toBe(true);
        expect(ks.has('b')).toBe(true);
        expect(ks.has('c')).toBe(true);
    });

    test('values() returns all values', () => {
        const vs = map.values();
        expect(vs.length).toBe(3);
        expect(vs).toContain(1);
        expect(vs).toContain(2);
        expect(vs).toContain(3);
    });

    test('entrySet() returns all entries', () => {
        const es = map.entrySet();
        expect(es.size).toBe(3);
        expect(es.get('a')).toBe(1);
        expect(es.get('b')).toBe(2);
        expect(es.get('c')).toBe(3);
    });

    test('keySet(predicate) filters keys', () => {
        const ks = map.keySet(valuePredicate<string, number>(2));
        expect(ks.size).toBe(1);
        expect(ks.has('b')).toBe(true);
    });

    test('values(predicate) filters values', () => {
        const vs = map.values(keyPredicate<string, number>('a'));
        expect(vs).toEqual([1]);
    });

    test('entrySet(predicate) filters entries', () => {
        const es = map.entrySet(valuePredicate<string, number>(3));
        expect(es.size).toBe(1);
        expect(es.get('c')).toBe(3);
    });

    test('keySet(predicate) returns empty set when no match', () => {
        const ks = map.keySet(valuePredicate<string, number>(999));
        expect(ks.size).toBe(0);
    });
});

describe('MapProxy — aggregation', () => {
    let map: IMap<string, number>;

    beforeEach(async () => {
        map = makeProxy();
        await map.put('a', 10);
        await map.put('b', 20);
        await map.put('c', 30);
    });

    test('aggregate sums all values', () => {
        const total = map.aggregate(new SumAggregator());
        expect(total).toBe(60);
    });

    test('aggregate with predicate sums filtered values', () => {
        const total = map.aggregate(new SumAggregator(), valuePredicate<string, number>(20));
        expect(total).toBe(20);
    });

    test('aggregate on empty map returns identity', async () => {
        await map.clear();
        expect(map.aggregate(new SumAggregator())).toBe(0);
    });
});

describe('MapProxy — entry listeners', () => {
    let map: IMap<string, number>;
    const events: string[] = [];

    beforeEach(() => {
        map = makeProxy();
        events.length = 0;
    });

    test('addEntryListener fires entryAdded on first put', async () => {
        const listener: EntryListener<string, number> = {
            entryAdded(e) { events.push(`added:${e.getKey()}=${e.getValue()}`); },
        };
        map.addEntryListener(listener, true);
        await map.put('x', 1);
        expect(events).toEqual(['added:x=1']);
    });

    test('addEntryListener fires entryUpdated on second put', async () => {
        const listener: EntryListener<string, number> = {
            entryUpdated(e) { events.push(`updated:${e.getKey()}=${e.getValue()}`); },
        };
        map.addEntryListener(listener, true);
        await map.put('x', 1);
        await map.put('x', 2);
        expect(events).toEqual(['updated:x=2']);
    });

    test('addEntryListener fires entryRemoved on remove', async () => {
        const listener: EntryListener<string, number> = {
            entryRemoved(e) { events.push(`removed:${e.getKey()}`); },
        };
        await map.put('x', 1);
        map.addEntryListener(listener, false);
        await map.remove('x');
        expect(events).toEqual(['removed:x']);
    });

    test('addEntryListener fires mapCleared on clear', async () => {
        const listener: EntryListener<string, number> = {
            mapCleared() { events.push('cleared'); },
        };
        await map.put('x', 1);
        map.addEntryListener(listener);
        await map.clear();
        expect(events).toEqual(['cleared']);
    });

    test('removeEntryListener stops listener from receiving events', async () => {
        const listener: EntryListener<string, number> = {
            entryAdded(_e) { events.push('added'); },
        };
        const id = map.addEntryListener(listener, true);
        const removed = map.removeEntryListener(id);
        expect(removed).toBe(true);
        await map.put('x', 1);
        expect(events).toEqual([]);
    });

    test('removeEntryListener returns false for unknown id', () => {
        expect(map.removeEntryListener('nonexistent')).toBe(false);
    });

    test('includeValue=false sends null value in event', async () => {
        const listener: EntryListener<string, number> = {
            entryAdded(e) { events.push(String(e.getValue())); },
        };
        map.addEntryListener(listener, false);
        await map.put('x', 42);
        expect(events).toEqual(['null']);
    });

    test('multiple listeners are all notified', async () => {
        map.addEntryListener({ entryAdded(_e) { events.push('L1'); } }, false);
        map.addEntryListener({ entryAdded(_e) { events.push('L2'); } }, false);
        await map.put('x', 1);
        expect(events).toContain('L1');
        expect(events).toContain('L2');
    });
});

describe('MapProxy — locking', () => {
    let map: IMap<string, number>;

    beforeEach(() => { map = makeProxy(); });

    test('key is not locked by default', () => {
        expect(map.isLocked('k')).toBe(false);
    });

    test('lock marks key as locked', () => {
        map.lock('k');
        expect(map.isLocked('k')).toBe(true);
    });

    test('unlock releases the lock', () => {
        map.lock('k');
        map.unlock('k');
        expect(map.isLocked('k')).toBe(false);
    });

    test('tryLock succeeds on unlocked key', () => {
        expect(map.tryLock('k')).toBe(true);
        expect(map.isLocked('k')).toBe(true);
    });

    test('tryLock fails on already-locked key', () => {
        map.lock('k');
        expect(map.tryLock('k')).toBe(false);
    });

    test('unlock on unlocked key is a no-op', () => {
        expect(() => map.unlock('k')).not.toThrow();
    });
});

describe('MapProxy — async operations', () => {
    let map: IMap<string, number>;

    beforeEach(() => { map = makeProxy(); });

    test('putAsync resolves to old value or null', async () => {
        expect(await map.putAsync('a', 1)).toBeNull();
        expect(await map.putAsync('a', 2)).toBe(1);
    });

    test('getAsync resolves to value or null', async () => {
        expect(await map.getAsync('a')).toBeNull();
        await map.put('a', 5);
        expect(await map.getAsync('a')).toBe(5);
    });

    test('removeAsync resolves to old value or null', async () => {
        await map.put('a', 7);
        expect(await map.removeAsync('a')).toBe(7);
        expect(await map.removeAsync('a')).toBeNull();
    });
});
