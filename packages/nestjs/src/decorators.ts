/**
 * @helios/nestjs/decorators — DI + cache decorator subpath barrel.
 *
 * Import injection and cache decorator symbols from this subpath to reduce bundle size:
 * ```typescript
 * import { InjectHelios, InjectMap, Cacheable } from '@helios/nestjs/decorators';
 * ```
 */

export { InjectHelios } from './decorators/inject-helios.decorator';
export {
    InjectMap,
    InjectQueue,
    InjectTopic,
    InjectList,
    InjectSet,
    InjectMultiMap,
    InjectReplicatedMap,
    getMapToken,
    getQueueToken,
    getTopicToken,
    getListToken,
    getSetToken,
    getMultiMapToken,
    getReplicatedMapToken,
} from './decorators/inject-distributed-object.decorator';
export { Cacheable, type CacheableOptions } from './decorators/cacheable.decorator';
export { CacheEvict, type CacheEvictOptions } from './decorators/cache-evict.decorator';
export { CachePut, type CachePutOptions } from './decorators/cache-put.decorator';
export { CacheableRegistry, type ICacheStore } from './decorators/cache-registry';
