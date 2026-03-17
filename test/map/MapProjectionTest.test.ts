/**
 * Tests for IMap projection methods: project() and project(predicate).
 *
 * Covers:
 *  - Projections.identity()         — returns the QueryableEntry unchanged
 *  - Projections.singleAttribute()  — extracts one attribute path from the entry
 *  - Projections.multiAttribute()   — extracts multiple attribute paths from the entry
 *  - project() with a predicate (filter + transform)
 *  - Edge cases: empty map, validation errors
 *
 * Note: IMap.project() passes QueryableEntry<K,V> to the projection (matching
 * the Hazelcast Java semantics where Projection<Map.Entry<K,V>, R> is used).
 */
import type { IMap } from '@zenystx/helios-core/map/IMap';
import { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService';
import { MapProxy } from '@zenystx/helios-core/map/impl/MapProxy';
import { DefaultRecordStore } from '@zenystx/helios-core/map/impl/recordstore/DefaultRecordStore';
import type { Projection } from '@zenystx/helios-core/projection/Projection';
import { Projections } from '@zenystx/helios-core/projection/Projections';
import type { QueryableEntry } from '@zenystx/helios-core/query/impl/QueryableEntry';
import type { Predicate } from '@zenystx/helios-core/query/Predicate';
import { TestNodeEngine } from '@zenystx/helios-core/test-support/TestNodeEngine';
import { beforeEach, describe, expect, test } from 'bun:test';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface Person {
    name: string;
    age: number;
    address: { city: string };
}

type PersonEntry = QueryableEntry<string, Person>;

function makePersonMap(): IMap<string, Person> {
    const store = new DefaultRecordStore();
    const ne = new TestNodeEngine();
    const cs = new MapContainerService();
    cs.setRecordStore('people', 0, store);
    ne.registerService('hz:impl:mapService', cs);
    return new MapProxy<string, Person>('people', store, ne, cs);
}

function agePredicate(minAge: number): Predicate<string, Person> {
    return {
        apply(entry: PersonEntry): boolean {
            return entry.getValue().age >= minAge;
        },
    };
}

/** Custom projection that extracts the key of each entry. */
function keyProjection(): Projection<PersonEntry, string> {
    return { transform: (entry) => entry.getKey() };
}

/** Custom projection that extracts the value of each entry. */
function valueProjection(): Projection<PersonEntry, Person> {
    return { transform: (entry) => entry.getValue() };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MapProxy — project()', () => {
    let map: IMap<string, Person>;

    beforeEach(async () => {
        map = makePersonMap();
        await map.put('alice', { name: 'Alice', age: 30, address: { city: 'Amsterdam' } });
        await map.put('bob', { name: 'Bob', age: 25, address: { city: 'Berlin' } });
        await map.put('charlie', { name: 'Charlie', age: 35, address: { city: 'Chicago' } });
    });

    test('custom value projection returns all values', () => {
        const results = map.project(valueProjection());
        expect(results).toHaveLength(3);
        const names = results.map((p) => p.name).sort();
        expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    test('custom key projection returns all keys', () => {
        const results = map.project(keyProjection());
        expect(results).toHaveLength(3);
        expect(results.sort()).toEqual(['alice', 'bob', 'charlie']);
    });

    test('singleAttribute projection extracts one attribute', () => {
        const results = map.project(Projections.singleAttribute<PersonEntry>('name'));
        expect(results).toHaveLength(3);
        expect(results.sort()).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    test('singleAttribute projection extracts numeric attribute', () => {
        const results = map.project(Projections.singleAttribute<PersonEntry, number>('age'));
        expect(results).toHaveLength(3);
        expect(results.sort((a, b) => a - b)).toEqual([25, 30, 35]);
    });

    test('singleAttribute projection extracts nested attribute path', () => {
        const results = map.project(Projections.singleAttribute<PersonEntry>('address.city'));
        expect(results).toHaveLength(3);
        expect(results.sort()).toEqual(['Amsterdam', 'Berlin', 'Chicago']);
    });

    test('multiAttribute projection extracts multiple attributes as arrays', () => {
        const results = map.project(Projections.multiAttribute<PersonEntry>('name', 'age'));
        expect(results).toHaveLength(3);
        const sorted = results.sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
        expect(sorted[0]).toEqual(['Alice', 30]);
        expect(sorted[1]).toEqual(['Bob', 25]);
        expect(sorted[2]).toEqual(['Charlie', 35]);
    });

    test('project on empty map returns empty array', async () => {
        await map.clear();
        const results = map.project(valueProjection());
        expect(results).toEqual([]);
    });
});

describe('MapProxy — project() with predicate', () => {
    let map: IMap<string, Person>;

    beforeEach(async () => {
        map = makePersonMap();
        await map.put('alice', { name: 'Alice', age: 30, address: { city: 'Amsterdam' } });
        await map.put('bob', { name: 'Bob', age: 25, address: { city: 'Berlin' } });
        await map.put('charlie', { name: 'Charlie', age: 35, address: { city: 'Chicago' } });
    });

    test('value projection with predicate filters entries', () => {
        const results = map.project(valueProjection(), agePredicate(30));
        expect(results).toHaveLength(2);
        const names = results.map((p) => p.name).sort();
        expect(names).toEqual(['Alice', 'Charlie']);
    });

    test('singleAttribute projection with predicate extracts attributes of matching entries', () => {
        const results = map.project(Projections.singleAttribute<PersonEntry>('name'), agePredicate(30));
        expect(results.sort()).toEqual(['Alice', 'Charlie']);
    });

    test('predicate that matches no entries returns empty array', () => {
        const results = map.project(valueProjection(), agePredicate(99));
        expect(results).toEqual([]);
    });

    test('predicate that matches all entries returns all projections', () => {
        const results = map.project(Projections.singleAttribute<PersonEntry, number>('age'), agePredicate(0));
        expect(results).toHaveLength(3);
    });
});

describe('Projections factory', () => {
    test('identity transform returns the input unchanged', () => {
        const proj = Projections.identity<string>();
        expect(proj.transform('hello')).toBe('hello');
    });

    test('singleAttribute rejects empty attributePath', () => {
        expect(() => Projections.singleAttribute('')).toThrow();
    });

    test('singleAttribute rejects [any] operator', () => {
        expect(() => Projections.singleAttribute('items[any].name')).toThrow();
    });

    test('multiAttribute rejects empty attributePaths list', () => {
        expect(() => Projections.multiAttribute()).toThrow();
    });

    test('multiAttribute rejects empty attributePath in list', () => {
        expect(() => Projections.multiAttribute('name', '')).toThrow();
    });
});
