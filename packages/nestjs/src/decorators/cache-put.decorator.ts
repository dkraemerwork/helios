/**
 * @CachePut() method decorator.
 *
 * Port of {@code org.springframework.cache.annotation.CachePut}.
 *
 * Behaviour:
 *   - The decorated method is ALWAYS invoked (never skipped on cache hit).
 *   - The return value is ALWAYS stored in the cache under the resolved key.
 *
 * This is the complement of @Cacheable: use @CachePut for write-through
 * scenarios where you want to keep the cache up-to-date after an update.
 *
 * Cache store resolution follows the same DI-first priority as @Cacheable.
 *
 * Usage:
 * ```typescript
 * @Injectable()
 * class UserService {
 *   @CachePut({ key: (id: string) => `user:${id}` })
 *   async updateUser(id: string, data: Partial<User>): Promise<User> { ... }
 * }
 * ```
 */

import { CacheableRegistry, findCacheOnInstance, resolveKey } from './cache-registry';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CachePutOptions {
    /** Logical cache name (reserved for future multi-cache support). */
    mapName?: string;

    /** Time-to-live in milliseconds. `0` / omitted = no expiry. */
    ttl?: number;

    /**
     * Cache key.
     *   - String: used literally.
     *   - Function: called with the method's runtime arguments.
     *   - Omitted: falls back to `<methodName>:<JSON.stringify(args)>`.
     */
    key?: string | ((...args: any[]) => string);
}

// ---------------------------------------------------------------------------
// @CachePut()
// ---------------------------------------------------------------------------

/**
 * Always execute the method and store the result in the cache.
 * Unlike @Cacheable, this decorator never returns a cached value — it always
 * calls through and updates the cache with the fresh result.
 */
export function CachePut(options?: CachePutOptions): MethodDecorator {
    return function (
        _target: object,
        propertyKey: string | symbol,
        descriptor: PropertyDescriptor,
    ): PropertyDescriptor {
        const originalMethod = descriptor.value as (...args: unknown[]) => unknown;

        descriptor.value = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
            const store = findCacheOnInstance(this) ?? CacheableRegistry.getCurrent();

            const result = await originalMethod.apply(this, args);

            if (store) {
                const cacheKey = resolveKey(options?.key, propertyKey, args);
                await store.set(cacheKey, result, options?.ttl);
            }

            return result;
        };

        return descriptor;
    };
}
