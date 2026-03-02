/**
 * Block 9.6 — @Cacheable / @CacheEvict / @CachePut method decorators.
 *
 * Port of the Spring Cache annotation semantics:
 *   @Cacheable  → cache-aside (miss → load → cache; hit → return cached)
 *   @CacheEvict → remove entry (or all entries) from cache after/before method
 *   @CachePut   → always execute method; always update cache with result
 *
 * Tests are structured in two groups:
 *   1. Unit tests — use the static CacheableRegistry (no NestJS DI)
 *   2. NestJS DI integration — inject CACHE_MANAGER into service; DI store wins
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Injectable, Inject } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from '@nestjs/cache-manager';
import { Cacheable } from '@helios/nestjs/decorators/cacheable.decorator';
import { CacheEvict } from '@helios/nestjs/decorators/cache-evict.decorator';
import { CachePut } from '@helios/nestjs/decorators/cache-put.decorator';
import { CacheableRegistry, type ICacheStore } from '@helios/nestjs/decorators/cache-registry';
import { HeliosCacheModule } from '@helios/nestjs/HeliosCacheModule';

// ---------------------------------------------------------------------------
// Shared in-memory cache store used across unit tests
// ---------------------------------------------------------------------------

function makeTestStore(): ICacheStore & { store: Map<string, { value: unknown; expiresAt?: number }> } {
    const store = new Map<string, { value: unknown; expiresAt?: number }>();
    return {
        store,
        async get(key: string): Promise<any> {
            const entry = store.get(key);
            if (!entry) return undefined;
            if (entry.expiresAt != null && Date.now() > entry.expiresAt) {
                store.delete(key);
                return undefined;
            }
            return entry.value;
        },
        async set(key: string, value: unknown, ttl?: number): Promise<void> {
            store.set(key, {
                value,
                expiresAt: ttl != null && ttl > 0 ? Date.now() + ttl : undefined,
            });
        },
        async del(key: string): Promise<void> {
            store.delete(key);
        },
        async reset(): Promise<void> {
            store.clear();
        },
    };
}

// ---------------------------------------------------------------------------
// @Cacheable — unit tests
// ---------------------------------------------------------------------------

describe('@Cacheable — unit tests (static registry)', () => {
    let cacheStore: ReturnType<typeof makeTestStore>;

    beforeEach(() => {
        cacheStore = makeTestStore();
        CacheableRegistry.setCurrent(cacheStore);
    });

    afterEach(() => {
        CacheableRegistry.setCurrent(null);
    });

    // Test 1: cache miss — calls method and stores result
    it('cache miss: calls method and caches the result', async () => {
        let callCount = 0;

        class MyService {
            @Cacheable({ key: 'test-key' })
            async loadData(): Promise<string> {
                callCount++;
                return 'loaded-value';
            }
        }

        const svc = new MyService();
        const result1 = await svc.loadData();
        const result2 = await svc.loadData();

        expect(result1).toBe('loaded-value');
        expect(result2).toBe('loaded-value');
        expect(callCount).toBe(1); // method called only once
    });

    // Test 2: cache hit — returns cached value, skips method
    it('cache hit: returns cached value without calling method', async () => {
        let callCount = 0;

        class MyService {
            @Cacheable({ key: 'pre-cached' })
            async getData(): Promise<string> {
                callCount++;
                return 'from-method';
            }
        }

        // Pre-populate cache
        await cacheStore.set('pre-cached', 'from-cache');

        const svc = new MyService();
        const result = await svc.getData();

        expect(result).toBe('from-cache');
        expect(callCount).toBe(0); // method never called
    });

    // Test 3: string key — uses the given string as cache key
    it('string key: stores and retrieves using the literal string key', async () => {
        class UserService {
            @Cacheable({ key: 'user:42' })
            async getUser(): Promise<{ id: number; name: string }> {
                return { id: 42, name: 'Alice' };
            }
        }

        const svc = new UserService();
        await svc.getUser();

        const cached = await cacheStore.get('user:42') as { id: number; name: string } | undefined;
        expect(cached).toEqual({ id: 42, name: 'Alice' });
    });

    // Test 4: function key generator — key derived from method arguments
    it('function key generator: key is computed from method args', async () => {
        let callCount = 0;

        class ProductService {
            @Cacheable({ key: (id: string) => `product:${id}` })
            async getProduct(id: string): Promise<{ id: string; name: string }> {
                callCount++;
                return { id, name: `Product ${id}` };
            }
        }

        const svc = new ProductService();
        const r1 = await svc.getProduct('abc');
        const r2 = await svc.getProduct('abc'); // hit
        const r3 = await svc.getProduct('xyz'); // miss for different id

        expect(r1).toEqual({ id: 'abc', name: 'Product abc' });
        expect(r2).toEqual({ id: 'abc', name: 'Product abc' });
        expect(r3).toEqual({ id: 'xyz', name: 'Product xyz' });
        expect(callCount).toBe(2); // abc (once) + xyz (once)

        const cachedAbc = await cacheStore.get('product:abc');
        const cachedXyz = await cacheStore.get('product:xyz');
        expect(cachedAbc).toEqual({ id: 'abc', name: 'Product abc' });
        expect(cachedXyz).toEqual({ id: 'xyz', name: 'Product xyz' });
    });

    // Test 5: TTL — entry expires after the given TTL
    it('TTL: cached entry expires after the specified TTL', async () => {
        class TtlService {
            @Cacheable({ key: 'ttl-key', ttl: 20 /* ms */ })
            async loadValue(): Promise<string> {
                return 'ttl-value';
            }
        }

        const svc = new TtlService();
        const result = await svc.loadValue();
        expect(result).toBe('ttl-value');

        // Still in cache immediately
        expect(await cacheStore.get('ttl-key') as unknown).toBe('ttl-value');

        // Wait for TTL to expire
        await new Promise(r => setTimeout(r, 40));
        expect(await cacheStore.get('ttl-key')).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// @CacheEvict — unit tests
