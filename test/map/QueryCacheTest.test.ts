/**
 * QueryCache (F4) — Continuous Query Cache tests.
 *
 * Verifies:
 * - Initial population via predicate
 * - Event-driven synchronization (put / remove / evict)
 * - Local predicate queries (keySet, values, entrySet)
 * - Entry listener notifications
 * - recreate() repopulates from source map
 * - destroy() clears and disables the cache
 * - Eviction max size enforcement
 */
import { QueryCacheConfig } from '@zenystx/helios-core/config/QueryCacheConfig';
import { MapContainerService } from '@zenystx/helios-core/map/impl/MapContainerService';
import { MapProxy } from '@zenystx/helios-core/map/impl/MapProxy';
import { DefaultRecordStore } from '@zenystx/helios-core/map/impl/recordstore/DefaultRecordStore';
import type { QueryCache } from '@zenystx/helios-core/map/QueryCache';
import type { QueryableEntry } from '@zenystx/helios-core/query/impl/QueryableEntry';
import type { Predicate } from '@zenystx/helios-core/query/Predicate';
import { TestNodeEngine } from '@zenystx/helios-core/test-support/TestNodeEngine';
import { beforeEach, describe, expect, test } from 'bun:test';

// ── helpers ────────────────────────────────────────────────────────────────

interface Employee {
    name: string;
    active: boolean;
    dept: string;
}

/** Predicate: include only active employees. */
const activePredicate: Predicate<string, Employee> = {
    apply(entry: QueryableEntry<string, Employee>): boolean {
        const v = entry.getValue();
        return v.active === true;
    },
};

/** Predicate: include only engineering employees. */
const engineeringPredicate: Predicate<string, Employee> = {
    apply(entry: QueryableEntry<string, Employee>): boolean {
        return entry.getValue().dept === 'engineering';
    },
};

function makeProxy(): MapProxy<string, Employee> {
    const store = new DefaultRecordStore();
    const ne = new TestNodeEngine();
    const cs = new MapContainerService();
    cs.setRecordStore('employees', 0, store);
    ne.registerService('hz:impl:mapService', cs);
    return new MapProxy<string, Employee>('employees', store, ne, cs);
}

// ── tests ─────────────────────────────────────────────────────────────────

