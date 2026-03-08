# Helios Defaults Inventory — hazelcast-client@5.6.x Compatibility

**Target:** `hazelcast-client@5.6.0` / Hazelcast OSS `5.5.0`  
**Audit date:** 2026-03-08  

Status legend:
- **ALIGNED** — Helios uses the same default as Hazelcast
- **MISALIGNED** — Helios default differs from Hazelcast; this may cause compatibility bugs
- **MISSING** — Default exists in Hazelcast but the corresponding feature is not implemented in Helios
- **CUSTOM** — Helios intentionally uses a different default (documented below)

---

## 1. Cluster / Network Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Member port | `5701` | `5701` | `HeliosInstanceImpl.parseMemberAddress` | ALIGNED |
| Client port (member-side listener) | `5701` (shared by default) | Configurable, 0 = disabled | `ClientProtocolServer` | CUSTOM — Helios uses a separate port |
| Partition count | `271` | `271` | `HeliosInstanceImpl`, `ClusterProperty.PARTITION_COUNT` | ALIGNED |
| Max backup replica count | `6` | `20` | `PartitionReplicaManager(271, 20)` | MISALIGNED — Helios uses 20, HZ uses 6 |
| Cluster name (default) | `"dev"` | Configurable, no baked-in default | `HeliosConfig` | ALIGNED (user must set) |
| Network interface bind all | `true` | `true` (host defaults to `0.0.0.0`) | `ClientProtocolServer` | ALIGNED |
| Multicast enabled | `true` (default discovery) | Optional, disabled by default | `HeliosConfig.tcpIp` | MISALIGNED — Hazelcast defaults to multicast, Helios defaults to tcp-ip |
| Multicast group | `224.2.2.3` | `224.2.2.3` | `MulticastService` | ALIGNED |
| Multicast port | `54327` | `54327` | `MulticastService` | ALIGNED |
| Multicast TTL | `32` | Not configured | `MulticastService` | MISSING |
| Join timeout (ms) | `300_000` (5 min) | Not enforced | — | MISSING |

---

## 2. Client Connection Defaults

| Parameter | Hazelcast Client Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Connection timeout (ms) | `5_000` | `5_000` | `ClientNetworkConfig._connectionTimeout` | ALIGNED |
| Connection attempt limit | `2` | Not limited (unlimited retry) | `ClientNetworkConfig` | MISALIGNED — HZ gives up after 2 attempts, Helios retries indefinitely |
| Connection attempt period (ms) | `3_000` | `1_000` initial backoff | `ConnectionRetryConfig._initialBackoffMillis` | MISALIGNED |
| Retry initial backoff (ms) | `1_000` | `1_000` | `ConnectionRetryConfig._initialBackoffMillis` | ALIGNED |
| Retry max backoff (ms) | `30_000` | `30_000` | `ConnectionRetryConfig._maxBackoffMillis` | ALIGNED |
| Retry backoff multiplier | `1.05` | `1.05` | `ConnectionRetryConfig._multiplier` | ALIGNED |
| Retry cluster connect timeout (ms) | `20_000` | `-1` (infinite) | `ConnectionRetryConfig._clusterConnectTimeoutMillis` | MISALIGNED |
| Retry jitter | `0` | `0` | `ConnectionRetryConfig._jitter` | ALIGNED |
| Redo operation | `false` | `false` | `ClientNetworkConfig._redoOperation` | ALIGNED |
| Smart routing | `true` | PARTIAL (no full partition-owner routing) | `ClientConnectionManager` | MISALIGNED |

---

## 3. Heartbeat Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Client heartbeat interval (ms) | `5_000` | `5_000` | `CompatibilityTarget.DEFAULT_CLIENT_HEARTBEAT_INTERVAL_MS` | ALIGNED |
| Client heartbeat timeout (ms) | `60_000` | `60_000` | `ClientProtocolServer._heartbeatTimeoutMs` | ALIGNED |
| Server heartbeat interval (ms) | `5_000` | `10_000` | `ClientProtocolServer._heartbeatIntervalMs` | MISALIGNED — Helios checks every 10s not 5s |
| Member heartbeat timeout (ms) | `60_000` | `60_000` | `ClusterHeartbeatManager` | ALIGNED |

---

