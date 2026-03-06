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
export { Helios } from "@zenystx/core/Helios";

// ── Config ────────────────────────────────────────────────────────────────────
export { HeliosConfig } from "@zenystx/core/config/HeliosConfig";
export { NetworkConfig } from "@zenystx/core/config/NetworkConfig";
export { MapConfig } from "@zenystx/core/config/MapConfig";
export { QueueConfig } from "@zenystx/core/config/QueueConfig";
export { TopicConfig } from "@zenystx/core/config/TopicConfig";
export { NearCacheConfig } from "@zenystx/core/config/NearCacheConfig";
export { NearCachePreloaderConfig } from "@zenystx/core/config/NearCachePreloaderConfig";
export { EvictionConfig } from "@zenystx/core/config/EvictionConfig";
export { EvictionPolicy } from "@zenystx/core/config/EvictionPolicy";
export { MaxSizePolicy } from "@zenystx/core/config/MaxSizePolicy";
export { RingbufferConfig } from "@zenystx/core/config/RingbufferConfig";
export { InMemoryFormat } from "@zenystx/core/config/InMemoryFormat";
export { TcpIpConfig } from "@zenystx/core/config/TcpIpConfig";
export { MulticastConfig } from "@zenystx/core/config/MulticastConfig";
export { JoinConfig } from "@zenystx/core/config/JoinConfig";
export { loadConfig } from "@zenystx/core/config/ConfigLoader";

// ── Core / Instance ───────────────────────────────────────────────────────────
export type { HeliosInstance } from "@zenystx/core/core/HeliosInstance";
export { HeliosInstanceImpl } from "@zenystx/core/instance/impl/HeliosInstanceImpl";
export { BuildInfo } from "@zenystx/core/instance/BuildInfo";
export { BuildInfoProvider } from "@zenystx/core/instance/BuildInfoProvider";
export { HeliosLifecycleService } from "@zenystx/core/instance/lifecycle/HeliosLifecycleService";
export type { LifecycleService } from "@zenystx/core/instance/lifecycle/LifecycleService";
export { LifecycleEvent } from "@zenystx/core/instance/lifecycle/LifecycleEvent";
export type { LifecycleListener } from "@zenystx/core/instance/lifecycle/LifecycleListener";
export type { DistributedObject } from "@zenystx/core/core/DistributedObject";

// ── Map ───────────────────────────────────────────────────────────────────────
export type { IMap } from "@zenystx/core/map/IMap";
export { MapProxy } from "@zenystx/core/map/impl/MapProxy";
export { NetworkedMapProxy } from "@zenystx/core/map/impl/NetworkedMapProxy";
export type { EntryListener } from "@zenystx/core/map/EntryListener";
export type { EntryProcessor } from "@zenystx/core/map/EntryProcessor";
export { QueryResultSizeExceededException } from "@zenystx/core/map/QueryResultSizeExceededException";
export type { MapLoader } from "@zenystx/core/map/MapLoader";
export type { MapStore } from "@zenystx/core/map/MapStore";
export type { MapLoaderLifecycleSupport } from "@zenystx/core/map/MapLoaderLifecycleSupport";
export type { MapStoreFactory } from "@zenystx/core/map/MapStoreFactory";

// ── Collections ───────────────────────────────────────────────────────────────
export type { ICollection } from "@zenystx/core/collection/ICollection";
export type { IQueue } from "@zenystx/core/collection/IQueue";
export type { ItemListener } from "@zenystx/core/collection/ItemListener";
export type { LocalQueueStats } from "@zenystx/core/collection/LocalQueueStats";
export type { ISet } from "@zenystx/core/collection/ISet";
export type { IList } from "@zenystx/core/collection/IList";
export { QueueImpl } from "@zenystx/core/collection/impl/QueueImpl";
export { SetImpl } from "@zenystx/core/collection/impl/SetImpl";
export { ListImpl } from "@zenystx/core/collection/impl/ListImpl";

// ── Topic ─────────────────────────────────────────────────────────────────────
export type { ITopic } from "@zenystx/core/topic/ITopic";
export type { Message } from "@zenystx/core/topic/Message";
export type { MessageListener } from "@zenystx/core/topic/MessageListener";
export { TopicImpl } from "@zenystx/core/topic/impl/TopicImpl";

