/**
 * Static registry for the active ICacheStore.
 *
 * Mirrors the pattern used by {@link HeliosTransactionManager} — provides a
 * module-level singleton that @Cacheable / @CacheEvict / @CachePut fall back to
 * when no cache store is injected directly on `this`.
 *
 * Lifecycle:
 *   - Set by HeliosCacheableModule (or in tests) via {@link CacheableRegistry.setCurrent}.
 *   - Cleared by passing `null` (e.g., in afterEach cleanup).
 */

// ---------------------------------------------------------------------------
// ICacheStore — minimal duck-type interface required by the decorators
// ---------------------------------------------------------------------------

/**
 * Minimal subset of the cache-manager {@link Cache} interface that the
 * caching decorators depend on.  Both the real {@link Cache} (from
 * `@nestjs/cache-manager`) and our test doubles implement this.
 */
export interface ICacheStore {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set<T = unknown>(key: string, value: T, ttl?: number): Promise<void>;
    del(key: string): Promise<void>;
    reset(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Runtime duck-type guard
// ---------------------------------------------------------------------------

/**
 * Returns `true` if `val` looks like an {@link ICacheStore}.
 * Used by decorators to scan `this` for a DI-injected cache store.
 */
export function isCacheStore(val: unknown): val is ICacheStore {
    return (
        val != null &&
        typeof val === 'object' &&
        typeof (val as ICacheStore).get === 'function' &&
        typeof (val as ICacheStore).set === 'function' &&
        typeof (val as ICacheStore).del === 'function'
    );
}

// ---------------------------------------------------------------------------
// CacheableRegistry
// ---------------------------------------------------------------------------

/**
 * Module-level static singleton for the active cache store.
 *
 * Priority resolution in decorators:
 *   1. A DI-injected {@link ICacheStore}-compatible property on `this`.
 *   2. The store registered here via `setCurrent()`.
 */
export class CacheableRegistry {
    private static _current: ICacheStore | null = null;

    /** Register the active cache store (called by HeliosCacheableModule). */
    static setCurrent(store: ICacheStore | null): void {
        this._current = store;
    }

    /** Return the currently registered store, or `null` if none. */
    static getCurrent(): ICacheStore | null {
        return this._current;
    }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Scan own enumerable properties of `instance` for an {@link ICacheStore}.
 * Returns the first match, or `null`.
 *
 * This lets decorators pick up a CACHE_MANAGER (or any ICacheStore-compatible
 * object) injected via NestJS constructor DI, without requiring a global
 * singleton.
 */
export function findCacheOnInstance(instance: unknown): ICacheStore | null {
    if (instance == null || typeof instance !== 'object') return null;
    for (const key of Object.keys(instance as object)) {
        const val = (instance as Record<string, unknown>)[key];
        if (isCacheStore(val)) return val;
    }
    return null;
}

/**
 * Resolve a cache key from:
 *   - A function: called with the method's runtime arguments.
 *   - A string: used literally.
 *   - Undefined: falls back to `<methodName>:<JSON.stringify(args)>`.
 */
export function resolveKey(
    key: string | ((...args: unknown[]) => string) | undefined,
    propertyKey: string | symbol,
    args: unknown[],
): string {
    if (typeof key === 'function') return key(...args);
    if (typeof key === 'string') return key;
    return `${String(propertyKey)}:${JSON.stringify(args)}`;
}
