/**
 * @zenystx/helios-nestjs/cache — Cache subpath barrel.
 *
 * Import cache-related symbols from this subpath to reduce bundle size:
 * ```typescript
 * import { HeliosCacheModule, HeliosCache, Cacheable } from '@zenystx/helios-nestjs/cache';
 * ```
 */

export { CacheEvict, type CacheEvictOptions } from './decorators/cache-evict.decorator';
export { CachePut, type CachePutOptions } from './decorators/cache-put.decorator';
export { CacheableRegistry, type ICacheStore } from './decorators/cache-registry';
export { Cacheable, type CacheableOptions } from './decorators/cacheable.decorator';
export { HeliosCache, type IHeliosCacheMap } from './HeliosCache';
export {
    HeliosCacheModule, type HeliosCacheModuleAsyncOptions, type HeliosCacheModuleOptions, type HeliosCacheModuleOptionsFactory
} from './HeliosCacheModule';