// ── MultiMap ──────────────────────────────────────────────────────────────────
export type { MultiMap } from "@zenystx/core/multimap/MultiMap";
export { MultiMapImpl } from "@zenystx/core/multimap/impl/MultiMapImpl";

// ── ReplicatedMap ─────────────────────────────────────────────────────────────
export type { ReplicatedMap } from "@zenystx/core/replicatedmap/ReplicatedMap";
export { ReplicatedMapImpl } from "@zenystx/core/replicatedmap/impl/ReplicatedMapImpl";

// ── Ringbuffer ────────────────────────────────────────────────────────────────
export type { Ringbuffer } from "@zenystx/core/ringbuffer/impl/Ringbuffer";
export { ArrayRingbuffer } from "@zenystx/core/ringbuffer/impl/ArrayRingbuffer";
export { ReadResultSetImpl } from "@zenystx/core/ringbuffer/impl/ReadResultSetImpl";
export { OverflowPolicy } from "@zenystx/core/ringbuffer/OverflowPolicy";
export { StaleSequenceException } from "@zenystx/core/ringbuffer/StaleSequenceException";

// ── Cache / JCache ────────────────────────────────────────────────────────────
export { CacheRecordStore } from "@zenystx/core/cache/impl/CacheRecordStore";
export { CACHE_MANAGER_PREFIX } from "@zenystx/core/cache/HazelcastCacheManager";

// ── Transaction ───────────────────────────────────────────────────────────────
export { TransactionOptions } from "@zenystx/core/transaction/TransactionOptions";
export { TransactionException } from "@zenystx/core/transaction/TransactionException";
export { TransactionTimedOutException } from "@zenystx/core/transaction/TransactionTimedOutException";
export { TransactionNotActiveException } from "@zenystx/core/transaction/TransactionNotActiveException";
export type { TransactionContext } from "@zenystx/core/transaction/TransactionContext";
export { TransactionImpl } from "@zenystx/core/transaction/impl/TransactionImpl";
export { TransactionManagerServiceImpl } from "@zenystx/core/transaction/impl/TransactionManagerServiceImpl";

// ── Cluster ───────────────────────────────────────────────────────────────────
export { Address } from "@zenystx/core/cluster/Address";
export type { Cluster } from "@zenystx/core/cluster/Cluster";
export type { Member } from "@zenystx/core/cluster/Member";
export { MemberImpl } from "@zenystx/core/cluster/impl/MemberImpl";
export { MemberImplBuilder } from "@zenystx/core/cluster/impl/MemberImpl";
export type { MemberSelector } from "@zenystx/core/cluster/MemberSelector";
export { MemberSelectors } from "@zenystx/core/cluster/memberselector/MemberSelectors";

// ── Security ──────────────────────────────────────────────────────────────────
export type { Credentials } from "@zenystx/core/security/Credentials";
export type { PasswordCredentials } from "@zenystx/core/security/PasswordCredentials";
export type { TokenCredentials } from "@zenystx/core/security/TokenCredentials";
export { UsernamePasswordCredentials } from "@zenystx/core/security/UsernamePasswordCredentials";
export { SimpleTokenCredentials } from "@zenystx/core/security/SimpleTokenCredentials";

// ── Near-cache ────────────────────────────────────────────────────────────────
export type { NearCacheStats } from "@zenystx/core/nearcache/NearCacheStats";

// ── Discovery ────────────────────────────────────────────────────────────────
export { createDiscoveryResolver } from "@zenystx/core/discovery/HeliosDiscovery";

// ── Server / CLI ──────────────────────────────────────────────────────────────
export { HeliosServer } from "@zenystx/core/server/HeliosServer";

// ── Version ───────────────────────────────────────────────────────────────────
export { Version } from "@zenystx/core/version/Version";
export { MemberVersion } from "@zenystx/core/version/MemberVersion";

// ── SPI / internal (public surface) ──────────────────────────────────────────
export { HeliosException } from "@zenystx/core/core/exception/HeliosException";
