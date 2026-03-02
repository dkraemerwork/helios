/**
 * Barrel export for @helios/nestjs convenience decorators.
 */

export { InjectHelios } from './inject-helios.decorator';
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
} from './inject-distributed-object.decorator';

// ── Spring Cache-style method decorators ──────────────────────────────────
export { Cacheable, type CacheableOptions } from './cacheable.decorator';
export { CacheEvict, type CacheEvictOptions } from './cache-evict.decorator';
export { CachePut, type CachePutOptions } from './cache-put.decorator';
export { CacheableRegistry, type ICacheStore } from './cache-registry';