## 4. Invocation / Operation Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Invocation timeout (ms) | `120_000` | `10_000` (REMOTE_OPERATION_TIMEOUT_MS) | `HeliosInstanceImpl` | MISALIGNED — Helios uses 10s vs HZ's 120s |
| Backup ack timeout (ms) | `1_500` | `1_500` | `REMOTE_BACKUP_ACK_TIMEOUT_MS` | ALIGNED |
| Invocation sweep interval (ms) | `1_000` | `1_000` | `INVOCATION_SWEEP_INTERVAL_MS` | ALIGNED |
| Remote peer connect timeout (ms) | N/A (member) | `500` | `REMOTE_PEER_CONNECT_TIMEOUT_MS` | CUSTOM |
| Max concurrent invocations per partition | `100` | `100` | `BackpressureConfig.DEFAULT_MAX_CONCURRENT_INVOCATIONS_PER_PARTITION` | ALIGNED |
| Backpressure sync window | `100` | `100` | `BackpressureConfig.DEFAULT_SYNC_WINDOW` | ALIGNED |
| Backpressure backoff timeout (ms) | `60_000` | `60_000` | `BackpressureConfig.DEFAULT_BACKOFF_TIMEOUT_MS` | ALIGNED |
| Backpressure enabled | `true` | `true` | `BackpressureConfig._enabled` | ALIGNED |

---

## 5. IMap Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Backup count | `1` | `0` (in-memory, no wire backups) | `MapConfig` | MISALIGNED |
| Async backup count | `0` | `0` | `MapConfig` | ALIGNED |
| Max size (entries) | `0` (unlimited) | `0` (unlimited) | `MapConfig` | ALIGNED |
| Time to live (seconds) | `0` (no TTL) | `0` / `-1` (no TTL) | `MapProxy.put` TTL field | ALIGNED |
| Max idle (seconds) | `0` (no idle expiry) | Not enforced | `MapProxy` | MISSING |
| Eviction policy | `NONE` | `NONE` | — | ALIGNED |
| In-memory format | `BINARY` | `BINARY` | `MapContainerService` | ALIGNED |
| Read backup data | `false` | `false` | — | ALIGNED |
| Cache deserialized values | `INDEX_ONLY` | Not configurable | — | MISSING |
| Merge policy | `PutIfAbsentMergePolicy` | Not implemented | — | MISSING |
| Statistics enabled | `true` | PARTIAL | `LocalMapStatsProvider` | PARTIAL |
| Per-entry statistics | `false` | `false` | — | ALIGNED |
| MapStore initial mode | `LAZY` | `LAZY` | `MapStoreContext` | ALIGNED |
| MapStore write delay (s) | `0` (write-through) | Configurable | `MapStoreConfig` | ALIGNED |
| MapStore batch size | `1` | `1` (write-through) | `WriteThroughStore` | ALIGNED |
| Write-behind batch size | `1000` | Configurable | `WriteBehindStore` | ALIGNED |
| Near cache enabled | `false` | Opt-in via config | `NearCacheConfig` | ALIGNED |
| Near cache invalidation | `true` | PARTIAL | `NearCachedIMapWrapper` | PARTIAL |
| Index type default | `HASH` | `HASH` | `IndexConfig` | ALIGNED |

---

## 6. IQueue Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Max size (0 = unlimited) | `0` | `0` | `QueueImpl._maxSize` | ALIGNED |
| Backup count | `1` | `0` | — | MISALIGNED |
| Async backup count | `0` | `0` | — | ALIGNED |
| Empty poll operations | counted in stats | DONE | `QueueImpl._emptyPollOperationCount` | ALIGNED |
| Statistics enabled | `true` | DONE | `QueueImpl.getLocalQueueStats()` | ALIGNED |
| Queue item TTL (no default) | N/A | N/A | — | N/A |

---

## 7. ITopic Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Global ordering enabled | `false` | `false` | `DistributedTopicService` | ALIGNED |
| Statistics enabled | `true` | PARTIAL | `LocalTopicStats` | PARTIAL |
| Multi-threading enabled | `false` | `false` (single eventloop) | — | ALIGNED |

---

## 8. ReliableTopic Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Topic overload policy | `BLOCK` | PARTIAL | `ReliableTopicProxyImpl` | PARTIAL |
| Read batch size | `10` | `10` | `ReliableTopicProxyImpl` | ALIGNED |
| Statistics enabled | `true` | PARTIAL | — | PARTIAL |
| Backing Ringbuffer name | `_hz_rb_<topicName>` | `_hz_rb_<topicName>` | `RingbufferService.TOPIC_RB_PREFIX` | ALIGNED |

---

