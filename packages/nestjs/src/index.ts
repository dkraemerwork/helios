/**
 * @helios/nestjs — public API barrel.
 *
 * NestJS integration for Helios distributed in-memory platform.
 *
 * ```typescript
 * import { HeliosModule, HeliosCacheModule, HeliosTransactionModule } from '@helios/nestjs';
 * ```
 */

// ── Core module ───────────────────────────────────────────────────────────
export { HeliosModule, type HeliosModuleAsyncOptions, type HeliosInstanceFactory } from './HeliosModule';
export { HELIOS_INSTANCE_TOKEN } from './HeliosInstanceDefinition';

// ── Cache ──────────────────────────────────────────────────────────────────
export { HeliosCacheModule, type HeliosCacheModuleOptions } from './HeliosCacheModule';
export { HeliosCache, type IHeliosCacheMap } from './HeliosCache';

// ── Transaction ────────────────────────────────────────────────────────────
export { HeliosTransactionModule } from './HeliosTransactionModule';
export {
    HeliosTransactionManager,
    type TransactionContextFactory,
    type TransactionCreateOptions,
    type TransactionalRunOptions,
} from './HeliosTransactionManager';
export { Transactional, Propagation, type TransactionalOptions } from './Transactional';
export { ManagedTransactionalTaskContext } from './ManagedTransactionalTaskContext';
export {
    NoTransactionException,
    TransactionSystemException,
    TransactionSuspensionNotSupportedException,
    CannotCreateTransactionException,
} from './TransactionExceptions';

// ── Distributed object extraction ─────────────────────────────────────────
export {
    HeliosObjectExtractionModule,
    type HeliosObjectExtractionOptions,
} from './HeliosObjectExtractionModule';

// ── Autoconfiguration (Boot 4) ─────────────────────────────────────────────
export {
    HeliosAutoConfigurationModule,
    type HeliosAutoConfigurationAsyncOptions,
} from './autoconfiguration/HeliosAutoConfigurationModule';
export {
    HeliosBoot4ObjectExtractionModule,
    type HeliosObjectType,
    type HeliosObjectDescriptor,
    type HeliosBoot4ObjectExtractionOptions,
} from './autoconfiguration/HeliosBoot4ObjectExtractionModule';

// ── Convenience injection decorators ──────────────────────────────────────
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

// ── Context ────────────────────────────────────────────────────────────────
export {
    NestAware,
    isNestAware,
    NEST_AWARE_METADATA_KEY,
} from './context/NestAware';
export { NestManagedContext } from './context/NestManagedContext';
