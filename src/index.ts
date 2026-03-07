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
export { HeliosConfig } from "@zenystx/helios-core/config/HeliosConfig";
export { NetworkConfig } from "@zenystx/helios-core/config/NetworkConfig";
export { MapConfig } from "@zenystx/helios-core/config/MapConfig";
export { QueueConfig } from "@zenystx/helios-core/config/QueueConfig";
export { TopicConfig } from "@zenystx/helios-core/config/TopicConfig";
export { NearCacheConfig } from "@zenystx/helios-core/config/NearCacheConfig";
export { NearCachePreloaderConfig } from "@zenystx/helios-core/config/NearCachePreloaderConfig";
export { EvictionConfig } from "@zenystx/helios-core/config/EvictionConfig";
export { EvictionPolicy } from "@zenystx/helios-core/config/EvictionPolicy";
export { MaxSizePolicy } from "@zenystx/helios-core/config/MaxSizePolicy";
export { RingbufferConfig } from "@zenystx/helios-core/config/RingbufferConfig";
export { InMemoryFormat } from "@zenystx/helios-core/config/InMemoryFormat";
export { TcpIpConfig } from "@zenystx/helios-core/config/TcpIpConfig";
export { MulticastConfig } from "@zenystx/helios-core/config/MulticastConfig";
export { JoinConfig } from "@zenystx/helios-core/config/JoinConfig";
export { loadConfig } from "@zenystx/helios-core/config/ConfigLoader";
export type { HeliosBlitzRuntimeConfig } from "@zenystx/helios-core/config/BlitzRuntimeConfig";
export { resolveHeliosBlitzConfigFromEnv } from "@zenystx/helios-core/config/BlitzEnvHelper";

// ── Core / Instance ───────────────────────────────────────────────────────────
export type { HeliosInstance } from "@zenystx/helios-core/core/HeliosInstance";
export type { InstanceConfig } from "@zenystx/helios-core/core/InstanceConfig";
export { HeliosInstanceImpl } from "@zenystx/helios-core/instance/impl/HeliosInstanceImpl";
export { BuildInfo } from "@zenystx/helios-core/instance/BuildInfo";
export { BuildInfoProvider } from "@zenystx/helios-core/instance/BuildInfoProvider";
export { HeliosLifecycleService } from "@zenystx/helios-core/instance/lifecycle/HeliosLifecycleService";
export type { LifecycleService } from "@zenystx/helios-core/instance/lifecycle/LifecycleService";
export { LifecycleEvent } from "@zenystx/helios-core/instance/lifecycle/LifecycleEvent";
export type { LifecycleListener } from "@zenystx/helios-core/instance/lifecycle/LifecycleListener";
export type { DistributedObject } from "@zenystx/helios-core/core/DistributedObject";

// ── Map ───────────────────────────────────────────────────────────────────────
export type { IMap } from "@zenystx/helios-core/map/IMap";
export { MapProxy } from "@zenystx/helios-core/map/impl/MapProxy";
export { NetworkedMapProxy } from "@zenystx/helios-core/map/impl/NetworkedMapProxy";
export type { EntryListener } from "@zenystx/helios-core/map/EntryListener";
export type { EntryProcessor } from "@zenystx/helios-core/map/EntryProcessor";
export { QueryResultSizeExceededException } from "@zenystx/helios-core/map/QueryResultSizeExceededException";
export type { MapLoader } from "@zenystx/helios-core/map/MapLoader";
export type { MapStore } from "@zenystx/helios-core/map/MapStore";
export type { MapLoaderLifecycleSupport } from "@zenystx/helios-core/map/MapLoaderLifecycleSupport";
export type { MapStoreFactory } from "@zenystx/helios-core/map/MapStoreFactory";
export { MapKeyStream } from "@zenystx/helios-core/map/MapKeyStream";

// ── Collections ───────────────────────────────────────────────────────────────
export type { ICollection } from "@zenystx/helios-core/collection/ICollection";
export type { IQueue } from "@zenystx/helios-core/collection/IQueue";
export type { ItemListener } from "@zenystx/helios-core/collection/ItemListener";
export type { LocalQueueStats } from "@zenystx/helios-core/collection/LocalQueueStats";
export type { ISet } from "@zenystx/helios-core/collection/ISet";
export type { IList } from "@zenystx/helios-core/collection/IList";
export { QueueImpl } from "@zenystx/helios-core/collection/impl/QueueImpl";
export { SetImpl } from "@zenystx/helios-core/collection/impl/SetImpl";
export { ListImpl } from "@zenystx/helios-core/collection/impl/ListImpl";

// ── Topic ─────────────────────────────────────────────────────────────────────
export type { ITopic } from "@zenystx/helios-core/topic/ITopic";
export type { Message } from "@zenystx/helios-core/topic/Message";
export type { MessageListener } from "@zenystx/helios-core/topic/MessageListener";
export { TopicImpl } from "@zenystx/helios-core/topic/impl/TopicImpl";
export { ReliableTopicConfig, TopicOverloadPolicy } from "@zenystx/helios-core/config/ReliableTopicConfig";
export { TopicOverloadException } from "@zenystx/helios-core/topic/impl/reliable/ReliableTopicService";

