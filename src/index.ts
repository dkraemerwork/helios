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
export { ConfigValidationError, validateClientConfig, validateHeliosConfig } from "@zenystx/helios-core/config/ConfigValidator";
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
export { TcpIpConfig } from "@zenystx/helios-core/config/TcpIpConfig";
export { TopicConfig } from "@zenystx/helios-core/config/TopicConfig";
export { TcpTransportScatterConfig } from "@zenystx/helios-core/config/TcpTransportScatterConfig";

// ── Core / Instance ───────────────────────────────────────────────────────────
export type { DistributedObject } from "@zenystx/helios-core/core/DistributedObject";
export type { HeliosInstance } from "@zenystx/helios-core/core/HeliosInstance";
export type { InstanceConfig } from "@zenystx/helios-core/core/InstanceConfig";
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
export { MapProxy } from "@zenystx/helios-core/map/impl/MapProxy";
export { NetworkedMapProxy } from "@zenystx/helios-core/map/impl/NetworkedMapProxy";
export { MapKeyStream } from "@zenystx/helios-core/map/MapKeyStream";
export type { MapLoader } from "@zenystx/helios-core/map/MapLoader";
export type { MapLoaderLifecycleSupport } from "@zenystx/helios-core/map/MapLoaderLifecycleSupport";
export type { MapStore } from "@zenystx/helios-core/map/MapStore";
export type { MapStoreFactory } from "@zenystx/helios-core/map/MapStoreFactory";
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

// ── Cache / JCache ────────────────────────────────────────────────────────────
export { CACHE_MANAGER_PREFIX } from "@zenystx/helios-core/cache/HazelcastCacheManager";
export { CacheRecordStore } from "@zenystx/helios-core/cache/impl/CacheRecordStore";

// ── Transaction ───────────────────────────────────────────────────────────────
export { TransactionImpl } from "@zenystx/helios-core/transaction/impl/TransactionImpl";
export { TransactionManagerServiceImpl } from "@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl";
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
export type { MemberSelector } from "@zenystx/helios-core/cluster/MemberSelector";
export { MemberSelectors } from "@zenystx/helios-core/cluster/memberselector/MemberSelectors";

// ── Security ──────────────────────────────────────────────────────────────────
export type { Credentials } from "@zenystx/helios-core/security/Credentials";
export type { PasswordCredentials } from "@zenystx/helios-core/security/PasswordCredentials";
export { SimpleTokenCredentials } from "@zenystx/helios-core/security/SimpleTokenCredentials";
export type { TokenCredentials } from "@zenystx/helios-core/security/TokenCredentials";
export { UsernamePasswordCredentials } from "@zenystx/helios-core/security/UsernamePasswordCredentials";

// ── Near-cache ────────────────────────────────────────────────────────────────
export type { NearCacheStats } from "@zenystx/helios-core/nearcache/NearCacheStats";

// ── Query / Predicates ───────────────────────────────────────────────────────
export { Predicates } from "@zenystx/helios-core/query/Predicates";

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

// ── Remote Client ────────────────────────────────────────────────────────────
export { ClientConfig } from "@zenystx/helios-core/client/config/ClientConfig";
export { DEFERRED_CLIENT_FEATURES, HeliosClient } from "@zenystx/helios-core/client/HeliosClient";

// ── CP Subsystem ─────────────────────────────────────────────────────────────
export { CpSubsystemService } from "@zenystx/helios-core/cp/impl/CpSubsystemService";
export type { CpCommand, CpGroupState, CpSession, RaftLogEntry } from "@zenystx/helios-core/cp/impl/CpSubsystemService";
export { AtomicLongService } from "@zenystx/helios-core/cp/impl/AtomicLongService";
export { AtomicReferenceService } from "@zenystx/helios-core/cp/impl/AtomicReferenceService";
export { CountDownLatchService } from "@zenystx/helios-core/cp/impl/CountDownLatchService";
export { SemaphoreService } from "@zenystx/helios-core/cp/impl/SemaphoreService";

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

// ── SPI / internal (public surface) ──────────────────────────────────────────
export { HeliosException } from "@zenystx/helios-core/core/exception/HeliosException";
