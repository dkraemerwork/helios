/**
 * Block 7.4a — Production map indexing tests.
 *
 * Tests:
 * 1. IndexRegistryImpl — add/remove/match indexes, attribute canonicalization
 * 2. IndexConfig model — construction, validation, equality
 * 3. MapConfig index support — addIndexConfig, getIndexConfigs
 * 4. IMap.addIndex() — runtime index creation on populated maps
 * 5. MapQueryEngine indexed execution — uses index when available, scan fallback
 * 6. Index maintenance across mutations — put, remove, clear, putAll
 * 7. Predicate-specific index usage — equal, range, prefix, in, between
 * 8. Config-driven index bootstrap
 * 9. NearCachedIMapWrapper addIndex delegation
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import { IndexRegistryImpl } from '@zenystx/helios-core/query/impl/IndexRegistryImpl';
import { IndexType } from '@zenystx/helios-core/query/impl/Index';
import { IndexConfig } from '@zenystx/helios-core/config/IndexConfig';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import { MapProxy } from '@zenystx/helios-core/map/impl/MapProxy';
import { DefaultRecordStore } from '@zenystx/helios-core/map/impl/recordstore/DefaultRecordStore';
import { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService';
import { TestNodeEngine } from '@zenystx/helios-core/test-support/TestNodeEngine';
import { EqualPredicate } from '@zenystx/helios-core/query/impl/predicates/EqualPredicate';
import { GreaterLessPredicate } from '@zenystx/helios-core/query/impl/predicates/GreaterLessPredicate';
import { BetweenPredicate } from '@zenystx/helios-core/query/impl/predicates/BetweenPredicate';
import { LikePredicate } from '@zenystx/helios-core/query/impl/predicates/LikePredicate';
import { InPredicate } from '@zenystx/helios-core/query/impl/predicates/InPredicate';
import { IndexMatchHint } from '@zenystx/helios-core/query/impl/QueryContext';
import type { IMap } from '@zenystx/helios-core/map/IMap';

// ── IndexRegistryImpl Tests ──────────────────────────────────────────────────

describe('IndexRegistryImpl', () => {
    let registry: IndexRegistryImpl;

    beforeEach(() => {
        registry = new IndexRegistryImpl();
    });

    test('addIndex creates a HASH index for an attribute', () => {
        const config = new IndexConfig(IndexType.HASH, ['age']);
        const index = registry.addIndex(config);
        expect(index).toBeDefined();
        expect(index.getConfig().getType()).toBe(IndexType.HASH);
    });

    test('addIndex creates a SORTED index for an attribute', () => {
        const config = new IndexConfig(IndexType.SORTED, ['name']);
        const index = registry.addIndex(config);
        expect(index).toBeDefined();
        expect(index.getConfig().getType()).toBe(IndexType.SORTED);
    });

    test('addIndex with same attribute returns existing index', () => {
        const config1 = new IndexConfig(IndexType.HASH, ['age']);
        const config2 = new IndexConfig(IndexType.HASH, ['age']);
        const idx1 = registry.addIndex(config1);
        const idx2 = registry.addIndex(config2);
        expect(idx1).toBe(idx2);
    });

    test('matchIndex returns HASH index for PREFER_UNORDERED', () => {
        const config = new IndexConfig(IndexType.HASH, ['age']);
        registry.addIndex(config);
        const matched = registry.matchIndex('age', IndexMatchHint.PREFER_UNORDERED);
        expect(matched).not.toBeNull();
        expect(matched!.getConfig().getType()).toBe(IndexType.HASH);
    });

    test('matchIndex returns SORTED index for PREFER_ORDERED', () => {
        const config = new IndexConfig(IndexType.SORTED, ['score']);
        registry.addIndex(config);
        const matched = registry.matchIndex('score', IndexMatchHint.PREFER_ORDERED);
        expect(matched).not.toBeNull();
        expect(matched!.getConfig().getType()).toBe(IndexType.SORTED);
    });

    test('matchIndex returns null for non-indexed attribute', () => {
        expect(registry.matchIndex('missing', IndexMatchHint.PREFER_UNORDERED)).toBeNull();
    });

    test('matchIndex canonicalizes this.attr to attr', () => {
        const config = new IndexConfig(IndexType.HASH, ['name']);
        registry.addIndex(config);
        const matched = registry.matchIndex('this.name', IndexMatchHint.PREFER_UNORDERED);
        expect(matched).not.toBeNull();
    });

    test('matchIndex prefers SORTED when both exist and PREFER_ORDERED', () => {
        registry.addIndex(new IndexConfig(IndexType.HASH, ['x']));
        registry.addIndex(new IndexConfig(IndexType.SORTED, ['x']));
        const matched = registry.matchIndex('x', IndexMatchHint.PREFER_ORDERED);
        expect(matched!.getConfig().getType()).toBe(IndexType.SORTED);
    });

    test('matchIndex prefers HASH when both exist and PREFER_UNORDERED', () => {
        registry.addIndex(new IndexConfig(IndexType.HASH, ['x']));
        registry.addIndex(new IndexConfig(IndexType.SORTED, ['x']));
        const matched = registry.matchIndex('x', IndexMatchHint.PREFER_UNORDERED);
        expect(matched!.getConfig().getType()).toBe(IndexType.HASH);
    });

    test('getIndexes returns all registered indexes', () => {
        registry.addIndex(new IndexConfig(IndexType.HASH, ['a']));
        registry.addIndex(new IndexConfig(IndexType.SORTED, ['b']));
        expect(registry.getIndexes().length).toBe(2);
    });

    test('removeIndex removes an index by attribute', () => {
        registry.addIndex(new IndexConfig(IndexType.HASH, ['x']));
        registry.removeIndex('x');
        expect(registry.matchIndex('x', IndexMatchHint.PREFER_UNORDERED)).toBeNull();
    });

    test('clearIndexes removes all indexes', () => {
        registry.addIndex(new IndexConfig(IndexType.HASH, ['a']));
        registry.addIndex(new IndexConfig(IndexType.SORTED, ['b']));
        registry.clearIndexes();
        expect(registry.getIndexes().length).toBe(0);
    });
});

// ── IndexConfig Tests ────────────────────────────────────────────────────────

describe('IndexConfig', () => {
    test('constructs with type and attributes', () => {
        const cfg = new IndexConfig(IndexType.HASH, ['age']);
        expect(cfg.getType()).toBe(IndexType.HASH);
        expect(cfg.getAttributes()).toEqual(['age']);
    });

    test('defaults to SORTED type when not specified', () => {
        const cfg = new IndexConfig(undefined, ['name']);
        expect(cfg.getType()).toBe(IndexType.SORTED);
    });

    test('setName and getName', () => {
        const cfg = new IndexConfig(IndexType.HASH, ['age']);
        cfg.setName('idx_age');
        expect(cfg.getName()).toBe('idx_age');
    });

    test('validates empty attributes', () => {
        expect(() => new IndexConfig(IndexType.HASH, [])).toThrow();
    });

    test('addAttribute appends to attribute list', () => {
        const cfg = new IndexConfig(IndexType.HASH, ['a']);
        cfg.addAttribute('b');
        expect(cfg.getAttributes()).toEqual(['a', 'b']);
    });
});

// ── MapConfig index support ──────────────────────────────────────────────────

describe('MapConfig index support', () => {
    test('addIndexConfig stores index configurations', () => {
        const mc = new MapConfig('test');
        mc.addIndexConfig(new IndexConfig(IndexType.HASH, ['age']));
        mc.addIndexConfig(new IndexConfig(IndexType.SORTED, ['name']));
        expect(mc.getIndexConfigs().length).toBe(2);
    });

    test('getIndexConfigs returns empty array by default', () => {
        const mc = new MapConfig('test');
        expect(mc.getIndexConfigs()).toEqual([]);
    });

    test('setIndexConfigs replaces all index configurations', () => {
        const mc = new MapConfig('test');
        mc.addIndexConfig(new IndexConfig(IndexType.HASH, ['age']));
        mc.setIndexConfigs([new IndexConfig(IndexType.SORTED, ['name'])]);
        expect(mc.getIndexConfigs().length).toBe(1);
        expect(mc.getIndexConfigs()[0]!.getType()).toBe(IndexType.SORTED);
    });
});

// ── IMap.addIndex() Tests ────────────────────────────────────────────────────

describe('IMap.addIndex()', () => {
    let map: IMap<string, { name: string; age: number; score: number }>;
    let containerService: MapContainerService;
    let nodeEngine: TestNodeEngine;

    beforeEach(async () => {
        const store = new DefaultRecordStore();
        nodeEngine = new TestNodeEngine();
        containerService = new MapContainerService();
        containerService.setRecordStore('test', 0, store);
        nodeEngine.registerService('hz:impl:mapService', containerService);
        map = new MapProxy<string, { name: string; age: number; score: number }>(
            'test', store, nodeEngine, containerService,
        );
    });

    test('addIndex on empty map succeeds', () => {
        map.addIndex(new IndexConfig(IndexType.HASH, ['age']));
        // No error thrown
    });

    test('addIndex on populated map indexes existing entries', async () => {
        await map.put('alice', { name: 'Alice', age: 30, score: 95 });
        await map.put('bob', { name: 'Bob', age: 25, score: 80 });
        map.addIndex(new IndexConfig(IndexType.HASH, ['age']));
        // After adding index, equality queries should use the index
        const result = map.values(new EqualPredicate('age', 30));
        expect(result.length).toBe(1);
        expect(result[0]!.name).toBe('Alice');
    });

    test('addIndex same attribute twice is idempotent', () => {
        map.addIndex(new IndexConfig(IndexType.HASH, ['age']));
        map.addIndex(new IndexConfig(IndexType.HASH, ['age']));
        // No error, index is reused
    });

    test('addIndex with SORTED type enables range queries', async () => {
        await map.put('alice', { name: 'Alice', age: 30, score: 95 });
        await map.put('bob', { name: 'Bob', age: 25, score: 80 });
        await map.put('charlie', { name: 'Charlie', age: 35, score: 70 });
        map.addIndex(new IndexConfig(IndexType.SORTED, ['age']));
        const result = map.values(new GreaterLessPredicate('age', 28, false, false));
        expect(result.length).toBe(2); // Alice(30) and Charlie(35), age > 28
    });
});

// ── Indexed query execution ──────────────────────────────────────────────────

describe('Indexed query execution', () => {
    let map: IMap<string, { name: string; age: number; city: string }>;

    beforeEach(async () => {
        const store = new DefaultRecordStore();
        const ne = new TestNodeEngine();
        const cs = new MapContainerService();
        cs.setRecordStore('test', 0, store);
        ne.registerService('hz:impl:mapService', cs);
        map = new MapProxy<string, { name: string; age: number; city: string }>(
            'test', store, ne, cs,
        );
        await map.put('alice', { name: 'Alice', age: 30, city: 'NYC' });
        await map.put('bob', { name: 'Bob', age: 25, city: 'LA' });
        await map.put('charlie', { name: 'Charlie', age: 35, city: 'NYC' });
        await map.put('diana', { name: 'Diana', age: 28, city: 'SF' });
    });

    test('EqualPredicate uses HASH index', () => {
        map.addIndex(new IndexConfig(IndexType.HASH, ['city']));
        const result = map.values(new EqualPredicate('city', 'NYC'));
        expect(result.length).toBe(2);
        const names = result.map(v => v.name).sort();
        expect(names).toEqual(['Alice', 'Charlie']);
    });

    test('EqualPredicate falls back to scan without index', () => {
        // No index added
        const result = map.values(new EqualPredicate('city', 'NYC'));
        expect(result.length).toBe(2); // still works, just scans
    });

    test('BetweenPredicate uses SORTED index', () => {
        map.addIndex(new IndexConfig(IndexType.SORTED, ['age']));
        const result = map.values(new BetweenPredicate('age', 26, 31));
        expect(result.length).toBe(2); // Alice(30), Diana(28)
        const names = result.map(v => v.name).sort();
        expect(names).toEqual(['Alice', 'Diana']);
    });

    test('GreaterLessPredicate with SORTED index (greater than)', () => {
        map.addIndex(new IndexConfig(IndexType.SORTED, ['age']));
        const result = map.values(new GreaterLessPredicate('age', 30, false, false));
        expect(result.length).toBe(1); // Charlie(35)
        expect(result[0]!.name).toBe('Charlie');
    });

    test('GreaterLessPredicate with SORTED index (less than or equal)', () => {
        map.addIndex(new IndexConfig(IndexType.SORTED, ['age']));
        const result = map.values(new GreaterLessPredicate('age', 28, true, true));
        expect(result.length).toBe(2); // Bob(25), Diana(28)
    });

    test('InPredicate uses HASH index', () => {
        map.addIndex(new IndexConfig(IndexType.HASH, ['city']));
        const result = map.values(new InPredicate('city', 'NYC', 'SF'));
        expect(result.length).toBe(3); // Alice, Charlie, Diana
    });

    test('LikePredicate uses SORTED index for prefix', () => {
        map.addIndex(new IndexConfig(IndexType.SORTED, ['name']));
        const result = map.values(new LikePredicate('name', 'Al%'));
        expect(result.length).toBe(1);
        expect(result[0]!.name).toBe('Alice');
    });

    test('keySet with predicate uses index', () => {
        map.addIndex(new IndexConfig(IndexType.HASH, ['age']));
        const keys = map.keySet(new EqualPredicate('age', 25));
        expect(keys.size).toBe(1);
        expect(keys.has('bob')).toBe(true);
    });

    test('entrySet with predicate uses index', () => {
        map.addIndex(new IndexConfig(IndexType.HASH, ['city']));
        const entries = map.entrySet(new EqualPredicate('city', 'SF'));
        expect(entries.size).toBe(1);
        expect(entries.has('diana')).toBe(true);
    });
});

// ── Index maintenance across mutations ───────────────────────────────────────

describe('Index maintenance', () => {
    let map: IMap<string, { name: string; age: number }>;

    beforeEach(async () => {
        const store = new DefaultRecordStore();
        const ne = new TestNodeEngine();
        const cs = new MapContainerService();
        cs.setRecordStore('test', 0, store);
        ne.registerService('hz:impl:mapService', cs);
        map = new MapProxy<string, { name: string; age: number }>(
            'test', store, ne, cs,
        );
        map.addIndex(new IndexConfig(IndexType.HASH, ['age']));
        await map.put('alice', { name: 'Alice', age: 30 });
        await map.put('bob', { name: 'Bob', age: 25 });
    });

    test('put updates index for new entry', async () => {
        await map.put('charlie', { name: 'Charlie', age: 30 });
        const result = map.values(new EqualPredicate('age', 30));
        expect(result.length).toBe(2);
    });

    test('put updates index when value changes', async () => {
        await map.put('alice', { name: 'Alice', age: 40 });
        const result30 = map.values(new EqualPredicate('age', 30));
        expect(result30.length).toBe(0);
        const result40 = map.values(new EqualPredicate('age', 40));
        expect(result40.length).toBe(1);
    });

    test('remove removes entry from index', async () => {
        await map.remove('alice');
        const result = map.values(new EqualPredicate('age', 30));
        expect(result.length).toBe(0);
    });

    test('delete removes entry from index', async () => {
        await map.delete('bob');
        const result = map.values(new EqualPredicate('age', 25));
        expect(result.length).toBe(0);
    });

    test('clear removes all entries from index', async () => {
        await map.clear();
        const result = map.values(new EqualPredicate('age', 30));
        expect(result.length).toBe(0);
    });

    test('set updates index', async () => {
        await map.set('alice', { name: 'Alice', age: 99 });
        const result30 = map.values(new EqualPredicate('age', 30));
        expect(result30.length).toBe(0);
        const result99 = map.values(new EqualPredicate('age', 99));
        expect(result99.length).toBe(1);
    });

    test('putIfAbsent does not change index if key exists', async () => {
        await map.putIfAbsent('alice', { name: 'Alice', age: 99 });
        const result30 = map.values(new EqualPredicate('age', 30));
        expect(result30.length).toBe(1); // unchanged
    });

    test('putAll indexes all new entries', async () => {
        await map.putAll([
            ['charlie', { name: 'Charlie', age: 25 }],
            ['diana', { name: 'Diana', age: 35 }],
        ]);
        const result25 = map.values(new EqualPredicate('age', 25));
        expect(result25.length).toBe(2); // bob + charlie
    });

    test('replace updates index', async () => {
        await map.replace('alice', { name: 'Alice', age: 50 });
        const result30 = map.values(new EqualPredicate('age', 30));
        expect(result30.length).toBe(0);
        const result50 = map.values(new EqualPredicate('age', 50));
        expect(result50.length).toBe(1);
    });
});

// ── Config-driven index bootstrap ────────────────────────────────────────────

describe('Config-driven index bootstrap', () => {
    test('MapProxy bootstraps indexes from MapConfig', async () => {
        const store = new DefaultRecordStore();
        const ne = new TestNodeEngine();
        const cs = new MapContainerService();
        cs.setRecordStore('test', 0, store);
        ne.registerService('hz:impl:mapService', cs);

        const mapConfig = new MapConfig('test');
        mapConfig.addIndexConfig(new IndexConfig(IndexType.HASH, ['age']));

        const map = new MapProxy<string, { age: number }>(
            'test', store, ne, cs, undefined, mapConfig,
        );

        await map.put('a', { age: 10 });
        await map.put('b', { age: 20 });

        const result = map.values(new EqualPredicate('age', 10));
        expect(result.length).toBe(1);
    });
});

// ── Multiple indexes on same map ─────────────────────────────────────────────

describe('Multiple indexes', () => {
    test('map supports multiple indexes on different attributes', async () => {
        const store = new DefaultRecordStore();
        const ne = new TestNodeEngine();
        const cs = new MapContainerService();
        cs.setRecordStore('test', 0, store);
        ne.registerService('hz:impl:mapService', cs);
        const map = new MapProxy<string, { name: string; age: number }>(
            'test', store, ne, cs,
        );

        map.addIndex(new IndexConfig(IndexType.HASH, ['name']));
        map.addIndex(new IndexConfig(IndexType.SORTED, ['age']));

        await map.put('alice', { name: 'Alice', age: 30 });
        await map.put('bob', { name: 'Bob', age: 25 });

        const byName = map.values(new EqualPredicate('name', 'Alice'));
        expect(byName.length).toBe(1);

        const byAge = map.values(new GreaterLessPredicate('age', 28, false, true));
        expect(byAge.length).toBe(1);
    });
});

// ── Nested attribute indexing ────────────────────────────────────────────────

describe('Nested attribute indexing', () => {
    test('index on nested property works', async () => {
        const store = new DefaultRecordStore();
        const ne = new TestNodeEngine();
        const cs = new MapContainerService();
        cs.setRecordStore('test', 0, store);
        ne.registerService('hz:impl:mapService', cs);
        const map = new MapProxy<string, { address: { city: string } }>(
            'test', store, ne, cs,
        );

        map.addIndex(new IndexConfig(IndexType.HASH, ['address.city']));

        await map.put('alice', { address: { city: 'NYC' } });
        await map.put('bob', { address: { city: 'LA' } });

        const result = map.values(new EqualPredicate('address.city', 'NYC'));
        expect(result.length).toBe(1);
    });
});
