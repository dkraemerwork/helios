/**
 * Block C — Central handler registration.
 *
 * Imports and calls all 17 service handler registration functions so that
 * every opcode is wired into the dispatcher at startup.  Callers must
 * supply concrete implementations of each {@link *ServiceOperations}
 * interface; the handlers themselves are thin protocol glue and contain
 * no business logic.
 *
 * Port of Hazelcast {@code CompositeMessageTaskFactory} registration.
 */

import type { SchemaService } from '@zenystx/helios-core/internal/serialization/compact/SchemaService.js';
import type { ClientMessageDispatcher } from '@zenystx/helios-core/server/clientprotocol/ClientMessageDispatcher.js';
import type { ClientSessionRegistry } from '@zenystx/helios-core/server/clientprotocol/ClientSessionRegistry.js';
import type { TopologyPublisher } from '@zenystx/helios-core/server/clientprotocol/TopologyPublisher.js';
import type { NearCacheInvalidationManager } from '@zenystx/helios-core/spi/impl/NearCacheInvalidationManager.js';

import { registerCacheServiceHandlers } from './CacheServiceHandlers.js';
import { registerCardinalityServiceHandlers } from './CardinalityServiceHandlers.js';
import { DistributedObjectRegistry, registerClientServiceHandlers } from './ClientServiceHandlers.js';
import { registerCpServiceHandlers } from './CpServiceHandlers.js';
import { registerExecutorServiceHandlers } from './ExecutorServiceHandlers.js';
import { registerFlakeIdServiceHandlers } from './FlakeIdServiceHandlers.js';
import { registerListServiceHandlers } from './ListServiceHandlers.js';
import { registerMapServiceHandlers } from './MapServiceHandlers.js';
import { registerMultiMapServiceHandlers } from './MultiMapServiceHandlers.js';
import { registerNearCacheInvalidationHandlers } from './NearCacheInvalidationHandler.js';
import { registerPnCounterServiceHandlers } from './PnCounterServiceHandlers.js';
import { registerQueueServiceHandlers } from './QueueServiceHandlers.js';
import { registerReplicatedMapServiceHandlers } from './ReplicatedMapServiceHandlers.js';
import { registerRingbufferServiceHandlers } from './RingbufferServiceHandlers.js';
import { registerSetServiceHandlers } from './SetServiceHandlers.js';
import { registerSqlServiceHandlers } from './SqlServiceHandlers.js';
import { registerTopicServiceHandlers } from './TopicServiceHandlers.js';
import { registerTransactionServiceHandlers } from './TransactionServiceHandlers.js';

import type {
    AtomicLongOperations,
    AtomicRefOperations,
    CacheServiceOperations,
    CardinalityEstimatorOperations,
    CountDownLatchOperations,
    CpGroupOperations,
    CPMapOperations,
    CpSessionOperations,
    ExecutorServiceOperations,
    FencedLockOperations,
    FlakeIdGeneratorOperations,
    ListServiceOperations,
    MapServiceOperations,
    MultiMapServiceOperations,
    PnCounterOperations,
    QueueServiceOperations,
    ReplicatedMapServiceOperations,
    RingbufferServiceOperations,
    SemaphoreOperations,
    SetServiceOperations,
    SqlServiceOperations,
    TopicServiceOperations,
    TransactionServiceOperations,
} from './ServiceOperations.js';

// ── Options ───────────────────────────────────────────────────────────────────

export interface RegisterAllHandlersOptions {
    dispatcher: ClientMessageDispatcher;

    // Client-service (ping, proxy lifecycle, cluster topology)
    topologyPublisher: TopologyPublisher;
    schemaService?: SchemaService;
    localMemberUuid?: string;
    objectRegistry?: DistributedObjectRegistry;

    // Data-structure services
    map: MapServiceOperations;
    queue: QueueServiceOperations;
    topic: TopicServiceOperations;
    list: ListServiceOperations;
    set: SetServiceOperations;
    multiMap: MultiMapServiceOperations;
    replicatedMap: ReplicatedMapServiceOperations;
    ringbuffer: RingbufferServiceOperations;
    cache: CacheServiceOperations;
    transaction: TransactionServiceOperations;
    sql: SqlServiceOperations;
    executor: ExecutorServiceOperations;

    // CP subsystem
    cpGroup: CpGroupOperations;
    cpSession: CpSessionOperations;
    atomicLong: AtomicLongOperations;
    atomicRef: AtomicRefOperations;
    countDownLatch: CountDownLatchOperations;
    semaphore: SemaphoreOperations;
    fencedLock: FencedLockOperations;
    cpMap: CPMapOperations;

    // Misc
    flakeIdGenerator: FlakeIdGeneratorOperations;
    pnCounter: PnCounterOperations;
    cardinalityEstimator: CardinalityEstimatorOperations;

    // Near-cache invalidation
    invalidationManager: NearCacheInvalidationManager;
    sessionRegistry: ClientSessionRegistry;
}

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Wire all 17 service handler modules into {@link dispatcher}.
 *
 * Call once at server startup, before {@link ClientProtocolServer.start()}.
 */
export function registerAllHandlers(opts: RegisterAllHandlersOptions): void {
    const { dispatcher } = opts;

    registerClientServiceHandlers({
        dispatcher,
        topologyPublisher: opts.topologyPublisher,
        schemaService: opts.schemaService,
        localMemberUuid: opts.localMemberUuid,
        objectRegistry: opts.objectRegistry,
    });

    registerMapServiceHandlers({ dispatcher, operations: opts.map });

    registerQueueServiceHandlers(dispatcher, opts.queue);

    registerTopicServiceHandlers(dispatcher, opts.topic);

    registerListServiceHandlers(dispatcher, opts.list);

    registerSetServiceHandlers(dispatcher, opts.set);

    registerMultiMapServiceHandlers(dispatcher, opts.multiMap);

    registerReplicatedMapServiceHandlers(dispatcher, opts.replicatedMap);

    registerRingbufferServiceHandlers(dispatcher, opts.ringbuffer);

    registerCacheServiceHandlers(dispatcher, opts.cache);

    registerTransactionServiceHandlers(dispatcher, opts.transaction);

    registerSqlServiceHandlers(dispatcher, opts.sql);

    registerExecutorServiceHandlers(dispatcher, opts.executor);

    registerCpServiceHandlers({
        dispatcher,
        cpGroup: opts.cpGroup,
        cpSession: opts.cpSession,
        atomicLong: opts.atomicLong,
        atomicRef: opts.atomicRef,
        countDownLatch: opts.countDownLatch,
        semaphore: opts.semaphore,
        fencedLock: opts.fencedLock,
        cpMap: opts.cpMap,
    });

    registerFlakeIdServiceHandlers({
        dispatcher,
        flakeIdGenerator: opts.flakeIdGenerator,
    });

    registerPnCounterServiceHandlers({
        dispatcher,
        pnCounter: opts.pnCounter,
    });

    registerCardinalityServiceHandlers({
        dispatcher,
        cardinalityEstimator: opts.cardinalityEstimator,
    });

    registerNearCacheInvalidationHandlers({
        dispatcher,
        invalidationManager: opts.invalidationManager,
        sessionRegistry: opts.sessionRegistry,
    });
}
