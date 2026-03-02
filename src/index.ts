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
export { Helios } from '@helios/Helios';

// ── Config ────────────────────────────────────────────────────────────────────
export { HeliosConfig } from '@helios/config/HeliosConfig';
export { NetworkConfig } from '@helios/config/NetworkConfig';
export { MapConfig } from '@helios/config/MapConfig';
export { NearCacheConfig } from '@helios/config/NearCacheConfig';
export { NearCachePreloaderConfig } from '@helios/config/NearCachePreloaderConfig';
export { EvictionConfig } from '@helios/config/EvictionConfig';
export { EvictionPolicy } from '@helios/config/EvictionPolicy';
export { MaxSizePolicy } from '@helios/config/MaxSizePolicy';
export { RingbufferConfig } from '@helios/config/RingbufferConfig';
export { InMemoryFormat } from '@helios/config/InMemoryFormat';
export { TcpIpConfig } from '@helios/config/TcpIpConfig';
export { MulticastConfig } from '@helios/config/MulticastConfig';
export { JoinConfig } from '@helios/config/JoinConfig';
export { loadConfig } from '@helios/config/ConfigLoader';

// ── Core / Instance ───────────────────────────────────────────────────────────
export type { HeliosInstance } from '@helios/core/HeliosInstance';
export { HeliosInstanceImpl } from '@helios/instance/impl/HeliosInstanceImpl';
export { BuildInfo } from '@helios/instance/BuildInfo';
export { BuildInfoProvider } from '@helios/instance/BuildInfoProvider';
export { HeliosLifecycleService } from '@helios/instance/lifecycle/HeliosLifecycleService';
export type { LifecycleService } from '@helios/instance/lifecycle/LifecycleService';
export { LifecycleEvent } from '@helios/instance/lifecycle/LifecycleEvent';
export type { LifecycleListener } from '@helios/instance/lifecycle/LifecycleListener';
export type { DistributedObject } from '@helios/core/DistributedObject';

// ── Map ───────────────────────────────────────────────────────────────────────
export type { IMap } from '@helios/map/IMap';
export { MapProxy } from '@helios/map/impl/MapProxy';
export { NetworkedMapProxy } from '@helios/map/impl/NetworkedMapProxy';
export type { EntryListener } from '@helios/map/EntryListener';
export type { EntryProcessor } from '@helios/map/EntryProcessor';
export { QueryResultSizeExceededException } from '@helios/map/QueryResultSizeExceededException';
export type { MapLoader } from '@helios/map/MapLoader';
export type { MapStore } from '@helios/map/MapStore';
export type { MapLoaderLifecycleSupport } from '@helios/map/MapLoaderLifecycleSupport';
export type { MapStoreFactory } from '@helios/map/MapStoreFactory';

// ── Collections ───────────────────────────────────────────────────────────────
export type { ICollection } from '@helios/collection/ICollection';
export type { IQueue } from '@helios/collection/IQueue';
export type { ISet } from '@helios/collection/ISet';
export type { IList } from '@helios/collection/IList';
export { QueueImpl } from '@helios/collection/impl/QueueImpl';
export { SetImpl } from '@helios/collection/impl/SetImpl';
export { ListImpl } from '@helios/collection/impl/ListImpl';

// ── Topic ─────────────────────────────────────────────────────────────────────
export type { ITopic } from '@helios/topic/ITopic';
export type { Message } from '@helios/topic/Message';
export type { MessageListener } from '@helios/topic/MessageListener';
export { TopicImpl } from '@helios/topic/impl/TopicImpl';

// ── MultiMap ──────────────────────────────────────────────────────────────────
export type { MultiMap } from '@helios/multimap/MultiMap';
export { MultiMapImpl } from '@helios/multimap/impl/MultiMapImpl';

// ── ReplicatedMap ─────────────────────────────────────────────────────────────
export type { ReplicatedMap } from '@helios/replicatedmap/ReplicatedMap';
export { ReplicatedMapImpl } from '@helios/replicatedmap/impl/ReplicatedMapImpl';

// ── Ringbuffer ────────────────────────────────────────────────────────────────
export type { Ringbuffer } from '@helios/ringbuffer/impl/Ringbuffer';
export { ArrayRingbuffer } from '@helios/ringbuffer/impl/ArrayRingbuffer';
export { ReadResultSetImpl } from '@helios/ringbuffer/impl/ReadResultSetImpl';
export { OverflowPolicy } from '@helios/ringbuffer/OverflowPolicy';
export { StaleSequenceException } from '@helios/ringbuffer/StaleSequenceException';

// ── Cache / JCache ────────────────────────────────────────────────────────────
export { CacheRecordStore } from '@helios/cache/impl/CacheRecordStore';
export { CACHE_MANAGER_PREFIX } from '@helios/cache/HazelcastCacheManager';

// ── Transaction ───────────────────────────────────────────────────────────────
export { TransactionOptions } from '@helios/transaction/TransactionOptions';
export { TransactionException } from '@helios/transaction/TransactionException';
export { TransactionTimedOutException } from '@helios/transaction/TransactionTimedOutException';
export { TransactionNotActiveException } from '@helios/transaction/TransactionNotActiveException';
export type { TransactionContext } from '@helios/transaction/TransactionContext';
export { TransactionImpl } from '@helios/transaction/impl/TransactionImpl';
export { TransactionManagerServiceImpl } from '@helios/transaction/impl/TransactionManagerServiceImpl';

// ── Cluster ───────────────────────────────────────────────────────────────────
export { Address } from '@helios/cluster/Address';
export type { Cluster } from '@helios/cluster/Cluster';
export type { Member } from '@helios/cluster/Member';
export { MemberImpl } from '@helios/cluster/impl/MemberImpl';
export { MemberImplBuilder } from '@helios/cluster/impl/MemberImpl';
export type { MemberSelector } from '@helios/cluster/MemberSelector';
export { MemberSelectors } from '@helios/cluster/memberselector/MemberSelectors';

// ── Security ──────────────────────────────────────────────────────────────────
export type { Credentials } from '@helios/security/Credentials';
export type { PasswordCredentials } from '@helios/security/PasswordCredentials';
export type { TokenCredentials } from '@helios/security/TokenCredentials';
export { UsernamePasswordCredentials } from '@helios/security/UsernamePasswordCredentials';
export { SimpleTokenCredentials } from '@helios/security/SimpleTokenCredentials';

// ── Near-cache ────────────────────────────────────────────────────────────────
export type { NearCacheStats } from '@helios/nearcache/NearCacheStats';

// ── Discovery ────────────────────────────────────────────────────────────────
export { createDiscoveryResolver } from '@helios/discovery/HeliosDiscovery';

// ── Server / CLI ──────────────────────────────────────────────────────────────
export { HeliosServer } from '@helios/server/HeliosServer';

// ── Version ───────────────────────────────────────────────────────────────────
export { Version } from '@helios/version/Version';
export { MemberVersion } from '@helios/version/MemberVersion';

// ── SPI / internal (public surface) ──────────────────────────────────────────
export { HeliosException } from '@helios/core/exception/HeliosException';
