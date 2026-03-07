/**
 * @zenystx/helios-nestjs/decorators — DI + cache decorator subpath barrel.
 *
 * Import injection and cache decorator symbols from this subpath to reduce bundle size:
 * ```typescript
 * import { InjectHelios, InjectMap, Cacheable } from '@zenystx/helios-nestjs/decorators';
 * ```
 */

export { CacheEvict, type CacheEvictOptions } from './decorators/cache-evict.decorator';
export { CachePut, type CachePutOptions } from './decorators/cache-put.decorator';
export { CacheableRegistry, type ICacheStore } from './decorators/cache-registry';
export { Cacheable, type CacheableOptions } from './decorators/cacheable.decorator';
export {
    InjectList, InjectMap, InjectMultiMap, InjectQueue, InjectReplicatedMap, InjectSet, InjectTopic, getListToken, getMapToken, getMultiMapToken, getQueueToken, getReplicatedMapToken, getSetToken, getTopicToken
} from './decorators/inject-distributed-object.decorator';
export { InjectHelios } from './decorators/inject-helios.decorator';
