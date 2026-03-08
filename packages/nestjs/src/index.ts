/**
 * @zenystx/helios-nestjs — public API barrel.
 *
 * NestJS integration for Helios distributed in-memory platform.
 *
 * ```typescript
 * import { HeliosModule, HeliosCacheModule, HeliosTransactionModule } from '@zenystx/helios-nestjs';
 * ```
 */

// ── Core module ───────────────────────────────────────────────────────────
export { HELIOS_INSTANCE_TOKEN } from './HeliosInstanceDefinition';
export { HeliosModule, type HeliosInstanceFactory, type HeliosModuleAsyncOptions } from './HeliosModule';

// ── Cache ──────────────────────────────────────────────────────────────────
export { HeliosCache, type IHeliosCacheMap } from './HeliosCache';
export {
    HeliosCacheModule, type HeliosCacheModuleAsyncOptions, type HeliosCacheModuleOptions, type HeliosCacheModuleOptionsFactory
} from './HeliosCacheModule';

// ── Transaction ────────────────────────────────────────────────────────────
export {
    HeliosTransactionManager,
    type TransactionContextFactory,
    type TransactionCreateOptions,
    type TransactionalRunOptions
} from './HeliosTransactionManager';
export {
    HeliosTransactionModule, type HeliosTransactionModuleAsyncOptions, type HeliosTransactionModuleOptions, type HeliosTransactionModuleOptionsFactory
} from './HeliosTransactionModule';
export { ManagedTransactionalTaskContext } from './ManagedTransactionalTaskContext';
export { Propagation, Transactional, type TransactionalOptions } from './Transactional';
export {
    CannotCreateTransactionException, NoTransactionException, TransactionSuspensionNotSupportedException, TransactionSystemException
} from './TransactionExceptions';

// ── Distributed object extraction ─────────────────────────────────────────
export {
    HeliosObjectExtractionModule,
    type HeliosObjectExtractionOptions
} from './HeliosObjectExtractionModule';

// ── Autoconfiguration (Boot 4) ─────────────────────────────────────────────
export {
    HeliosAutoConfigurationModule,
    type HeliosAutoConfigurationAsyncOptions
} from './autoconfiguration/HeliosAutoConfigurationModule';
export {
    HeliosBoot4ObjectExtractionModule, type HeliosBoot4ObjectExtractionOptions, type HeliosObjectDescriptor, type HeliosObjectType
} from './autoconfiguration/HeliosBoot4ObjectExtractionModule';

// ── Convenience injection decorators ──────────────────────────────────────
export {
    InjectList, InjectMap, InjectMultiMap, InjectQueue, InjectReplicatedMap, InjectSet, InjectTopic, getListToken, getMapToken, getMultiMapToken, getQueueToken, getReplicatedMapToken, getSetToken, getTopicToken
} from './decorators/inject-distributed-object.decorator';
export { InjectHelios } from './decorators/inject-helios.decorator';

// ── Spring Cache-style method decorators ──────────────────────────────────
export { CacheEvict, type CacheEvictOptions } from './decorators/cache-evict.decorator';
export { CachePut, type CachePutOptions } from './decorators/cache-put.decorator';
export { CacheableRegistry, type ICacheStore } from './decorators/cache-registry';
export { Cacheable, type CacheableOptions } from './decorators/cacheable.decorator';

// ── Context ────────────────────────────────────────────────────────────────
export {
    NEST_AWARE_METADATA_KEY, NestAware,
    isNestAware
} from './context/NestAware';
export { NestManagedContext } from './context/NestManagedContext';

// ── Monitor ────────────────────────────────────────────────────────────────
export { HeliosMonitorModule } from './monitor/HeliosMonitorModule';
export { HeliosMonitorService } from './monitor/HeliosMonitorService';

// ── Health (@nestjs/terminus) ──────────────────────────────────────────────
export { HeliosHealthIndicator } from './health/HeliosHealthIndicator';
export { HeliosHealthModule } from './health/HeliosHealthModule';

// ── Event bridge (@nestjs/event-emitter) ──────────────────────────────────
export { HeliosEventBridge } from './events/helios-event-bridge';
export { HeliosEventBridgeModule } from './events/helios-event-bridge.module';