## 9. Ringbuffer Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Capacity | `10_000` | `10_000` | `RingbufferConfig.DEFAULT_CAPACITY` | ALIGNED |
| Backup count | `1` | `1` | `RingbufferConfig.DEFAULT_BACKUP_COUNT` | ALIGNED |
| Async backup count | `0` | `0` | `RingbufferConfig.DEFAULT_ASYNC_BACKUP_COUNT` | ALIGNED |
| Time to live (seconds, 0 = no TTL) | `0` | `0` | `RingbufferConfig.DEFAULT_TTL_SECONDS` | ALIGNED |
| In-memory format | `BINARY` | `BINARY` | `RingbufferConfig.DEFAULT_IN_MEMORY_FORMAT` | ALIGNED |
| Overflow policy | `OVERWRITE` | `OVERWRITE` | `OverflowPolicy` | ALIGNED |

---

## 10. MultiMap Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Value collection type | `SET` | `SET` | `MultiMapConfig.ValueCollectionType` | ALIGNED |
| Backup count | `1` | `0` | — | MISALIGNED |
| Async backup count | `0` | `0` | — | ALIGNED |
| Statistics enabled | `true` | `false` | — | MISALIGNED |
| Binary | `false` | `false` | — | ALIGNED |

---

## 11. ReplicatedMap Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Replication delay (ms) | `100` | Not applicable (single-node) | — | CUSTOM |
| Async fill-up | `true` | N/A | — | MISSING |
| In-memory format | `OBJECT` | `OBJECT` | `ReplicatedMapImpl` | ALIGNED |
| Statistics enabled | `true` | `false` | — | MISALIGNED |
| Merge policy | `PutIfAbsentMergePolicy` | Not implemented | — | MISSING |

---

## 12. ICache / JCache Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Backup count | `1` | `0` | — | MISALIGNED |
| Async backup count | `0` | `0` | — | ALIGNED |
| Statistics enabled | `false` | `false` | — | ALIGNED |
| Management enabled | `false` | `false` | — | ALIGNED |
| Read through | `false` | `false` | — | ALIGNED |
| Write through | `false` | `false` | — | ALIGNED |
| Store by value | `true` | `true` | — | ALIGNED |
| Eviction max size | `10_000` | `10_000` | `EntryCountCacheEvictionChecker` | ALIGNED |
| Eviction policy | `LRU` | PARTIAL | — | PARTIAL |
| Near cache enabled | `false` | `false` (opt-in) | `NearCachedClientCacheProxy` | ALIGNED |

---

## 13. Near Cache Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| In-memory format | `BINARY` | `BINARY` | `NearCacheConfig` | ALIGNED |
| Max size (0 = unlimited) | `10_000` | `10_000` | `NearCacheConfig` | ALIGNED |
| Eviction policy | `LRU` | `LRU` | `NearCacheConfig` | ALIGNED |
| Time to live (seconds, 0 = no TTL) | `0` | `0` | `NearCacheConfig` | ALIGNED |
| Max idle (seconds, 0 = disabled) | `0` | `0` | `NearCacheConfig` | ALIGNED |
| Cache local entries | `false` | `false` | `NearCacheConfig` | ALIGNED |
| Invalidate on change | `true` | PARTIAL | `NearCachedIMapWrapper` | PARTIAL |
| Preloader enabled | `false` | `false` | `NearCachePreloaderConfig` | ALIGNED |
| Preloader store initial delay (s) | `600` | `600` | `NearCachePreloaderConfig` | ALIGNED |
| Preloader store interval (s) | `600` | `600` | `NearCachePreloaderConfig` | ALIGNED |

---

## 14. ExecutorService Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Pool size (threads) | `16` | `min(16, hardwareConcurrency)` | `ExecutorConfig` | ALIGNED |
| Queue capacity | `0` (unbounded) | `1024` | `ExecutorConfig.DEFAULT_QUEUE_CAPACITY` | MISALIGNED |
| Statistics enabled | `true` | `true` | `ExecutorConfig` | ALIGNED |
| Task timeout (ms) | N/A (no default timeout) | `300_000` | `ExecutorConfig.DEFAULT_TASK_TIMEOUT_MILLIS` | CUSTOM |
| Shutdown timeout (ms) | N/A | `10_000` | `ExecutorConfig.DEFAULT_SHUTDOWN_TIMEOUT_MILLIS` | CUSTOM |
| Durability | `1` | `1` | — | ALIGNED |

---

## 15. ScheduledExecutorService Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Pool size | `16` | `16` | `ScheduledExecutorConfig` | ALIGNED |
| Capacity (tasks per partition) | `100` | `100` | `ScheduledExecutorConfig` | ALIGNED |
| Capacity policy | `PER_NODE` | `PER_NODE` | `ScheduledExecutorConfig` | ALIGNED |
| Durability | `1` | `1` | `ScheduledExecutorConfig` | ALIGNED |
| Statistics enabled | `true` | `true` | `ScheduledExecutorConfig` | ALIGNED |
| Schedule shutdown policy | `GRACEFUL_TRANSFER` | `GRACEFUL_TRANSFER` | `ScheduledExecutorConfig` | ALIGNED |
| Max history entries per task | `100` | `100` | `ScheduledExecutorConfig` | ALIGNED |
| Auto-disposable tasks | `false` | configurable per-task | `ScheduledExecutorSubmitToPartitionCodec` | ALIGNED |

