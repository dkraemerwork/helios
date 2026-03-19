/**
 * Helios — public API barrel.
 *
 * Import everything from this file when using Helios as a library:
 *
 * ```typescript
 * import { Helios, HeliosConfig, MapProxy } from 'helios';
 * ```
 *
 * Port of com.hazelcast.Hazelcast / com.hazelcast.core.*
 */

// ── Factory ───────────────────────────────────────────────────────────────────
export { Helios } from "@zenystx/helios-core/Helios";

// ── Config ────────────────────────────────────────────────────────────────────
export { resolveHeliosBlitzConfigFromEnv } from "@zenystx/helios-core/config/BlitzEnvHelper";
export type { HeliosBlitzRuntimeConfig } from "@zenystx/helios-core/config/BlitzRuntimeConfig";
export { loadConfig } from "@zenystx/helios-core/config/ConfigLoader";
export { ConfigValidationError, validateHeliosConfig } from "@zenystx/helios-core/config/ConfigValidator";
export { EvictionConfig } from "@zenystx/helios-core/config/EvictionConfig";
export { EvictionPolicy } from "@zenystx/helios-core/config/EvictionPolicy";
export * as HazelcastDefaults from "@zenystx/helios-core/config/HazelcastDefaults";
export { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
export { InMemoryFormat } from "@zenystx/helios-core/config/InMemoryFormat";
export { JoinConfig } from "@zenystx/helios-core/config/JoinConfig";
export { MapConfig } from "@zenystx/helios-core/config/MapConfig";
export { MaxSizePolicy } from "@zenystx/helios-core/config/MaxSizePolicy";
export { MulticastConfig } from "@zenystx/helios-core/config/MulticastConfig";
export { NearCacheConfig } from "@zenystx/helios-core/config/NearCacheConfig";
export { NearCachePreloaderConfig } from "@zenystx/helios-core/config/NearCachePreloaderConfig";
export { NetworkConfig } from "@zenystx/helios-core/config/NetworkConfig";
export { QueueConfig } from "@zenystx/helios-core/config/QueueConfig";
export { RingbufferConfig } from "@zenystx/helios-core/config/RingbufferConfig";
export {
    SplitBrainProtectionConfig,
    ProbabilisticSplitBrainProtectionConfig,
    RecentlyActiveSplitBrainProtectionConfig,
    SplitBrainProtectionOn,
    SplitBrainProtectionFunctionType,
} from "@zenystx/helios-core/config/SplitBrainProtectionConfig";
export { TcpIpConfig } from "@zenystx/helios-core/config/TcpIpConfig";
export { TopicConfig } from "@zenystx/helios-core/config/TopicConfig";
export { TcpTransportScatterConfig } from "@zenystx/helios-core/config/TcpTransportScatterConfig";

// ── Core / Instance ───────────────────────────────────────────────────────────
export type { DistributedObject } from "@zenystx/helios-core/core/DistributedObject";
export type { HeliosInstance } from "@zenystx/helios-core/core/HeliosInstance";
export type { InstanceConfig } from "@zenystx/helios-core/core/InstanceConfig";
export { SplitBrainProtectionException } from "@zenystx/helios-core/core/exception/SplitBrainProtectionException";
export { SplitBrainProtectionServiceImpl } from "@zenystx/helios-core/splitbrainprotection/impl/SplitBrainProtectionServiceImpl";
export { BuildInfo } from "@zenystx/helios-core/instance/BuildInfo";
export { BuildInfoProvider } from "@zenystx/helios-core/instance/BuildInfoProvider";
export { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
export { HeliosLifecycleService } from "@zenystx/helios-core/instance/lifecycle/HeliosLifecycleService";
export { LifecycleEvent } from "@zenystx/helios-core/instance/lifecycle/LifecycleEvent";
export type { LifecycleListener } from "@zenystx/helios-core/instance/lifecycle/LifecycleListener";
export type { LifecycleService } from "@zenystx/helios-core/instance/lifecycle/LifecycleService";

// ── Map ───────────────────────────────────────────────────────────────────────
export type { EntryListener } from "@zenystx/helios-core/map/EntryListener";
export type { EntryProcessor } from "@zenystx/helios-core/map/EntryProcessor";
export type { IMap } from "@zenystx/helios-core/map/IMap";
export type { MapInterceptor } from "@zenystx/helios-core/map/MapInterceptor";
export { MapProxy } from "@zenystx/helios-core/map/impl/MapProxy";
export { NetworkedMapProxy } from "@zenystx/helios-core/map/impl/NetworkedMapProxy";
export { MapKeyStream } from "@zenystx/helios-core/map/MapKeyStream";
export type { MapLoader } from "@zenystx/helios-core/map/MapLoader";
export type { MapLoaderLifecycleSupport } from "@zenystx/helios-core/map/MapLoaderLifecycleSupport";
export type { MapStore } from "@zenystx/helios-core/map/MapStore";
export type { MapStoreFactory } from "@zenystx/helios-core/map/MapStoreFactory";
export { QueryResultSizeExceededException } from "@zenystx/helios-core/map/QueryResultSizeExceededException";
export type { QueryCache, QueryCacheEntryListener } from "@zenystx/helios-core/map/QueryCache";
export { QueryCacheConfig } from "@zenystx/helios-core/config/QueryCacheConfig";

// ── Collections ───────────────────────────────────────────────────────────────
export type { ICollection } from "@zenystx/helios-core/collection/ICollection";
export type { IList } from "@zenystx/helios-core/collection/IList";
export { ListImpl } from "@zenystx/helios-core/collection/impl/ListImpl";
export { QueueImpl } from "@zenystx/helios-core/collection/impl/QueueImpl";
export { SetImpl } from "@zenystx/helios-core/collection/impl/SetImpl";
export type { IQueue } from "@zenystx/helios-core/collection/IQueue";
export type { ISet } from "@zenystx/helios-core/collection/ISet";
export type { ItemListener } from "@zenystx/helios-core/collection/ItemListener";
export type { LocalQueueStats } from "@zenystx/helios-core/collection/LocalQueueStats";
export type { QueueStore } from "@zenystx/helios-core/collection/QueueStore";
export type { QueueStoreFactory } from "@zenystx/helios-core/collection/QueueStoreFactory";
export { QueueStoreConfig } from "@zenystx/helios-core/config/QueueStoreConfig";

// ── Topic ─────────────────────────────────────────────────────────────────────
export { ReliableTopicConfig, TopicOverloadPolicy } from "@zenystx/helios-core/config/ReliableTopicConfig";
export { TopicOverloadException } from "@zenystx/helios-core/topic/impl/reliable/ReliableTopicService";
export { TopicImpl } from "@zenystx/helios-core/topic/impl/TopicImpl";
export type { ITopic } from "@zenystx/helios-core/topic/ITopic";
export type { Message } from "@zenystx/helios-core/topic/Message";
export type { MessageListener } from "@zenystx/helios-core/topic/MessageListener";

// ── MultiMap ──────────────────────────────────────────────────────────────────
export { MultiMapImpl } from "@zenystx/helios-core/multimap/impl/MultiMapImpl";
export type { MultiMap } from "@zenystx/helios-core/multimap/MultiMap";

// ── ReplicatedMap ─────────────────────────────────────────────────────────────
export { ReplicatedMapImpl } from "@zenystx/helios-core/replicatedmap/impl/ReplicatedMapImpl";
export type { ReplicatedMap } from "@zenystx/helios-core/replicatedmap/ReplicatedMap";

// ── Ringbuffer ────────────────────────────────────────────────────────────────
export { ArrayRingbuffer } from "@zenystx/helios-core/ringbuffer/impl/ArrayRingbuffer";
export { ReadResultSetImpl } from "@zenystx/helios-core/ringbuffer/impl/ReadResultSetImpl";
export type { Ringbuffer } from "@zenystx/helios-core/ringbuffer/impl/Ringbuffer";
export { OverflowPolicy } from "@zenystx/helios-core/ringbuffer/OverflowPolicy";
export { StaleSequenceException } from "@zenystx/helios-core/ringbuffer/StaleSequenceException";
export type { RingbufferStore } from "@zenystx/helios-core/ringbuffer/RingbufferStore";
export type { RingbufferStoreFactory } from "@zenystx/helios-core/ringbuffer/RingbufferStoreFactory";
export { RingbufferStoreConfig } from "@zenystx/helios-core/config/RingbufferStoreConfig";

// ── Cache / JCache ────────────────────────────────────────────────────────────
export { CACHE_MANAGER_PREFIX } from "@zenystx/helios-core/cache/HazelcastCacheManager";
export { CacheRecordStore } from "@zenystx/helios-core/cache/impl/CacheRecordStore";

// ── Transaction ───────────────────────────────────────────────────────────────
export { TransactionImpl } from "@zenystx/helios-core/transaction/impl/TransactionImpl";
export { TransactionManagerServiceImpl } from "@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl";
export { TransactionCoordinator } from "@zenystx/helios-core/transaction/impl/TransactionCoordinator";
export type { ManagedTransaction } from "@zenystx/helios-core/transaction/impl/TransactionCoordinator";
export { TransactionRecoveryService } from "@zenystx/helios-core/transaction/impl/TransactionRecoveryService";
export type { ReplicatedTransactionLog } from "@zenystx/helios-core/transaction/impl/TransactionRecoveryService";
export type { TransactionContext } from "@zenystx/helios-core/transaction/TransactionContext";
export { TransactionException } from "@zenystx/helios-core/transaction/TransactionException";
export { TransactionNotActiveException } from "@zenystx/helios-core/transaction/TransactionNotActiveException";
export { TransactionOptions } from "@zenystx/helios-core/transaction/TransactionOptions";
export { TransactionTimedOutException } from "@zenystx/helios-core/transaction/TransactionTimedOutException";

// ── Cluster ───────────────────────────────────────────────────────────────────
export { Address } from "@zenystx/helios-core/cluster/Address";
export type { Cluster } from "@zenystx/helios-core/cluster/Cluster";
export { MemberImpl, MemberImplBuilder } from "@zenystx/helios-core/cluster/impl/MemberImpl";
export type { Member } from "@zenystx/helios-core/cluster/Member";
export { MemberInfo } from "@zenystx/helios-core/cluster/MemberInfo";
export type { MemberSelector } from "@zenystx/helios-core/cluster/MemberSelector";
export type {
    MembershipListener,
    MembershipEvent,
    MemberAttributeEvent,
    MemberAttributeOperationType,
} from "@zenystx/helios-core/cluster/MembershipListener";
export { MemberSelectors } from "@zenystx/helios-core/cluster/memberselector/MemberSelectors";

// ── Security ──────────────────────────────────────────────────────────────────
export type { Credentials } from "@zenystx/helios-core/security/Credentials";
export type { PasswordCredentials } from "@zenystx/helios-core/security/PasswordCredentials";
export { SimpleTokenCredentials } from "@zenystx/helios-core/security/SimpleTokenCredentials";
export type { TokenCredentials } from "@zenystx/helios-core/security/TokenCredentials";
export { UsernamePasswordCredentials } from "@zenystx/helios-core/security/UsernamePasswordCredentials";
export { AccessControlException } from "@zenystx/helios-core/security/AccessControlException";
export { SecurityContext } from "@zenystx/helios-core/security/impl/SecurityContext";
export { SecurityInterceptor } from "@zenystx/helios-core/security/impl/SecurityInterceptor";
export { TokenAuthenticator } from "@zenystx/helios-core/security/impl/TokenAuthenticator";
export { AuthRateLimiter } from "@zenystx/helios-core/security/impl/AuthRateLimiter";
export type { AuthRateLimiterOptions } from "@zenystx/helios-core/security/impl/AuthRateLimiter";
// ── Permission classes ────────────────────────────────────────────────────────
export { ActionConstants } from "@zenystx/helios-core/security/permission/ActionConstants";
export { ClusterPermission } from "@zenystx/helios-core/security/permission/ClusterPermission";
export { ClusterPermissionCollection } from "@zenystx/helios-core/security/permission/ClusterPermissionCollection";
export { MapPermission } from "@zenystx/helios-core/security/permission/MapPermission";
export { QueuePermission } from "@zenystx/helios-core/security/permission/QueuePermission";
export { TopicPermission } from "@zenystx/helios-core/security/permission/TopicPermission";
export { ListPermission } from "@zenystx/helios-core/security/permission/ListPermission";
export { SetPermission } from "@zenystx/helios-core/security/permission/SetPermission";
export { MultiMapPermission } from "@zenystx/helios-core/security/permission/MultiMapPermission";
export { ReplicatedMapPermission } from "@zenystx/helios-core/security/permission/ReplicatedMapPermission";
export { CachePermission } from "@zenystx/helios-core/security/permission/CachePermission";
export { LockPermission } from "@zenystx/helios-core/security/permission/LockPermission";
export { SemaphorePermission } from "@zenystx/helios-core/security/permission/SemaphorePermission";
export { AtomicLongPermission } from "@zenystx/helios-core/security/permission/AtomicLongPermission";
export { AtomicReferencePermission } from "@zenystx/helios-core/security/permission/AtomicReferencePermission";
export { CountDownLatchPermission } from "@zenystx/helios-core/security/permission/CountDownLatchPermission";
export { ExecutorServicePermission } from "@zenystx/helios-core/security/permission/ExecutorServicePermission";
export { FlakeIdGeneratorPermission } from "@zenystx/helios-core/security/permission/FlakeIdGeneratorPermission";
export { CardinalityEstimatorPermission } from "@zenystx/helios-core/security/permission/CardinalityEstimatorPermission";
export { ScheduledExecutorPermission } from "@zenystx/helios-core/security/permission/ScheduledExecutorPermission";
export { CPMapPermission } from "@zenystx/helios-core/security/permission/CPMapPermission";
// ── Security Config ───────────────────────────────────────────────────────────
export { SecurityConfig, PermissionConfig, PermissionType, TokenConfig } from "@zenystx/helios-core/config/SecurityConfig";

// ── Near-cache ────────────────────────────────────────────────────────────────
export type { NearCacheStats } from "@zenystx/helios-core/nearcache/NearCacheStats";
export { NearCachePreloader } from "@zenystx/helios-core/internal/nearcache/impl/preloader/NearCachePreloader";
export { NearCacheHandler } from "@zenystx/helios-core/rest/handler/NearCacheHandler";

// ── Query / Predicates ───────────────────────────────────────────────────────
export { Predicates } from "@zenystx/helios-core/query/Predicates";
export { PartitionPredicateImpl } from "@zenystx/helios-core/query/impl/predicates/PartitionPredicateImpl";
export { MultiPartitionPredicateImpl } from "@zenystx/helios-core/query/impl/predicates/MultiPartitionPredicateImpl";

// ── Projection ───────────────────────────────────────────────────────────────
export type { Projection } from "@zenystx/helios-core/projection/Projection";
export { Projections } from "@zenystx/helios-core/projection/Projections";

// ── REST API ─────────────────────────────────────────────────────────────────
export { HeliosRestServer } from "@zenystx/helios-core/rest/HeliosRestServer";
export { RestEndpointGroup } from "@zenystx/helios-core/rest/RestEndpointGroup";

// ── Discovery ────────────────────────────────────────────────────────────────
export { createDiscoveryResolver } from "@zenystx/helios-core/discovery/HeliosDiscovery";

// ── Multicast Discovery ──────────────────────────────────────────────────────
export { MulticastJoiner } from "@zenystx/helios-core/cluster/multicast/MulticastJoiner";
export type {
    MulticastJoinResult, MulticastJoinerConfig
} from "@zenystx/helios-core/cluster/multicast/MulticastJoiner";
export { MulticastService } from "@zenystx/helios-core/cluster/multicast/MulticastService";
export type {
    MulticastJoinMessage,
    MulticastJoinRequest, MulticastListener, MulticastMessage, MulticastSplitBrainMessage
} from "@zenystx/helios-core/cluster/multicast/MulticastService";

// ── Server / CLI ──────────────────────────────────────────────────────────────
export { HeliosServer } from "@zenystx/helios-core/server/HeliosServer";

// ── Extension ────────────────────────────────────────────────────────────────
export type { HeliosExtension, ExtensionContext, ExtensionLogger } from "@zenystx/helios-core/extension/HeliosExtension";

// ── Admin ────────────────────────────────────────────────────────────────────
export { AdminHandler } from "@zenystx/helios-core/rest/handler/AdminHandler";
export type { AdminOperationsProvider } from "@zenystx/helios-core/rest/handler/AdminHandler";

// ── Monitor (extended) ───────────────────────────────────────────────────────
export type { MonitorJobsProvider, MonitorJobSnapshot } from "@zenystx/helios-core/rest/handler/MonitorHandler";

// ── Job Metrics Serialization ────────────────────────────────────────────────
export { blitzJobMetricsToJSON, vertexMetricsToJSON } from "@zenystx/helios-core/job/metrics/BlitzJobMetrics";

// ── Version ───────────────────────────────────────────────────────────────────
export { MemberVersion } from "@zenystx/helios-core/version/MemberVersion";
export { Version } from "@zenystx/helios-core/version/Version";

// ── CP Subsystem ─────────────────────────────────────────────────────────────
export { CpSubsystemService } from "@zenystx/helios-core/cp/impl/CpSubsystemService";
export type { CpCommand, CpGroupState, CpSession, RaftLogEntry } from "@zenystx/helios-core/cp/impl/CpSubsystemService";
export { AtomicLongService } from "@zenystx/helios-core/cp/impl/AtomicLongService";
export { AtomicReferenceService } from "@zenystx/helios-core/cp/impl/AtomicReferenceService";
export { CountDownLatchService } from "@zenystx/helios-core/cp/impl/CountDownLatchService";
export { SemaphoreService } from "@zenystx/helios-core/cp/impl/SemaphoreService";
export type { CPMap } from "@zenystx/helios-core/cp/CPMap";
export { CPMapService } from "@zenystx/helios-core/cp/impl/CPMapService";

// ── CRDT ──────────────────────────────────────────────────────────────────────
export { PNCounterService } from "@zenystx/helios-core/crdt/impl/PNCounterService";
export type { PNCounterVectorState, ReplicaTimestampVector } from "@zenystx/helios-core/crdt/impl/PNCounterService";

// ── Flake ID Generator ────────────────────────────────────────────────────────
export { FlakeIdGeneratorService } from "@zenystx/helios-core/flakeid/impl/FlakeIdGeneratorService";
export type { FlakeIdBatch, FlakeIdGeneratorConfig } from "@zenystx/helios-core/flakeid/impl/FlakeIdGeneratorService";

// ── Cardinality Estimator ─────────────────────────────────────────────────────
export { DistributedCardinalityEstimatorService } from "@zenystx/helios-core/cardinality/impl/DistributedCardinalityEstimatorService";
export type { HllSnapshot } from "@zenystx/helios-core/cardinality/impl/DistributedCardinalityEstimatorService";
export { HyperLogLogImpl } from "@zenystx/helios-core/cardinality/impl/HyperLogLogImpl";
export type { HyperLogLog } from "@zenystx/helios-core/cardinality/HyperLogLog";

// ── Logging ───────────────────────────────────────────────────────────────────
export { LogLevel, type ILogger } from "@zenystx/helios-core/logging/Logger";
export { HeliosLogger } from "@zenystx/helios-core/logging/HeliosLogger";
export { LoggingService } from "@zenystx/helios-core/logging/LoggingService";

// ── Event Journal ─────────────────────────────────────────────────────────────
export { EventJournalConfig } from "@zenystx/helios-core/config/EventJournalConfig";
export { EventJournal } from "@zenystx/helios-core/internal/journal/EventJournal";
export { MapEventJournal } from "@zenystx/helios-core/internal/journal/MapEventJournal";
export { EventJournalEventType } from "@zenystx/helios-core/internal/journal/EventJournalEvent";
export type { EventJournalEvent } from "@zenystx/helios-core/internal/journal/EventJournalEvent";

// ── Split-Brain Merge ─────────────────────────────────────────────────────────
export type { SplitBrainMergePolicy } from "@zenystx/helios-core/spi/merge/SplitBrainMergePolicy";
export type { SplitBrainMergeData } from "@zenystx/helios-core/spi/merge/MergingValue";
export { MergePolicyProvider } from "@zenystx/helios-core/spi/merge/MergePolicyProvider";
export { PassThroughMergePolicy } from "@zenystx/helios-core/spi/merge/PassThroughMergePolicy";
export { PutIfAbsentMergePolicy } from "@zenystx/helios-core/spi/merge/PutIfAbsentMergePolicy";
export { HigherHitsMergePolicy } from "@zenystx/helios-core/spi/merge/HigherHitsMergePolicy";
export { LatestUpdateMergePolicy } from "@zenystx/helios-core/spi/merge/LatestUpdateMergePolicy";
export { LatestAccessMergePolicy } from "@zenystx/helios-core/spi/merge/LatestAccessMergePolicy";
export { ExpirationTimeMergePolicy } from "@zenystx/helios-core/spi/merge/ExpirationTimeMergePolicy";
export { DiscardMergePolicy } from "@zenystx/helios-core/spi/merge/DiscardMergePolicy";
export { HyperLogLogMergePolicy } from "@zenystx/helios-core/spi/merge/HyperLogLogMergePolicy";
export { SplitBrainMergeHandler } from "@zenystx/helios-core/internal/cluster/impl/SplitBrainMergeHandler";

// ── Persistence (Hot Restart / WAL) ──────────────────────────────────────────
export { PersistenceConfig } from "@zenystx/helios-core/config/PersistenceConfig";
export type { ClusterDataRecoveryPolicy } from "@zenystx/helios-core/config/PersistenceConfig";
export { PersistenceService } from "@zenystx/helios-core/persistence/PersistenceService";
export type { PersistenceRecoveryResult, PersistenceBackupResult, MapStoreAdapter } from "@zenystx/helios-core/persistence/PersistenceService";

// ── WAN Replication ───────────────────────────────────────────────────────────
export {
    WanReplicationConfig,
    WanBatchPublisherConfig,
    WanConsumerConfig,
    WanSyncConfig,
    WanQueueFullBehavior,
    WanAcknowledgeType,
    WanConsistencyCheckStrategy,
} from "@zenystx/helios-core/config/WanReplicationConfig";
export { WanReplicationRef } from "@zenystx/helios-core/config/WanReplicationRef";
export type { WanReplicationEvent } from "@zenystx/helios-core/wan/WanReplicationEvent";
export { WanReplicationService } from "@zenystx/helios-core/wan/impl/WanReplicationService";
export type { WanPublisherStatus } from "@zenystx/helios-core/wan/impl/WanReplicationService";
export { WanBatchPublisher, WanPublisherState } from "@zenystx/helios-core/wan/impl/WanBatchPublisher";
export { WanConsumerService } from "@zenystx/helios-core/wan/impl/WanConsumer";
export { WanSyncManager } from "@zenystx/helios-core/wan/impl/WanSyncManager";
export { MerkleTree, MerkleTreeNode } from "@zenystx/helios-core/wan/impl/MerkleTree";
export { WanReplicationEventQueue } from "@zenystx/helios-core/wan/impl/WanReplicationEventQueue";
export { WanHandler } from "@zenystx/helios-core/rest/handler/WanHandler";

// ── Partition ─────────────────────────────────────────────────────────────────
export type {
    MigrationListener,
    MigrationEvent,
    MigrationStatus,
} from "@zenystx/helios-core/internal/partition/MigrationListener";
export { ClientAddMigrationListenerCodec } from "@zenystx/helios-core/server/clientprotocol/codec/ClientAddMigrationListenerCodec";
export type {
    MigrationListenerRegistry,
    MigrationListenerEntry,
} from "@zenystx/helios-core/server/clientprotocol/handlers/ClientServiceHandlers";

// ── Durable Executor ──────────────────────────────────────────────────────────
export { DurableExecutorConfig } from "@zenystx/helios-core/config/DurableExecutorConfig";
export { DurableTaskRingbuffer } from "@zenystx/helios-core/durableexecutor/impl/DurableTaskRingbuffer";
export type { DurableTaskRecord } from "@zenystx/helios-core/durableexecutor/impl/DurableTaskRingbuffer";
export { DurableExecutorService, DURABLE_EXECUTOR_SERVICE_NAME } from "@zenystx/helios-core/durableexecutor/impl/DurableExecutorService";
export { DurableExecutorServiceProxy } from "@zenystx/helios-core/durableexecutor/impl/DurableExecutorServiceProxy";

// ── SPI / internal (public surface) ──────────────────────────────────────────
export { HeliosException } from "@zenystx/helios-core/core/exception/HeliosException";
