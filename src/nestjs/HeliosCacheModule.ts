/**
 * NestJS module for Helios cache integration.
 * Port of {@code com.hazelcast.spring.cache.HazelcastCacheManager}.
 *
 * Wraps @nestjs/cache-manager {@link CacheModule} with an in-process
 * Helios-backed store.  When a HeliosInstance is available in the module
 * context it is used as the backing store; otherwise an in-memory Map is used
 * so the module is always self-contained for testing.
 *
 * Usage (synchronous / standalone):
 *   HeliosCacheModule.register()
 *   HeliosCacheModule.register({ ttl: 30_000, isGlobal: true })
 */

import { DynamicModule, Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { HeliosCache, type IHeliosCacheMap } from './HeliosCache';

// ---------------------------------------------------------------------------
// Module options
// ---------------------------------------------------------------------------

export interface HeliosCacheModuleOptions {
    /** Default TTL in milliseconds (0 = no expiry). */
    ttl?: number;
    /** When true the module is registered as a NestJS global module. */
    isGlobal?: boolean;
    /**
     * Optional backing map.  If omitted an in-process Map is used, which is
     * suitable for single-node deployments and tests.
     */
    store?: IHeliosCacheMap;
}

// ---------------------------------------------------------------------------
// Default in-process IHeliosCacheMap backed by a plain Map
// ---------------------------------------------------------------------------

function makeInMemoryMap(): IHeliosCacheMap {
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
// Module
// ---------------------------------------------------------------------------

@Module({})
export class HeliosCacheModule {
    /**
     * Register the Helios cache module synchronously.
     *
     * @param options  Optional configuration options.
     */
    static register(options: HeliosCacheModuleOptions = {}): DynamicModule {
        const { ttl, isGlobal, store } = options;
        const backingMap = store ?? makeInMemoryMap();
        const heliosStore = new HeliosCache(backingMap);

        // Pass the raw KeyvStoreAdapter; @nestjs/cache-manager will wrap it
        // in a Keyv instance internally via its cachingFactory.
        const cacheModule = CacheModule.register({
            stores: heliosStore as never,
            ttl,
            isGlobal: isGlobal ?? false,
        });

        return {
            module: HeliosCacheModule,
            global: isGlobal,
            imports: [cacheModule],
            exports: [cacheModule],
        };
    }
}