---

## 16. Serialization Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Serialization version | `1` | `1` | `ClientProtocolServer._serializationVersion` | ALIGNED |
| Default portable version | `0` | `0` | — | ALIGNED |
| Use native byte order | `false` | `false` (always little-endian LE) | `FixedSizeTypesCodec` | ALIGNED |
| Allow unsafe serialization | `false` | N/A | — | N/A |
| Check class def errors | `true` | N/A | — | MISSING |
| Java serialization filter | configurable | N/A | — | MISSING |
| Default Java serializer enabled | `true` | `false` | — | MISALIGNED |

---

## 17. Partition / Replication Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Partition count | `271` | `271` | `ClusterProperty.PARTITION_COUNT` | ALIGNED |
| Max backup count | `6` | `20` | `PartitionReplicaManager(271, 20)` | MISALIGNED |
| Anti-entropy period (ms) | N/A (background task) | continuous | `AntiEntropyTask` | ALIGNED |
| Migration retry delay (ms) | `3_000` | managed by migration manager | `MigrationManager` | ALIGNED |
| Partition table version | `0` initially | `0` | `PartitionStateManager` | ALIGNED |

---

## 18. Query / Index Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Query result size limit | `-1` (unlimited) | `-1` | `ClusterProperty.QUERY_RESULT_SIZE_LIMIT` | ALIGNED |
| Max local partitions for pre-check | `3` | `3` | `ClusterProperty.QUERY_MAX_LOCAL_PARTITION_LIMIT_FOR_PRE_CHECK` | ALIGNED |
| Index type (default) | `HASH` | `HASH` | `IndexConfig` | ALIGNED |
| Global index | `false` | `false` | — | ALIGNED |
| Bitmap index options | available | not implemented | — | MISSING |

---

## 19. Authentication Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Cluster name required | yes | yes | `ClientProtocolServer` | ALIGNED |
| Username/password | null (no auth) | null (no auth default) | `ClientProtocolServerOptions.auth` | ALIGNED |
| Token credentials | not required by default | not implemented | — | MISSING |
| Certificate authentication | not required by default | not implemented | — | MISSING |
| Kerberos | not required by default | not implemented | — | MISSING |

---

## 20. Lifecycle / State Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Initial cluster state | `ACTIVE` | `ACTIVE` | `ClusterStateManager` | ALIGNED |
| Graceful shutdown timeout (s) | `600` | No timeout limit | `HeliosInstanceImpl.shutdown` | MISALIGNED |
| Restart mode | disabled | disabled | — | ALIGNED |
| Hot restart (persistence) | disabled | not implemented | — | MISSING |

---

## 21. Logging Defaults

| Parameter | Hazelcast Default | Helios Value | Source | Status |
|---|---|---|---|---|
| Log level | `INFO` | `INFO` | `HeliosInstanceImpl._logLevel` | ALIGNED |
| Log implementation | `JDK` (Java) / console (Node) | console (Bun) | — | ALIGNED |

---

## Summary of Misalignments

The following misalignments are most likely to cause compatibility bugs with real `hazelcast-client@5.6.x` clients:

| # | Parameter | Hazelcast | Helios | Risk |
|---|---|---|---|---|
| 1 | Max backup replica count | 6 | 20 | LOW (internal only) |
| 2 | Invocation timeout | 120s | 10s | **HIGH** — client operations may time out prematurely |
| 3 | Connection attempt limit | 2 | unlimited | MEDIUM — can hang on unreachable cluster |
| 4 | Retry cluster connect timeout | 20s | -1 (infinite) | MEDIUM — no failsafe |
| 5 | Discovery default | multicast | tcp-ip | MEDIUM — cluster may not form automatically |
| 6 | Server heartbeat check interval | 5s | 10s | LOW — stale sessions linger longer |
| 7 | Map backup count | 1 | 0 | MEDIUM — no durability on member failure |
| 8 | Queue backup count | 1 | 0 | MEDIUM — no durability on member failure |
| 9 | Executor queue capacity | unbounded | 1024 | MEDIUM — early rejection possible |
| 10 | Java serializer enabled | true | false | LOW (different platform) |
| 11 | Graceful shutdown timeout | 600s | none | LOW |
| 12 | Smart routing | true | partial | MEDIUM — routing to wrong member |
