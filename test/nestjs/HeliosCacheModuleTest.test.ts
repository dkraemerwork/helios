/**
 * Tests for HeliosCache and HeliosCacheModule (Block 6.2).
 *
 * HeliosCache implements KeyvStoreAdapter backed by a Map-like IMap.
 * HeliosCacheModule wraps @nestjs/cache-manager CacheModule with a Helios store.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import { HeliosCache } from '@helios/nestjs/HeliosCache';
import { HeliosCacheModule } from '@helios/nestjs/HeliosCacheModule';

// ---------------------------------------------------------------------------
// Minimal IMap stub for testing (synchronous Map-based)
// ---------------------------------------------------------------------------

interface IMapStub {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown, ttl?: number): Promise<void>;
    delete(key: string): Promise<boolean>;
    clear(): Promise<void>;
    has(key: string): Promise<boolean>;
    keys(): Promise<string[]>;
}

function makeIMapStub(): IMapStub {
    const store = new Map<string, { value: unknown; expiresAt?: number }>();
    return {
        async get(key: string) {
            const entry = store.get(key);
            if (!entry) return undefined;
            if (entry.expiresAt != null && Date.now() > entry.expiresAt) {
                store.delete(key);
                return undefined;
            }
            return entry.value;
        },
        async set(key: string, value: unknown, ttl?: number) {
            store.set(key, {
                value,
                expiresAt: ttl != null && ttl > 0 ? Date.now() + ttl : undefined,
            });
        },
        async delete(key: string) {
            return store.delete(key);
        },
        async clear() {
            store.clear();
        },
        async has(key: string) {
            return store.has(key);
        },
        async keys() {
            return [...store.keys()];
        },
    };
}

// ---------------------------------------------------------------------------
// HeliosCache unit tests
// ---------------------------------------------------------------------------

describe('HeliosCache', () => {
    let mapStub: IMapStub;
    let cache: HeliosCache;

    beforeEach(() => {
        mapStub = makeIMapStub();
        cache = new HeliosCache(mapStub);
    });

    it('get returns undefined for a missing key', async () => {
        expect(await cache.get('missing')).toBeUndefined();
    });

    it('set and get roundtrip a value', async () => {
        await cache.set('k1', 'hello');
        expect(await cache.get<string>('k1')).toBe('hello');
    });

    it('set and get roundtrip an object value', async () => {
        const val = { x: 1, y: 2 };
        await cache.set('obj', val);
        expect(await cache.get<typeof val>('obj')).toEqual(val);
    });

    it('set with TTL stores the value', async () => {
        await cache.set('ttl-key', 42, 10_000);
        expect(await cache.get<number>('ttl-key')).toBe(42);
    });

    it('delete removes a stored key', async () => {
        await cache.set('del', 'gone');
        expect(await cache.delete('del')).toBe(true);
        expect(await cache.get('del')).toBeUndefined();
    });

    it('delete returns false for a missing key', async () => {
        expect(await cache.delete('nonexistent')).toBe(false);
    });

    it('clear removes all keys', async () => {
        await cache.set('a', 1);
        await cache.set('b', 2);
        await cache.clear();
        expect(await cache.get('a')).toBeUndefined();
        expect(await cache.get('b')).toBeUndefined();
    });

    it('has returns true for existing key', async () => {
        await cache.set('exist', 'yes');
        expect(await cache.has?.('exist')).toBe(true);
    });

    it('has returns false for missing key', async () => {
        expect(await cache.has?.('nope')).toBe(false);
    });

    it('getMany returns values in order', async () => {
        await cache.set('m1', 'alpha');
        await cache.set('m2', 'beta');
        const results = await cache.getMany?.(['m1', 'missing', 'm2']);
        expect(results).toBeDefined();
        expect(results![0]).toBe('alpha');
        expect(results![1]).toBeUndefined();
        expect(results![2]).toBe('beta');
    });

    it('deleteMany removes multiple keys', async () => {
        await cache.set('x', 1);
        await cache.set('y', 2);
        await cache.deleteMany?.(['x', 'y']);
        expect(await cache.get('x')).toBeUndefined();
        expect(await cache.get('y')).toBeUndefined();
    });

    it('on() does not throw (event listener stub)', () => {
        expect(() => cache.on('error', () => {})).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// HeliosCacheModule integration tests
// ---------------------------------------------------------------------------

describe('HeliosCacheModule', () => {
    let module: TestingModule;

    afterEach(async () => {
        if (module) await module.close();
    });

    it('register() provides CACHE_MANAGER', async () => {
        module = await Test.createTestingModule({
            imports: [HeliosCacheModule.register()],
        }).compile();

        const cacheManager = module.get<Cache>(CACHE_MANAGER);
        expect(cacheManager).toBeDefined();
    });

    it('registered CACHE_MANAGER can get/set values', async () => {
        module = await Test.createTestingModule({
            imports: [HeliosCacheModule.register()],
        }).compile();

        const cacheManager = module.get<Cache>(CACHE_MANAGER);
        await cacheManager.set('key1', 'value1');
        const result = await cacheManager.get<string>('key1');
        expect(result).toBe('value1');
    });

    it('register() with ttl option configures default TTL', async () => {
        module = await Test.createTestingModule({
            imports: [HeliosCacheModule.register({ ttl: 5000 })],
        }).compile();

        const cacheManager = module.get<Cache>(CACHE_MANAGER);
        expect(cacheManager).toBeDefined();
    });

    it('register() returns a DynamicModule', () => {
        const dm = HeliosCacheModule.register();
        expect(dm.module).toBe(HeliosCacheModule);
    });

    it('register({ isGlobal: true }) marks module as global', () => {
        const dm = HeliosCacheModule.register({ isGlobal: true });
        expect(dm.global).toBe(true);
    });
});