// ── MultiMap ──────────────────────────────────────────────────────────────────
export type { MultiMap } from "@zenystx/helios-core/multimap/MultiMap";
export { MultiMapImpl } from "@zenystx/helios-core/multimap/impl/MultiMapImpl";

// ── ReplicatedMap ─────────────────────────────────────────────────────────────
export type { ReplicatedMap } from "@zenystx/helios-core/replicatedmap/ReplicatedMap";
export { ReplicatedMapImpl } from "@zenystx/helios-core/replicatedmap/impl/ReplicatedMapImpl";

// ── Ringbuffer ────────────────────────────────────────────────────────────────
export type { Ringbuffer } from "@zenystx/helios-core/ringbuffer/impl/Ringbuffer";
export { ArrayRingbuffer } from "@zenystx/helios-core/ringbuffer/impl/ArrayRingbuffer";
export { ReadResultSetImpl } from "@zenystx/helios-core/ringbuffer/impl/ReadResultSetImpl";
export { OverflowPolicy } from "@zenystx/helios-core/ringbuffer/OverflowPolicy";
export { StaleSequenceException } from "@zenystx/helios-core/ringbuffer/StaleSequenceException";

// ── Cache / JCache ────────────────────────────────────────────────────────────
export { CacheRecordStore } from "@zenystx/helios-core/cache/impl/CacheRecordStore";
export { CACHE_MANAGER_PREFIX } from "@zenystx/helios-core/cache/HazelcastCacheManager";

// ── Transaction ───────────────────────────────────────────────────────────────
export { TransactionOptions } from "@zenystx/helios-core/transaction/TransactionOptions";
export { TransactionException } from "@zenystx/helios-core/transaction/TransactionException";
export { TransactionTimedOutException } from "@zenystx/helios-core/transaction/TransactionTimedOutException";
export { TransactionNotActiveException } from "@zenystx/helios-core/transaction/TransactionNotActiveException";
export type { TransactionContext } from "@zenystx/helios-core/transaction/TransactionContext";
export { TransactionImpl } from "@zenystx/helios-core/transaction/impl/TransactionImpl";
export { TransactionManagerServiceImpl } from "@zenystx/helios-core/transaction/impl/TransactionManagerServiceImpl";

// ── Cluster ───────────────────────────────────────────────────────────────────
export { Address } from "@zenystx/helios-core/cluster/Address";
export type { Cluster } from "@zenystx/helios-core/cluster/Cluster";
export type { Member } from "@zenystx/helios-core/cluster/Member";
export { MemberImpl } from "@zenystx/helios-core/cluster/impl/MemberImpl";
export { MemberImplBuilder } from "@zenystx/helios-core/cluster/impl/MemberImpl";
export type { MemberSelector } from "@zenystx/helios-core/cluster/MemberSelector";
export { MemberSelectors } from "@zenystx/helios-core/cluster/memberselector/MemberSelectors";

// ── Security ──────────────────────────────────────────────────────────────────
export type { Credentials } from "@zenystx/helios-core/security/Credentials";
export type { PasswordCredentials } from "@zenystx/helios-core/security/PasswordCredentials";
export type { TokenCredentials } from "@zenystx/helios-core/security/TokenCredentials";
export { UsernamePasswordCredentials } from "@zenystx/helios-core/security/UsernamePasswordCredentials";
export { SimpleTokenCredentials } from "@zenystx/helios-core/security/SimpleTokenCredentials";

// ── Near-cache ────────────────────────────────────────────────────────────────
export type { NearCacheStats } from "@zenystx/helios-core/nearcache/NearCacheStats";

// ── Query / Predicates ───────────────────────────────────────────────────────
export { Predicates } from "@zenystx/helios-core/query/Predicates";

// ── REST API ─────────────────────────────────────────────────────────────────
export { HeliosRestServer } from "@zenystx/helios-core/rest/HeliosRestServer";
export { RestEndpointGroup } from "@zenystx/helios-core/rest/RestEndpointGroup";

// ── Discovery ────────────────────────────────────────────────────────────────
export { createDiscoveryResolver } from "@zenystx/helios-core/discovery/HeliosDiscovery";

// ── Server / CLI ──────────────────────────────────────────────────────────────
export { HeliosServer } from "@zenystx/helios-core/server/HeliosServer";

// ── Version ───────────────────────────────────────────────────────────────────
export { Version } from "@zenystx/helios-core/version/Version";
export { MemberVersion } from "@zenystx/helios-core/version/MemberVersion";

// ── Remote Client ────────────────────────────────────────────────────────────
export { HeliosClient, DEFERRED_CLIENT_FEATURES } from "@zenystx/helios-core/client/HeliosClient";
export { ClientConfig } from "@zenystx/helios-core/client/config/ClientConfig";

// ── SPI / internal (public surface) ──────────────────────────────────────────
export { HeliosException } from "@zenystx/helios-core/core/exception/HeliosException";
