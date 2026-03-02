/**
 * @Cacheable() method decorator.
 *
 * Port of {@code org.springframework.cache.annotation.Cacheable}.
 *
 * Behaviour:
 *   - On cache MISS: invoke the method, store the result under the resolved key,
 *     and return the result.
 *   - On cache HIT: return the cached value; the method is NOT invoked.
 *
 * Cache store resolution (DI-first, same pattern as @Transactional):
 *   1. Scan own properties of `this` for an {@link ICacheStore}-compatible object
 *      (i.e. a CACHE_MANAGER injected via NestJS constructor DI).
 *   2. Fall back to {@link CacheableRegistry.getCurrent()} (module-level static).
 *   3. If no store is available the method is called without caching.
 *
 * Usage:
 * ```typescript
 * @Injectable()
 * class UserService {
 *   @Cacheable({ key: (id: string) => `user:${id}`, ttl: 60_000 })
 *   async getUser(id: string): Promise<User> { ... }
 * }
 * ```
 */

import { CacheableRegistry, findCacheOnInstance, resolveKey } from './cache-registry';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CacheableOptions {
    /**
     * Logical cache name (future: selects a named cache store).
     * Currently unused — included for API parity with Spring @Cacheable.
     */
    mapName?: string;

    /** Time-to-live in milliseconds. `0` / omitted = no expiry. */
    ttl?: number;

    /**
     * Cache key.
     *   - String: used literally.
     *   - Function: called with the method's runtime arguments.
     *   - Omitted: falls back to `<methodName>:<JSON.stringify(args)>`.
     */
    key?: string | ((...args: unknown[]) => string);
}

// ---------------------------------------------------------------------------
// @Cacheable()
// ---------------------------------------------------------------------------

/**
 * Cache the return value of the decorated method.
 * The method is only invoked on a cache miss; subsequent calls with the same
 * key return the cached value directly.
 */
export function Cacheable(options?: CacheableOptions): MethodDecorator {
    return function (
        _target: object,
        propertyKey: string | symbol,
        descriptor: PropertyDescriptor,
    ): PropertyDescriptor {
        const originalMethod = descriptor.value as (...args: unknown[]) => unknown;

        descriptor.value = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
            const store = findCacheOnInstance(this) ?? CacheableRegistry.getCurrent();
            if (!store) {
                // No cache configured — bypass caching.
                return originalMethod.apply(this, args);
            }

            const cacheKey = resolveKey(options?.key, propertyKey, args);
            const cached = await store.get<unknown>(cacheKey);
            if (cached !== undefined) return cached;

            const result = await originalMethod.apply(this, args);
            await store.set(cacheKey, result, options?.ttl);
            return result;
        };

        return descriptor;
    };
}
