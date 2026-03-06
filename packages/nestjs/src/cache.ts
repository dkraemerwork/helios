/**
 * @zenystx/nestjs/cache — Cache subpath barrel.
 *
 * Import cache-related symbols from this subpath to reduce bundle size:
 * ```typescript
 * import { HeliosCacheModule, HeliosCache, Cacheable } from '@zenystx/nestjs/cache';
 * ```
 */

export {
    HeliosCacheModule,
    type HeliosCacheModuleOptions,
    type HeliosCacheModuleAsyncOptions,
    type HeliosCacheModuleOptionsFactory,
} from './HeliosCacheModule';
export { HeliosCache, type IHeliosCacheMap } from './HeliosCache';
export { Cacheable, type CacheableOptions } from './decorators/cacheable.decorator';
export { CacheEvict, type CacheEvictOptions } from './decorators/cache-evict.decorator';
export { CachePut, type CachePutOptions } from './decorators/cache-put.decorator';
export { CacheableRegistry, type ICacheStore } from './decorators/cache-registry';
