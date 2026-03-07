/**
 * Tests for Phase 8: near-cache wiring into HeliosInstanceImpl.
 * Block 12.A3: Updated to use async IMap methods.
 *
 * Verifies:
 * - getMap() returns NearCachedIMapWrapper when MapConfig has NearCacheConfig
 * - getMap() returns plain proxy when no NearCacheConfig
 * - Same name returns same cached wrapper instance
 * - Near-cache hit/miss/invalidation lifecycle works end-to-end
 * - Shutdown destroys near-caches
 */
import { HeliosConfig } from '@zenystx/helios-core/config/HeliosConfig';
import { MapConfig } from '@zenystx/helios-core/config/MapConfig';
import { NearCacheConfig } from '@zenystx/helios-core/config/NearCacheConfig';
import { HeliosInstanceImpl } from '@zenystx/helios-core/instance/impl/HeliosInstanceImpl';
import { NearCachedIMapWrapper } from '@zenystx/helios-core/map/impl/nearcache/NearCachedIMapWrapper';
import { afterEach, describe, expect, it } from 'bun:test';

describe('NearCacheWiringTest', () => {
    let instance: HeliosInstanceImpl;

    afterEach(() => {
        if (instance?.isRunning()) instance.shutdown();
    });

    it('getMap returns NearCachedIMapWrapper when MapConfig has NearCacheConfig', () => {
        const config = new HeliosConfig('nc-wiring-1');
        const mapCfg = new MapConfig('cached-map');
        mapCfg.setNearCacheConfig(new NearCacheConfig());
        config.addMapConfig(mapCfg);

        instance = new HeliosInstanceImpl(config);

        const map = instance.getMap<string, string>('cached-map');
        expect(map).toBeInstanceOf(NearCachedIMapWrapper);
    });

    it('getMap returns plain proxy when MapConfig has no NearCacheConfig', () => {
        const config = new HeliosConfig('nc-wiring-2');
        instance = new HeliosInstanceImpl(config);

        const map = instance.getMap<string, string>('plain-map');
        expect(map).not.toBeInstanceOf(NearCachedIMapWrapper);
    });

    it('same name returns same wrapped instance', () => {
        const config = new HeliosConfig('nc-wiring-3');
        const mapCfg = new MapConfig('cached-map');
        mapCfg.setNearCacheConfig(new NearCacheConfig());
        config.addMapConfig(mapCfg);

        instance = new HeliosInstanceImpl(config);

        const map1 = instance.getMap<string, string>('cached-map');
        const map2 = instance.getMap<string, string>('cached-map');
        expect(map1).toBe(map2);
    });

    it('near-cache miss on first get, then hit on second get', async () => {
        const config = new HeliosConfig('nc-wiring-4');
        const mapCfg = new MapConfig('cached-map');
        mapCfg.setNearCacheConfig(new NearCacheConfig());
        config.addMapConfig(mapCfg);

        instance = new HeliosInstanceImpl(config);

        const map = instance.getMap<string, string>('cached-map');
        await map.put('k1', 'v1');

        // First get — near-cache miss (put invalidated, so cache is empty)
        const v1 = await map.get('k1');
        expect(v1).toBe('v1');

        const nc = instance.getNearCacheManager().getNearCache('cached-map');
        expect(nc).not.toBeNull();
        const statsAfterFirst = nc!.getNearCacheStats();
        expect(statsAfterFirst.getMisses()).toBeGreaterThanOrEqual(1);

        // Second get — near-cache hit (value was populated on first get)
        const v2 = await map.get('k1');
        expect(v2).toBe('v1');
        const statsAfterSecond = nc!.getNearCacheStats();
        expect(statsAfterSecond.getHits()).toBeGreaterThanOrEqual(1);
    });

    it('put invalidates near-cache entry', async () => {
        const config = new HeliosConfig('nc-wiring-5');
        const mapCfg = new MapConfig('cached-map');
        mapCfg.setNearCacheConfig(new NearCacheConfig());
        config.addMapConfig(mapCfg);

        instance = new HeliosInstanceImpl(config);

        const map = instance.getMap<string, string>('cached-map');
        await map.put('k1', 'v1');
        await map.get('k1'); // miss → populate near-cache
        await map.get('k1'); // hit

        const nc = instance.getNearCacheManager().getNearCache('cached-map')!;
        const hitsBefore = nc.getNearCacheStats().getHits();

        // Update value — should invalidate near-cache entry
        await map.put('k1', 'v2');

        // Next get should be a miss (re-fetch from store), not a hit
        const v = await map.get('k1');
        expect(v).toBe('v2');

        // Hits should NOT have increased (the get after put was a miss)
        const hitsAfter = nc.getNearCacheStats().getHits();
        expect(hitsAfter).toBe(hitsBefore);
    });

    it('remove invalidates near-cache entry', async () => {
        const config = new HeliosConfig('nc-wiring-6');
        const mapCfg = new MapConfig('cached-map');
        mapCfg.setNearCacheConfig(new NearCacheConfig());
        config.addMapConfig(mapCfg);

        instance = new HeliosInstanceImpl(config);

        const map = instance.getMap<string, string>('cached-map');
        await map.put('k1', 'v1');
        await map.get('k1'); // populate cache

        // Remove — should invalidate near-cache
        await map.remove('k1');

        // Get should return null (key removed), and should be a miss
        const v = await map.get('k1');
        expect(v).toBeNull();
    });

    it('clear clears near-cache', async () => {
        const config = new HeliosConfig('nc-wiring-7');
        const mapCfg = new MapConfig('cached-map');
        mapCfg.setNearCacheConfig(new NearCacheConfig());
        config.addMapConfig(mapCfg);

        instance = new HeliosInstanceImpl(config);

        const map = instance.getMap<string, string>('cached-map');
        await map.put('k1', 'v1');
        await map.put('k2', 'v2');
        await map.get('k1'); // populate
        await map.get('k2'); // populate

        const nc = instance.getNearCacheManager().getNearCache('cached-map')!;
        expect(nc.size()).toBeGreaterThanOrEqual(2);

        await map.clear();
        expect(nc.size()).toBe(0);
    });

    it('getNearCacheManager returns the manager', () => {
        const config = new HeliosConfig('nc-wiring-8');
        instance = new HeliosInstanceImpl(config);

        const mgr = instance.getNearCacheManager();
        expect(mgr).toBeDefined();
        expect(mgr.listAllNearCaches().length).toBe(0);
    });

    it('shutdown destroys all near-caches', async () => {
        const config = new HeliosConfig('nc-wiring-9');
        const mapCfg = new MapConfig('cached-map');
        mapCfg.setNearCacheConfig(new NearCacheConfig());
        config.addMapConfig(mapCfg);

        instance = new HeliosInstanceImpl(config);

        const map = instance.getMap<string, string>('cached-map');
        await map.put('k1', 'v1');
        await map.get('k1');

        const mgr = instance.getNearCacheManager();
        expect(mgr.getNearCache('cached-map')).not.toBeNull();

        instance.shutdown();

        // After shutdown, near-caches should be destroyed
        expect(mgr.listAllNearCaches().length).toBe(0);
    });

    it('near-cache-wrapped map supports all IMap operations', async () => {
        const config = new HeliosConfig('nc-wiring-10');
        const mapCfg = new MapConfig('full-map');
        mapCfg.setNearCacheConfig(new NearCacheConfig());
        config.addMapConfig(mapCfg);

        instance = new HeliosInstanceImpl(config);

        const map = instance.getMap<string, number>('full-map');

        // put / get
        expect(await map.put('a', 1)).toBeNull();
        expect(await map.get('a')).toBe(1);

        // set
        await map.set('b', 2);
        expect(await map.get('b')).toBe(2);

        // containsKey / containsValue
        expect(map.containsKey('a')).toBe(true);
        expect(map.containsKey('z')).toBe(false);
        expect(map.containsValue(2)).toBe(true);

        // size / isEmpty
        expect(map.size()).toBe(2);
        expect(map.isEmpty()).toBe(false);

        // putIfAbsent
        expect(await map.putIfAbsent('a', 99)).toBe(1); // already exists

        // replace
        expect(await map.replace('a', 10)).toBe(1);
        expect(await map.get('a')).toBe(10);

        // delete
        await map.delete('b');
        expect(map.containsKey('b')).toBe(false);

        // putAll
        await map.putAll([['x', 100], ['y', 200]]);
        expect(await map.get('x')).toBe(100);
        expect(await map.get('y')).toBe(200);

        // entrySet / keySet / values
        expect(map.entrySet().size).toBeGreaterThan(0);
        expect(map.keySet().size).toBeGreaterThan(0);
        expect(map.values().length).toBeGreaterThan(0);

        // clear
        await map.clear();
        expect(map.size()).toBe(0);
        expect(map.isEmpty()).toBe(true);
    });
});
