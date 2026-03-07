/**
 * Barrel export for @zenystx/helios-nestjs convenience decorators.
 */

export {
    InjectList, InjectMap, InjectMultiMap, InjectQueue, InjectReplicatedMap, InjectSet, InjectTopic, getListToken, getMapToken, getMultiMapToken, getQueueToken, getReplicatedMapToken, getSetToken, getTopicToken
} from './inject-distributed-object.decorator';
export { InjectHelios } from './inject-helios.decorator';

// ── Spring Cache-style method decorators ──────────────────────────────────
export { CacheEvict, type CacheEvictOptions } from './cache-evict.decorator';
export { CachePut, type CachePutOptions } from './cache-put.decorator';
export { CacheableRegistry, type ICacheStore } from './cache-registry';
export { Cacheable, type CacheableOptions } from './cacheable.decorator';