// ---------------------------------------------------------------------------

describe('@CacheEvict — unit tests (static registry)', () => {
    let cacheStore: ReturnType<typeof makeTestStore>;

    beforeEach(() => {
        cacheStore = makeTestStore();
        CacheableRegistry.setCurrent(cacheStore);
    });

    afterEach(() => {
        CacheableRegistry.setCurrent(null);
    });

    // Test 6: evicts key after method executes
    it('evicts the cache entry after the method runs', async () => {
        await cacheStore.set('user:1', { id: 1, name: 'Alice' });

        class UserService {
            @CacheEvict({ key: (id: number) => `user:${id}` })
            async deleteUser(_id: number): Promise<void> {
                // no-op (DB delete simulated)
            }
        }

        const svc = new UserService();
        await svc.deleteUser(1);

        expect(await cacheStore.get('user:1')).toBeUndefined();
    });

    // Test 7: allEntries — clears the entire cache
    it('allEntries: true resets the entire cache', async () => {
        await cacheStore.set('key1', 'val1');
        await cacheStore.set('key2', 'val2');
        await cacheStore.set('key3', 'val3');

        class AdminService {
            @CacheEvict({ allEntries: true })
            async clearAll(): Promise<void> { /* no-op */ }
        }

        const svc = new AdminService();
        await svc.clearAll();

        expect(cacheStore.store.size).toBe(0);
    });

    // Test 8: beforeInvocation — evicts BEFORE the method runs
    it('beforeInvocation: evicts cache entry before method executes', async () => {
        await cacheStore.set('data:1', 'old-value');

        let cacheValueDuringMethod: unknown = 'NOT-CHECKED';

        class DataService {
            @CacheEvict({ key: 'data:1', beforeInvocation: true })
            async refreshData(): Promise<void> {
                // At this point the cache entry should already be gone
                cacheValueDuringMethod = await cacheStore.get('data:1');
            }
        }

        const svc = new DataService();
        await svc.refreshData();

        expect(cacheValueDuringMethod).toBeUndefined();
        expect(await cacheStore.get('data:1')).toBeUndefined();
    });

    // Test 9: function key generator in @CacheEvict
    it('function key generator: evicts the correct key derived from args', async () => {
        await cacheStore.set('item:10', 'ten');
        await cacheStore.set('item:20', 'twenty');

        class ItemService {
            @CacheEvict({ key: (id: number) => `item:${id}` })
            async removeItem(_id: number): Promise<void> { /* no-op */ }
        }

        const svc = new ItemService();
        await svc.removeItem(10);

        expect(await cacheStore.get('item:10')).toBeUndefined();
        expect(await cacheStore.get('item:20') as unknown).toBe('twenty'); // untouched
    });
});

// ---------------------------------------------------------------------------
// @CachePut — unit tests
// ---------------------------------------------------------------------------

