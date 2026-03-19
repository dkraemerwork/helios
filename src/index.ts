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
export { applySystemPropertyOverrides, loadConfig } from "@zenystx/helios-core/config/ConfigLoader";
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
    ProbabilisticSplitBrainProtectionConfig,
    RecentlyActiveSplitBrainProtectionConfig, SplitBrainProtectionConfig, SplitBrainProtectionFunctionType, SplitBrainProtectionOn
} from "@zenystx/helios-core/config/SplitBrainProtectionConfig";
export { TcpIpConfig } from "@zenystx/helios-core/config/TcpIpConfig";
export { TcpTransportScatterConfig } from "@zenystx/helios-core/config/TcpTransportScatterConfig";
export { TopicConfig } from "@zenystx/helios-core/config/TopicConfig";
export { XmlConfigLoader, parseXml as parseXmlConfig } from "@zenystx/helios-core/config/XmlConfigLoader";

// ── Core / Instance ───────────────────────────────────────────────────────────
export type { DistributedObject } from "@zenystx/helios-core/core/DistributedObject";
export { SplitBrainProtectionException } from "@zenystx/helios-core/core/exception/SplitBrainProtectionException";
export type { HeliosInstance } from "@zenystx/helios-core/core/HeliosInstance";
export type { InstanceConfig } from "@zenystx/helios-core/core/InstanceConfig";
export { BuildInfo } from "@zenystx/helios-core/instance/BuildInfo";
export { BuildInfoProvider } from "@zenystx/helios-core/instance/BuildInfoProvider";
export { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
export { HeliosLifecycleService } from "@zenystx/helios-core/instance/lifecycle/HeliosLifecycleService";
export { LifecycleEvent } from "@zenystx/helios-core/instance/lifecycle/LifecycleEvent";
export type { LifecycleListener } from "@zenystx/helios-core/instance/lifecycle/LifecycleListener";
export type { LifecycleService } from "@zenystx/helios-core/instance/lifecycle/LifecycleService";
export { SplitBrainProtectionServiceImpl } from "@zenystx/helios-core/splitbrainprotection/impl/SplitBrainProtectionServiceImpl";

// ── Map ───────────────────────────────────────────────────────────────────────
export { QueryCacheConfig } from "@zenystx/helios-core/config/QueryCacheConfig";
export type { EntryListener } from "@zenystx/helios-core/map/EntryListener";
export type { EntryProcessor } from "@zenystx/helios-core/map/EntryProcessor";
export type { IMap } from "@zenystx/helios-core/map/IMap";
export { MapProxy } from "@zenystx/helios-core/map/impl/MapProxy";
export { NetworkedMapProxy } from "@zenystx/helios-core/map/impl/NetworkedMapProxy";
export type { MapInterceptor } from "@zenystx/helios-core/map/MapInterceptor";
export { MapKeyStream } from "@zenystx/helios-core/map/MapKeyStream";
export type { MapLoader } from "@zenystx/helios-core/map/MapLoader";
export type { MapLoaderLifecycleSupport } from "@zenystx/helios-core/map/MapLoaderLifecycleSupport";
export type { MapStore } from "@zenystx/helios-core/map/MapStore";
export type { MapStoreFactory } from "@zenystx/helios-core/map/MapStoreFactory";
export type { QueryCache, QueryCacheEntryListener } from "@zenystx/helios-core/map/QueryCache";
export { QueryResultSizeExceededException } from "@zenystx/helios-core/map/QueryResultSizeExceededException";

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
export { RingbufferStoreConfig } from "@zenystx/helios-core/config/RingbufferStoreConfig";
export { ArrayRingbuffer } from "@zenystx/helios-core/ringbuffer/impl/ArrayRingbuffer";
export { ReadResultSetImpl } from "@zenystx/helios-core/ringbuffer/impl/ReadResultSetImpl";
export type { Ringbuffer } from "@zenystx/helios-core/ringbuffer/impl/Ringbuffer";
export { OverflowPolicy } from "@zenystx/helios-core/ringbuffer/OverflowPolicy";
export type { RingbufferStore } from "@zenystx/helios-core/ringbuffer/RingbufferStore";
export type { RingbufferStoreFactory } from "@zenystx/helios-core/ringbuffer/RingbufferStoreFactory";
export { StaleSequenceException } from "@zenystx/helios-core/ringbuffer/StaleSequenceException";

// ── Cache / JCache ────────────────────────────────────────────────────────────
export { CACHE_MANAGER_PREFIX } from "@zenystx/helios-core/cache/HazelcastCacheManager";
export {
    CacheEntryEventType,
    type CacheEntryEvent,
    type CacheEntryListener,
    type CacheEntryListenerConfiguration
} from "@zenystx/helios-core/cache/impl/CacheEntryEvent";
export { CacheEntryProcessorExecutor } from "@zenystx/helios-core/cache/impl/CacheEntryProcessor";
export type {
    CacheEntryProcessor,
    MutableCacheEntry
} from "@zenystx/helios-core/cache/impl/CacheEntryProcessor";
export { CacheListenerRegistry } from "@zenystx/helios-core/cache/impl/CacheListenerRegistry";
export { CacheRecordStore } from "@zenystx/helios-core/cache/impl/CacheRecordStore";

// ── Transaction ───────────────────────────────────────────────────────────────
export { TransactionCoordinator } from "@zenystx/helios-core/transaction/impl/TransactionCoordinator";
export type { ManagedTransaction } from "@zenystx/helios-core/transaction/impl/TransactionCoordinator";
export { TransactionImpl } from "@zenystx/helios-core/transaction/impl/TransactionImpl";
export { TransactionManagerServiceImpl } from "@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl";
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
export { MemberSelectors } from "@zenystx/helios-core/cluster/memberselector/MemberSelectors";
export type {
    MemberAttributeEvent,
    MemberAttributeOperationType, MembershipEvent, MembershipListener
} from "@zenystx/helios-core/cluster/MembershipListener";

// ── Security ──────────────────────────────────────────────────────────────────
export { AccessControlException } from "@zenystx/helios-core/security/AccessControlException";
export type { Credentials } from "@zenystx/helios-core/security/Credentials";
export { AuthRateLimiter } from "@zenystx/helios-core/security/impl/AuthRateLimiter";
export type { AuthRateLimiterOptions } from "@zenystx/helios-core/security/impl/AuthRateLimiter";
export { SecurityContext } from "@zenystx/helios-core/security/impl/SecurityContext";
export { SecurityInterceptor } from "@zenystx/helios-core/security/impl/SecurityInterceptor";
export { TokenAuthenticator } from "@zenystx/helios-core/security/impl/TokenAuthenticator";
export type { PasswordCredentials } from "@zenystx/helios-core/security/PasswordCredentials";
export { SimpleTokenCredentials } from "@zenystx/helios-core/security/SimpleTokenCredentials";
export type { TokenCredentials } from "@zenystx/helios-core/security/TokenCredentials";
export { UsernamePasswordCredentials } from "@zenystx/helios-core/security/UsernamePasswordCredentials";
// ── Permission classes ────────────────────────────────────────────────────────
export { ActionConstants } from "@zenystx/helios-core/security/permission/ActionConstants";
export { AtomicLongPermission } from "@zenystx/helios-core/security/permission/AtomicLongPermission";
export { AtomicReferencePermission } from "@zenystx/helios-core/security/permission/AtomicReferencePermission";
export { CachePermission } from "@zenystx/helios-core/security/permission/CachePermission";
export { CardinalityEstimatorPermission } from "@zenystx/helios-core/security/permission/CardinalityEstimatorPermission";
export { ClusterPermission } from "@zenystx/helios-core/security/permission/ClusterPermission";
export { ClusterPermissionCollection } from "@zenystx/helios-core/security/permission/ClusterPermissionCollection";
export { CountDownLatchPermission } from "@zenystx/helios-core/security/permission/CountDownLatchPermission";
export { CPMapPermission } from "@zenystx/helios-core/security/permission/CPMapPermission";
export { ExecutorServicePermission } from "@zenystx/helios-core/security/permission/ExecutorServicePermission";
export { FlakeIdGeneratorPermission } from "@zenystx/helios-core/security/permission/FlakeIdGeneratorPermission";
export { ListPermission } from "@zenystx/helios-core/security/permission/ListPermission";
export { LockPermission } from "@zenystx/helios-core/security/permission/LockPermission";
export { MapPermission } from "@zenystx/helios-core/security/permission/MapPermission";
export { MultiMapPermission } from "@zenystx/helios-core/security/permission/MultiMapPermission";
export { QueuePermission } from "@zenystx/helios-core/security/permission/QueuePermission";
export { ReplicatedMapPermission } from "@zenystx/helios-core/security/permission/ReplicatedMapPermission";
export { ScheduledExecutorPermission } from "@zenystx/helios-core/security/permission/ScheduledExecutorPermission";
export { SemaphorePermission } from "@zenystx/helios-core/security/permission/SemaphorePermission";
export { SetPermission } from "@zenystx/helios-core/security/permission/SetPermission";
export { TopicPermission } from "@zenystx/helios-core/security/permission/TopicPermission";
// ── Security Config ───────────────────────────────────────────────────────────
export { PermissionConfig, PermissionType, SecurityConfig, TokenConfig } from "@zenystx/helios-core/config/SecurityConfig";

// ── Near-cache ────────────────────────────────────────────────────────────────
export { NearCachePreloader } from "@zenystx/helios-core/internal/nearcache/impl/preloader/NearCachePreloader";
export type { NearCacheStats } from "@zenystx/helios-core/nearcache/NearCacheStats";
export { NearCacheHandler } from "@zenystx/helios-core/rest/handler/NearCacheHandler";

// ── Query / Predicates ───────────────────────────────────────────────────────
export { MultiPartitionPredicateImpl } from "@zenystx/helios-core/query/impl/predicates/MultiPartitionPredicateImpl";
export { PartitionPredicateImpl } from "@zenystx/helios-core/query/impl/predicates/PartitionPredicateImpl";
export { Predicates } from "@zenystx/helios-core/query/Predicates";

// ── Projection ───────────────────────────────────────────────────────────────
export type { Projection } from "@zenystx/helios-core/projection/Projection";
export { Projections } from "@zenystx/helios-core/projection/Projections";

// ── REST API ─────────────────────────────────────────────────────────────────
export { HeliosRestServer } from "@zenystx/helios-core/rest/HeliosRestServer";
export { RestEndpointGroup } from "@zenystx/helios-core/rest/RestEndpointGroup";

// ── Discovery ────────────────────────────────────────────────────────────────
export { createDiscoveryResolver } from "@zenystx/helios-core/discovery/HeliosDiscovery";
export type {
    DiscoveryConfig,
    DiscoveryProvider, DiscoveryResolverOptions, HeliosDiscoveryResolver, MemberAddress
} from "@zenystx/helios-core/discovery/HeliosDiscovery";

// ── Discovery SPI ─────────────────────────────────────────────────────────────
export { toSpiDiscoveryStrategyConfig } from "@zenystx/helios-core/config/ConfigLoader";
export { DiscoveryService } from "@zenystx/helios-core/discovery/spi/DiscoveryService";
export { createDiscoveryService } from "@zenystx/helios-core/discovery/spi/DiscoveryServiceFactory";
export type {
    DiscoveredNode,
    DiscoveryStrategy, DiscoveryStrategyFactory, DiscoveryStrategyConfig as SpiDiscoveryStrategyConfig
} from "@zenystx/helios-core/discovery/spi/DiscoverySPI";

// ── Discovery SPI Adapters ────────────────────────────────────────────────────
export { AwsDiscoveryStrategy, AwsDiscoveryStrategyFactory } from "@zenystx/helios-core/discovery/spi/adapters/AwsDiscoveryStrategy";
export { AzureDiscoveryStrategy, AzureDiscoveryStrategyFactory } from "@zenystx/helios-core/discovery/spi/adapters/AzureDiscoveryStrategy";
export { GcpDiscoveryStrategy, GcpDiscoveryStrategyFactory } from "@zenystx/helios-core/discovery/spi/adapters/GcpDiscoveryStrategy";
export { KubernetesDiscoveryStrategy, KubernetesDiscoveryStrategyFactory } from "@zenystx/helios-core/discovery/spi/adapters/KubernetesDiscoveryStrategy";
export { StaticDiscoveryStrategy, StaticDiscoveryStrategyFactory } from "@zenystx/helios-core/discovery/spi/adapters/StaticDiscoveryStrategy";

// ── Auto-Detection ────────────────────────────────────────────────────────────
export { AutoDetectionService } from "@zenystx/helios-core/discovery/AutoDetectionService";
export type { CloudEnvironment } from "@zenystx/helios-core/discovery/AutoDetectionService";

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

// ── Load Balancer ─────────────────────────────────────────────────────────────
export {
    LoadBalancerType, RandomLoadBalancer, RoundRobinLoadBalancer, createLoadBalancer
} from "@zenystx/helios-core/server/clientprotocol/LoadBalancer";
export type { LoadBalancer } from "@zenystx/helios-core/server/clientprotocol/LoadBalancer";

// ── Server / CLI ──────────────────────────────────────────────────────────────
export { HeliosServer } from "@zenystx/helios-core/server/HeliosServer";

// ── Extension ────────────────────────────────────────────────────────────────
export type { ExtensionContext, ExtensionLogger, HeliosExtension } from "@zenystx/helios-core/extension/HeliosExtension";

// ── Admin ────────────────────────────────────────────────────────────────────
export { AdminHandler } from "@zenystx/helios-core/rest/handler/AdminHandler";
export type { AdminOperationsProvider } from "@zenystx/helios-core/rest/handler/AdminHandler";

// ── Monitor (extended) ───────────────────────────────────────────────────────
export type { MonitorJobSnapshot, MonitorJobsProvider } from "@zenystx/helios-core/rest/handler/MonitorHandler";

// ── Job Metrics Serialization ────────────────────────────────────────────────
export { blitzJobMetricsToJSON, vertexMetricsToJSON } from "@zenystx/helios-core/job/metrics/BlitzJobMetrics";

// ── Version ───────────────────────────────────────────────────────────────────
export { MemberVersion } from "@zenystx/helios-core/version/MemberVersion";
export { Version } from "@zenystx/helios-core/version/Version";

// ── CP Subsystem ─────────────────────────────────────────────────────────────
export type { CPMap } from "@zenystx/helios-core/cp/CPMap";
export { AtomicLongService } from "@zenystx/helios-core/cp/impl/AtomicLongService";
export { AtomicReferenceService } from "@zenystx/helios-core/cp/impl/AtomicReferenceService";
export { CountDownLatchService } from "@zenystx/helios-core/cp/impl/CountDownLatchService";
export { CPMapService } from "@zenystx/helios-core/cp/impl/CPMapService";
export { CpSubsystemService } from "@zenystx/helios-core/cp/impl/CpSubsystemService";
export type { CpCommand, CpGroupState, CpSession, RaftLogEntry } from "@zenystx/helios-core/cp/impl/CpSubsystemService";
export { SemaphoreService } from "@zenystx/helios-core/cp/impl/SemaphoreService";

// ── CRDT ──────────────────────────────────────────────────────────────────────
export { PNCounterService } from "@zenystx/helios-core/crdt/impl/PNCounterService";
export type { PNCounterVectorState, ReplicaTimestampVector } from "@zenystx/helios-core/crdt/impl/PNCounterService";

// ── Flake ID Generator ────────────────────────────────────────────────────────
export { FlakeIdGeneratorService } from "@zenystx/helios-core/flakeid/impl/FlakeIdGeneratorService";
export type { FlakeIdBatch, FlakeIdGeneratorConfig } from "@zenystx/helios-core/flakeid/impl/FlakeIdGeneratorService";

// ── Cardinality Estimator ─────────────────────────────────────────────────────
export type { HyperLogLog } from "@zenystx/helios-core/cardinality/HyperLogLog";
export { DistributedCardinalityEstimatorService } from "@zenystx/helios-core/cardinality/impl/DistributedCardinalityEstimatorService";
export type { HllSnapshot } from "@zenystx/helios-core/cardinality/impl/DistributedCardinalityEstimatorService";
export { HyperLogLogImpl } from "@zenystx/helios-core/cardinality/impl/HyperLogLogImpl";

// ── Logging ───────────────────────────────────────────────────────────────────
export { HeliosLogger } from "@zenystx/helios-core/logging/HeliosLogger";
export { LogLevel, type ILogger } from "@zenystx/helios-core/logging/Logger";
export { LoggingService } from "@zenystx/helios-core/logging/LoggingService";

// ── Event Journal ─────────────────────────────────────────────────────────────
export { EventJournalConfig } from "@zenystx/helios-core/config/EventJournalConfig";
export { EventJournal } from "@zenystx/helios-core/internal/journal/EventJournal";
export { EventJournalEventType } from "@zenystx/helios-core/internal/journal/EventJournalEvent";
export type { EventJournalEvent } from "@zenystx/helios-core/internal/journal/EventJournalEvent";
export { MapEventJournal } from "@zenystx/helios-core/internal/journal/MapEventJournal";

// ── Split-Brain Merge ─────────────────────────────────────────────────────────
export { SplitBrainMergeHandler } from "@zenystx/helios-core/internal/cluster/impl/SplitBrainMergeHandler";
export { DiscardMergePolicy } from "@zenystx/helios-core/spi/merge/DiscardMergePolicy";
export { ExpirationTimeMergePolicy } from "@zenystx/helios-core/spi/merge/ExpirationTimeMergePolicy";
export { HigherHitsMergePolicy } from "@zenystx/helios-core/spi/merge/HigherHitsMergePolicy";
export { HyperLogLogMergePolicy } from "@zenystx/helios-core/spi/merge/HyperLogLogMergePolicy";
export { LatestAccessMergePolicy } from "@zenystx/helios-core/spi/merge/LatestAccessMergePolicy";
export { LatestUpdateMergePolicy } from "@zenystx/helios-core/spi/merge/LatestUpdateMergePolicy";
export { MergePolicyProvider } from "@zenystx/helios-core/spi/merge/MergePolicyProvider";
export type { SplitBrainMergeData } from "@zenystx/helios-core/spi/merge/MergingValue";
export { PassThroughMergePolicy } from "@zenystx/helios-core/spi/merge/PassThroughMergePolicy";
export { PutIfAbsentMergePolicy } from "@zenystx/helios-core/spi/merge/PutIfAbsentMergePolicy";
export type { SplitBrainMergePolicy } from "@zenystx/helios-core/spi/merge/SplitBrainMergePolicy";

// ── Persistence (Hot Restart / WAL) ──────────────────────────────────────────
export { PersistenceConfig } from "@zenystx/helios-core/config/PersistenceConfig";
export type { ClusterDataRecoveryPolicy } from "@zenystx/helios-core/config/PersistenceConfig";
export { PersistenceService } from "@zenystx/helios-core/persistence/PersistenceService";
export type { MapStoreAdapter, PersistenceBackupResult, PersistenceRecoveryResult } from "@zenystx/helios-core/persistence/PersistenceService";

// ── WAN Replication ───────────────────────────────────────────────────────────
export {
    WanAcknowledgeType, WanBatchPublisherConfig, WanConsistencyCheckStrategy, WanConsumerConfig, WanQueueFullBehavior, WanReplicationConfig, WanSyncConfig
} from "@zenystx/helios-core/config/WanReplicationConfig";
export { WanReplicationRef } from "@zenystx/helios-core/config/WanReplicationRef";
export { WanHandler } from "@zenystx/helios-core/rest/handler/WanHandler";
export { MerkleTree, MerkleTreeNode } from "@zenystx/helios-core/wan/impl/MerkleTree";
export { WanBatchPublisher, WanPublisherState } from "@zenystx/helios-core/wan/impl/WanBatchPublisher";
export { WanConsumerService } from "@zenystx/helios-core/wan/impl/WanConsumer";
export { WanReplicationEventQueue } from "@zenystx/helios-core/wan/impl/WanReplicationEventQueue";
export { WanReplicationService } from "@zenystx/helios-core/wan/impl/WanReplicationService";
export type { WanPublisherStatus } from "@zenystx/helios-core/wan/impl/WanReplicationService";
export { WanSyncManager } from "@zenystx/helios-core/wan/impl/WanSyncManager";
export type { WanReplicationEvent } from "@zenystx/helios-core/wan/WanReplicationEvent";

// ── Partition ─────────────────────────────────────────────────────────────────
export type {
    MigrationEvent, MigrationListener, MigrationStatus
} from "@zenystx/helios-core/internal/partition/MigrationListener";
export { ClientAddMigrationListenerCodec } from "@zenystx/helios-core/server/clientprotocol/codec/ClientAddMigrationListenerCodec";
export type {
    MigrationListenerEntry, MigrationListenerRegistry
} from "@zenystx/helios-core/server/clientprotocol/handlers/ClientServiceHandlers";

// ── Durable Executor ──────────────────────────────────────────────────────────
export { DurableExecutorConfig } from "@zenystx/helios-core/config/DurableExecutorConfig";
export { DURABLE_EXECUTOR_SERVICE_NAME, DurableExecutorService } from "@zenystx/helios-core/durableexecutor/impl/DurableExecutorService";
export { DurableExecutorServiceProxy } from "@zenystx/helios-core/durableexecutor/impl/DurableExecutorServiceProxy";
export { DurableTaskRingbuffer } from "@zenystx/helios-core/durableexecutor/impl/DurableTaskRingbuffer";
export type { DurableTaskRecord } from "@zenystx/helios-core/durableexecutor/impl/DurableTaskRingbuffer";

// ── SPI / internal (public surface) ──────────────────────────────────────────
export { HeliosException } from "@zenystx/helios-core/core/exception/HeliosException";