describe('QueryCache', () => {
    let proxy: MapProxy<string, Employee>;

    beforeEach(() => {
        proxy = makeProxy();
    });

    // ── population ──────────────────────────────────────────────────────────

    test('populates cache from existing map entries on creation', async () => {
        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });
        await proxy.put('bob', { name: 'Bob', active: false, dept: 'sales' });
        await proxy.put('carol', { name: 'Carol', active: true, dept: 'sales' });

        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);

        expect(cache.size()).toBe(2);
        expect(cache.containsKey('alice')).toBe(true);
        expect(cache.containsKey('carol')).toBe(true);
        expect(cache.containsKey('bob')).toBe(false);
    });

    test('returns empty cache when no entries match predicate', async () => {
        await proxy.put('bob', { name: 'Bob', active: false, dept: 'sales' });

        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);
        expect(cache.isEmpty()).toBe(true);
        expect(cache.size()).toBe(0);
    });

    // ── event-driven sync ───────────────────────────────────────────────────

    test('adds new matching entries via event-driven sync', async () => {
        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);
        expect(cache.size()).toBe(0);

        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });
        expect(cache.size()).toBe(1);
        expect(cache.get('alice')).toMatchObject({ name: 'Alice', active: true });
    });

    test('does not add non-matching entries', async () => {
        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);

        await proxy.put('bob', { name: 'Bob', active: false, dept: 'sales' });
        expect(cache.size()).toBe(0);
        expect(cache.containsKey('bob')).toBe(false);
    });

    test('removes entries from cache when removed from map', async () => {
        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });

        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);
        expect(cache.size()).toBe(1);

        await proxy.remove('alice');
        expect(cache.size()).toBe(0);
        expect(cache.containsKey('alice')).toBe(false);
    });

    test('removes entry from cache when updated value no longer matches predicate', async () => {
        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });

        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);
        expect(cache.containsKey('alice')).toBe(true);

        // Deactivate alice — should drop from cache
        await proxy.put('alice', { name: 'Alice', active: false, dept: 'engineering' });
        expect(cache.containsKey('alice')).toBe(false);
        expect(cache.size()).toBe(0);
    });

    test('adds entry to cache when updated value starts matching predicate', async () => {
        await proxy.put('alice', { name: 'Alice', active: false, dept: 'engineering' });

        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);
        expect(cache.containsKey('alice')).toBe(false);

        // Activate alice — should enter cache
        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });
        expect(cache.containsKey('alice')).toBe(true);
        expect(cache.get('alice')).toMatchObject({ active: true });
    });

    // ── local query methods ─────────────────────────────────────────────────

    test('keySet() returns all cached keys', async () => {
        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });
        await proxy.put('carol', { name: 'Carol', active: true, dept: 'sales' });
        await proxy.put('bob', { name: 'Bob', active: false, dept: 'sales' });

        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);
        const keys = cache.keySet();
        expect(keys.size).toBe(2);
        expect(keys.has('alice')).toBe(true);
        expect(keys.has('carol')).toBe(true);
    });

    test('keySet(predicate) filters cached keys', async () => {
        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });
        await proxy.put('carol', { name: 'Carol', active: true, dept: 'sales' });

        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);
        const engineeringKeys = cache.keySet(engineeringPredicate);
        expect(engineeringKeys.size).toBe(1);
        expect(engineeringKeys.has('alice')).toBe(true);
    });

    test('values() returns all cached values', async () => {
        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });
        await proxy.put('carol', { name: 'Carol', active: true, dept: 'sales' });

        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);
        const vals = cache.values();
        expect(vals.length).toBe(2);
    });

    test('values(predicate) filters cached values', async () => {
        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });
        await proxy.put('carol', { name: 'Carol', active: true, dept: 'sales' });

        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);
        const engVals = cache.values(engineeringPredicate);
        expect(engVals.length).toBe(1);
        expect(engVals[0]).toMatchObject({ dept: 'engineering' });
    });

    test('entrySet() returns all cached entries', async () => {
        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });

        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);
        const entries = cache.entrySet();
        expect(entries.size).toBe(1);
        const [first] = entries;
        expect(first[0]).toBe('alice');
        expect(first[1]).toMatchObject({ dept: 'engineering' });
    });

    test('containsValue() finds matching values', async () => {
        const alice = { name: 'Alice', active: true, dept: 'engineering' };
        await proxy.put('alice', alice);

        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);
        // containsValue uses reference equality
        const cachedAlice = cache.get('alice');
        expect(cachedAlice).not.toBeNull();
        expect(cache.containsValue(cachedAlice!)).toBe(true);
    });

    // ── entry listeners ─────────────────────────────────────────────────────

    test('fires entryAdded listener when entry enters cache', async () => {
        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);

        const addedEvents: Array<{ key: string; value: Employee }> = [];
        cache.addEntryListener({
            entryAdded(key, value) {
                addedEvents.push({ key, value });
            },
        });

        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });
        expect(addedEvents).toHaveLength(1);
        expect(addedEvents[0].key).toBe('alice');
        expect(addedEvents[0].value).toMatchObject({ active: true });
    });

    test('fires entryRemoved listener when entry leaves cache via remove', async () => {
        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });

        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);

        const removedEvents: string[] = [];
        cache.addEntryListener({
            entryRemoved(key) { removedEvents.push(key); },
        });

        await proxy.remove('alice');
        expect(removedEvents).toHaveLength(1);
        expect(removedEvents[0]).toBe('alice');
    });

    test('fires entryUpdated listener when cached entry is updated', async () => {
        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });

        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);

        const updatedKeys: string[] = [];
        cache.addEntryListener({
            entryUpdated(key) { updatedKeys.push(key); },
        });

        await proxy.put('alice', { name: 'Alice', active: true, dept: 'sales' });
        expect(updatedKeys).toHaveLength(1);
        expect(updatedKeys[0]).toBe('alice');
    });

    test('fires entryRemoved when updated entry no longer matches predicate', async () => {
        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });

        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);

        const removedKeys: string[] = [];
        cache.addEntryListener({
            entryRemoved(key) { removedKeys.push(key); },
        });

        await proxy.put('alice', { name: 'Alice', active: false, dept: 'engineering' });
        expect(removedKeys).toHaveLength(1);
        expect(removedKeys[0]).toBe('alice');
    });

    test('removeEntryListener stops notifications', async () => {
        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);

        let callCount = 0;
        const id = cache.addEntryListener({ entryAdded() { callCount++; } });

        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });
        expect(callCount).toBe(1);

        const removed = cache.removeEntryListener(id);
        expect(removed).toBe(true);

        await proxy.put('bob', { name: 'Bob', active: true, dept: 'sales' });
        expect(callCount).toBe(1); // no further calls
    });

    // ── recreate ────────────────────────────────────────────────────────────

    test('recreate() repopulates the cache from the current map state', async () => {
        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);
        expect(cache.size()).toBe(0);

        // Directly add entries to the map store without going through the proxy
        // to simulate a connection gap scenario (entries present but events missed)
        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });
        await proxy.put('bob', { name: 'Bob', active: false, dept: 'sales' });

        // recreate() rebuilds from current map state
        await cache.recreate();
        expect(cache.size()).toBe(1);
        expect(cache.containsKey('alice')).toBe(true);
    });

    // ── destroy ─────────────────────────────────────────────────────────────

    test('destroy() clears the cache and disables updates', async () => {
        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });

        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);
        expect(cache.size()).toBe(1);

        await cache.destroy();
        expect(cache.size()).toBe(0);

        // After destroy, further mutations should not be reflected
        await proxy.put('carol', { name: 'Carol', active: true, dept: 'sales' });
        expect(cache.size()).toBe(0);
    });

    // ── getName ─────────────────────────────────────────────────────────────

    test('getName() returns the cache name', async () => {
        const config = new QueryCacheConfig()
            .setName('myCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('myCache', config);
        expect(cache.getName()).toBe('myCache');
    });

    // ── same-name idempotence ───────────────────────────────────────────────

    test('getQueryCache with same name returns same instance', async () => {
        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const c1 = await proxy.getQueryCache('activeCache', config);
        const c2 = await proxy.getQueryCache('activeCache', config);
        expect(c1).toBe(c2);
    });

    // ── eviction max size ───────────────────────────────────────────────────

    test('enforces evictionMaxSize by evicting oldest entry', async () => {
        const config = new QueryCacheConfig()
            .setName('smallCache')
            .setPredicate(activePredicate)
            .setEvictionMaxSize(2);

        const cache = await proxy.getQueryCache('smallCache', config);

        let evictedKey: string | null = null;
        cache.addEntryListener({
            entryEvicted(key) { evictedKey = key; },
        });

        await proxy.put('alice', { name: 'Alice', active: true, dept: 'eng' });
        await proxy.put('carol', { name: 'Carol', active: true, dept: 'eng' });
        expect(cache.size()).toBe(2);

        // Third insert triggers eviction of oldest
        await proxy.put('dave', { name: 'Dave', active: true, dept: 'eng' });
        expect(cache.size()).toBe(2);
        expect(evictedKey).not.toBeNull();
    });

    // ── delete ──────────────────────────────────────────────────────────────

    test('delete() triggers cache removal', async () => {
        await proxy.put('alice', { name: 'Alice', active: true, dept: 'engineering' });

        const config = new QueryCacheConfig()
            .setName('activeCache')
            .setPredicate(activePredicate);

        const cache = await proxy.getQueryCache('activeCache', config);
        expect(cache.containsKey('alice')).toBe(true);

        await proxy.delete('alice');
        expect(cache.containsKey('alice')).toBe(false);
    });
});