describe('@CachePut — unit tests (static registry)', () => {
    let cacheStore: ReturnType<typeof makeTestStore>;

    beforeEach(() => {
        cacheStore = makeTestStore();
        CacheableRegistry.setCurrent(cacheStore);
    });

    afterEach(() => {
        CacheableRegistry.setCurrent(null);
    });

    // Test 10: always calls method and updates cache (on miss)
    it('always calls method and stores result (cache miss path)', async () => {
        let callCount = 0;

        class DataService {
            @CachePut({ key: 'data-key' })
            async fetchData(): Promise<string> {
                callCount++;
                return 'fresh-data';
            }
        }

        const svc = new DataService();
        const result = await svc.fetchData();

        expect(result).toBe('fresh-data');
        expect(callCount).toBe(1);
        expect(await cacheStore.get('data-key') as unknown).toBe('fresh-data');
    });

    // Test 11: always calls method even on cache hit — overwrites cache
    it('always calls method and overwrites cache even on cache hit', async () => {
        await cacheStore.set('user:5', { id: 5, name: 'Old' });

        let callCount = 0;

        class UserService {
            @CachePut({ key: 'user:5' })
            async updateUser(): Promise<{ id: number; name: string }> {
                callCount++;
                return { id: 5, name: 'Updated' };
            }
        }

        const svc = new UserService();
        const result = await svc.updateUser();

        expect(result).toEqual({ id: 5, name: 'Updated' });
        expect(callCount).toBe(1); // always called
        expect(await cacheStore.get('user:5') as unknown).toEqual({ id: 5, name: 'Updated' });
    });

    // Test 12: function key generator in @CachePut
    it('function key generator: stores result under computed key', async () => {
        class OrderService {
            @CachePut({ key: (orderId: string) => `order:${orderId}` })
            async saveOrder(orderId: string, total: number): Promise<{ id: string; total: number }> {
                return { id: orderId, total };
            }
        }

        const svc = new OrderService();
        await svc.saveOrder('ord-42', 199);

        expect(await cacheStore.get('order:ord-42') as unknown).toEqual({ id: 'ord-42', total: 199 });
    });

    // Test 13: TTL option in @CachePut
    it('TTL: cached entry from @CachePut expires after the TTL', async () => {
        class FreshService {
            @CachePut({ key: 'fresh-key', ttl: 20 /* ms */ })
            async produce(): Promise<string> {
                return 'fresh';
            }
        }

        const svc = new FreshService();
        await svc.produce();

        expect(await cacheStore.get('fresh-key') as unknown).toBe('fresh');

        await new Promise(r => setTimeout(r, 40));
        expect(await cacheStore.get('fresh-key')).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// DI-precedence test
// ---------------------------------------------------------------------------

describe('@Cacheable — DI injected cache takes precedence over static registry', () => {
    afterEach(() => {
        CacheableRegistry.setCurrent(null);
    });

    // Test 14: DI-injected store wins; static registry store is NOT used
    it('uses DI-injected cache store over the static registry', async () => {
        const staticStore = makeTestStore();
        const diStore = makeTestStore();

        CacheableRegistry.setCurrent(staticStore);

        class CacheableService {
            constructor(private readonly cacheManager: ICacheStore) {}

            @Cacheable({ key: 'di-key' })
            async loadValue(): Promise<string> {
                return 'from-method';
            }
        }

        const svc = new CacheableService(diStore);
        await svc.loadValue();

        // DI store should have the cached value
        expect(await diStore.get('di-key') as unknown).toBe('from-method');
        // Static store must NOT have been used
        expect(staticStore.store.size).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// NestJS module integration test
// ---------------------------------------------------------------------------

describe('@Cacheable/@CacheEvict/@CachePut — NestJS CACHE_MANAGER integration', () => {
    let module: TestingModule;

    afterEach(async () => {
        if (module) await module.close();
        CacheableRegistry.setCurrent(null);
    });

    // Test 15: CACHE_MANAGER injected via NestJS wires through to decorators
    it('decorators work with CACHE_MANAGER injected via NestJS DI', async () => {
        @Injectable()
        class CounterService {
            constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

            private _loadCount = 0;

            get loadCount(): number { return this._loadCount; }

            @Cacheable({ key: 'counter-value' })
            async getValue(): Promise<number> {
                this._loadCount++;
                return 42;
            }

            @CacheEvict({ key: 'counter-value' })
            async invalidate(): Promise<void> { /* evict */ }

            @CachePut({ key: 'counter-value' })
            async setValue(_ignored: unknown): Promise<number> {
                return 99;
            }
        }

        module = await Test.createTestingModule({
            imports: [HeliosCacheModule.register()],
            providers: [CounterService],
        }).compile();

        const svc = module.get(CounterService);

        // First call — cache miss
        const v1 = await svc.getValue();
        expect(v1).toBe(42);
        expect(svc.loadCount).toBe(1);

        // Second call — cache hit, method NOT called
        const v2 = await svc.getValue();
        expect(v2).toBe(42);
        expect(svc.loadCount).toBe(1);

        // Evict
        await svc.invalidate();

        // After eviction — cache miss again
        const v3 = await svc.getValue();
        expect(v3).toBe(42);
        expect(svc.loadCount).toBe(2);

        // CachePut — always updates cache
        await svc.setValue(null);
        const v4 = await svc.getValue();
        expect(v4).toBe(99);
        expect(svc.loadCount).toBe(2); // still 2, no additional method call
    });
});
