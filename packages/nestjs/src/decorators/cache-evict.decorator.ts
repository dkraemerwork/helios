/**
 * @CacheEvict() method decorator.
 *
 * Port of {@code org.springframework.cache.annotation.CacheEvict}.
 *
 * Behaviour:
 *   - By default (afterInvocation): invoke the method first, then evict.
 *   - `beforeInvocation: true`: evict first, then invoke the method.
 *   - `allEntries: true`: call `store.reset()` to clear the entire cache.
 *
 * Cache store resolution follows the same DI-first priority as @Cacheable.
 *
 * Usage:
 * ```typescript
 * @Injectable()
 * class UserService {
 *   @CacheEvict({ key: (id: string) => `user:${id}` })
 *   async deleteUser(id: string): Promise<void> { ... }
 *
 *   @CacheEvict({ allEntries: true })
 *   async clearAll(): Promise<void> { ... }
 * }
 * ```
 */

import { CacheableRegistry, findCacheOnInstance, resolveKey } from './cache-registry';
import type { ICacheStore } from './cache-registry';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CacheEvictOptions {
    /** Logical cache name (reserved for future multi-cache support). */
    mapName?: string;

    /**
     * Cache key to evict.
     *   - String: used literally.
     *   - Function: called with the method's runtime arguments.
     *   - Omitted: falls back to `<methodName>:<JSON.stringify(args)>`.
     *
     * Ignored when `allEntries: true`.
     */
    key?: string | ((...args: any[]) => string);

    /**
     * When `true`, call `store.reset()` to clear the entire cache instead of
     * evicting a single key.  Defaults to `false`.
     */
    allEntries?: boolean;

    /**
     * When `true`, evict before the method is invoked rather than after.
     * Defaults to `false` (after invocation).
     */
    beforeInvocation?: boolean;
}

// ---------------------------------------------------------------------------
// @CacheEvict()
// ---------------------------------------------------------------------------

/**
 * Evict one or all entries from the cache after (or before) the method runs.
 */
export function CacheEvict(options?: CacheEvictOptions): MethodDecorator {
    return function (
        _target: object,
        propertyKey: string | symbol,
        descriptor: PropertyDescriptor,
    ): PropertyDescriptor {
        const originalMethod = descriptor.value as (...args: unknown[]) => unknown;

        descriptor.value = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
            const store = findCacheOnInstance(this) ?? CacheableRegistry.getCurrent();

            const evict = async (s: ICacheStore): Promise<void> => {
                if (options?.allEntries) {
                    await s.reset();
                } else {
                    const cacheKey = resolveKey(options?.key, propertyKey, args);
                    await s.del(cacheKey);
                }
            };

            if (options?.beforeInvocation && store) {
                await evict(store);
            }

            const result = await originalMethod.apply(this, args);

            if (!options?.beforeInvocation && store) {
                await evict(store);
            }

            return result;
        };

        return descriptor;
    };
}
