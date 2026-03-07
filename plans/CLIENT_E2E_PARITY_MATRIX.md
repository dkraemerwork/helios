## Helios Client Parity Matrix

Control document for `plans/CLIENT_E2E_PARITY_PLAN.md` and `plans/CLIENT_E2E_EXECUTION_BACKLOG.md`.

Topic dependency note:

- `getTopic()` and `getReliableTopic()` client status is gated by Phase 19T in `plans/TYPESCRIPT_PORT_PLAN.md`

Legend:

- `implemented`: remotely usable today end to end
- `planned`: intended for remote client GA, but work remains
- `blocked-by-server`: client cannot honestly complete until member/runtime capability exists
- `unsupported-by-design`: intentionally outside scope for OSS Helios client parity

---

## 1. `HeliosInstance` Contract Matrix

| `HeliosInstance` method | Helios TS owner | Hazelcast anchor | Status | Server/runtime prerequisite | Acceptance owner |
| --- | --- | --- | --- | --- | --- |
| `getName()` | `src/client/HeliosClient.ts` | `HazelcastInstance.getName()` | planned | client instance identity and lifecycle | client startup suite |
| `getMap()` | `src/client/proxy/ClientMapProxy.ts` | `ClientMapProxy` | planned | member-side binary protocol map ops, listeners, destroy, metadata fetch | map e2e suite |
| `getQueue()` | `src/client/proxy/ClientQueueProxy.ts` | `ClientQueueProxy` | planned | queue protocol ops, event/listener path, reconnect-safe semantics | queue e2e suite |
| `getList()` | `src/client/proxy/ClientListProxy.ts` | `ClientListProxy` | blocked-by-server | real distributed list semantics, not local `ListImpl` only | list e2e suite |
| `getSet()` | `src/client/proxy/ClientSetProxy.ts` | `ClientSetProxy` | blocked-by-server | real distributed set semantics, not local `SetImpl` only | set e2e suite |
| `getTopic()` | `src/client/proxy/ClientTopicProxy.ts` | `ClientTopicProxy` | planned | Phase 19T classic-topic closure plus topic publish/listener protocol and reconnect re-registration | topic e2e suite |
| `getReliableTopic()` | `src/client/proxy/ClientReliableTopicProxy.ts` | `ClientReliableTopicProxy` | blocked-by-server | Phase 19T reliable-topic server runtime and protocol ownership must land first | reliable-topic e2e suite |
| `getMultiMap()` | `src/client/proxy/ClientMultiMapProxy.ts` | `ClientMultiMap` | blocked-by-server | multimap distributed member semantics and protocol handlers | multimap e2e suite |
| `getReplicatedMap()` | `src/client/proxy/ClientReplicatedMapProxy.ts` | `ClientReplicatedMapProxy` | blocked-by-server | replicated-map runtime beyond current local subset | replicated-map e2e suite |
| `getDistributedObject()` | `src/client/impl/spi/ProxyManager.ts` | `ProxyManager` | planned | distributed-object create/list/destroy tasks and stable service-name mapping | proxy-manager e2e suite |
| `getLifecycleService()` | `src/client/impl/client/LifecycleServiceImpl.ts` | `LifecycleServiceImpl` | planned | client lifecycle wiring and reconnect/shutdown events | lifecycle e2e suite |
| `getCluster()` | `src/client/impl/spi/ClientClusterService.ts` | `ClientClusterServiceImpl` | planned | member-list fetch, cluster-view refresh, listener delivery | cluster-view e2e suite |
| `getConfig()` | `src/client/config/ClientConfig.ts` plus contract decision | `ClientConfig` | blocked-by-contract | `HeliosInstance` currently returns `HeliosConfig`; remote client needs a shared contract decision | contract review suite |
| `getExecutorService()` | `src/client/proxy/ClientExecutorServiceProxy.ts` | `ClientExecutorServiceProxy` | blocked-by-server | remote callable protocol, serialization, member execution semantics | executor e2e suite |
| `shutdown()` | `src/client/HeliosClient.ts` | `HazelcastClient.shutdown()` | planned | connection teardown, listener cleanup, proxy cleanup, lifecycle events | shutdown e2e suite |

---

## 2. Cross-Cutting Client Runtime Matrix

| Subsystem | Helios TS owner | Hazelcast anchor | Status | Main prerequisite |
| --- | --- | --- | --- | --- |
| Public client entrypoint | `src/client/HeliosClient.ts` | `HazelcastClient` | planned | shared contract finalization |
| Client runtime/composition | `src/client/impl/client/HeliosClientInstanceImpl.ts` | `HazelcastClientInstanceImpl` | planned | config, serialization, connection manager |
| Public facade | `src/client/impl/client/HeliosClientProxy.ts` | `HazelcastClientProxy` | planned | runtime + proxy manager |
| Client lifecycle service | `src/client/impl/client/LifecycleServiceImpl.ts` | `LifecycleServiceImpl` | planned | runtime event wiring |
| Connection manager | `src/client/connection/ClientConnectionManager.ts` | `TcpClientConnectionManager` | planned | member-side client protocol server |
| Connection abstraction | `src/client/connection/ClientConnection.ts` | `ClientConnection` | planned | socket transport and auth/session support |
| Invocation core | `src/client/impl/spi/ClientInvocation.ts` | `ClientInvocation` | planned | correlation IDs and retry rules |
| Invocation service | `src/client/impl/spi/ClientInvocationService.ts` | `ClientInvocationServiceImpl` | planned | connection manager + error model |
| Partition service | `src/client/impl/spi/ClientPartitionService.ts` | `ClientPartitionServiceImpl` | planned | partition-table protocol tasks |
| Cluster service | `src/client/impl/spi/ClientClusterService.ts` | `ClientClusterServiceImpl` | planned | member-list and cluster-view tasks |
| Listener service | `src/client/impl/spi/ClientListenerService.ts` | `ClientListenerServiceImpl` | planned | event push from member side |
| Proxy manager | `src/client/impl/spi/ProxyManager.ts` | `ProxyManager` | planned | create/destroy/list tasks |
| Client proxy base | `src/client/impl/spi/ClientProxy.ts` | `ClientProxy` | planned | proxy manager + invocation service |
| Client statistics | `src/client/impl/statistics/ClientStatisticsService.ts` | `ClientStatisticsService` | planned | client metrics config and reporting path |

---

## 3. Config Matrix

| Config surface | Helios TS owner | Hazelcast anchor | Status | Notes |
| --- | --- | --- | --- | --- |
| Root client config | `src/client/config/ClientConfig.ts` | `ClientConfig` | planned | current file is near-cache-only and must be rewritten |
| Network config | `src/client/config/ClientNetworkConfig.ts` | `ClientNetworkConfig` | planned | addresses, bootstrap, connection options |
| Connection strategy | `src/client/config/ClientConnectionStrategyConfig.ts` | `ClientConnectionStrategyConfig` | planned | reconnect mode, async start semantics |
| Retry config | `src/client/config/ConnectionRetryConfig.ts` | `ConnectionRetryConfig` | planned | timeout/backoff policy |
| Security config | `src/client/config/ClientSecurityConfig.ts` | `ClientSecurityConfig` | planned | credentials and cluster identity |
| Metrics config | `src/client/config/ClientMetricsConfig.ts` | `ClientMetricsConfig` | planned | fail fast if unsupported sections are configured |
| Failover config | `src/client/config/ClientFailoverConfig.ts` | `ClientFailoverConfig` | planned | runtime support may lag config surface |
| SQL config | `src/client/config/ClientSqlConfig.ts` | `ClientSqlConfig` | blocked-by-server | only if SQL runtime lands |
| Routing config | `src/client/config/ClusterRoutingConfig.ts` | `ClusterRoutingConfig` | planned | may need reduced scope |
| Socket options | `src/client/config/SocketOptions.ts` | `SocketOptions` | planned | only if actually enforced by Bun transport |

---

## 4. Existing `src/client` File Fate Matrix

| File/group | Fate | Future owner | Reason |
| --- | --- | --- | --- |
| `src/client/impl/protocol/ClientMessage.ts` | keep | protocol core | real framing primitive |
| `src/client/impl/protocol/ClientMessageReader.ts` | keep | protocol core | real framing primitive |
| `src/client/impl/protocol/ClientMessageWriter.ts` | keep | protocol core | real framing primitive |
| `src/client/impl/protocol/util/*` | keep | protocol core | retained if used by live transport |
| `src/client/impl/protocol/AuthenticationStatus.ts` | keep | connection/auth | authentication status constants |
| `src/client/impl/protocol/exception/*` | keep | protocol core | protocol error types |
| `src/client/impl/protocol/codec/ClientAuthenticationCodec.ts` | keep | connection/auth | required for auth handshake |
| `src/client/impl/protocol/codec/MapPutCodec.ts` | keep | proxy or service owner | retained map operation codec |
| `src/client/impl/protocol/codec/MapAddEntryListenerCodec.ts` | keep | proxy or service owner | retained map listener codec |
| `src/client/impl/protocol/codec/MapAddNearCacheInvalidationListenerCodec.ts` | keep | near-cache | retained near-cache invalidation codec |
| `src/client/impl/protocol/codec/MapFetchNearCacheInvalidationMetadataCodec.ts` | keep | near-cache | retained near-cache metadata codec |
| `src/client/impl/protocol/codec/CacheAddNearCacheInvalidationListenerCodec.ts` | keep | near-cache | retained cache near-cache invalidation codec |
| `src/client/impl/protocol/codec/CacheFetchNearCacheInvalidationMetadataCodec.ts` | keep | near-cache | retained cache near-cache metadata codec |
| `src/client/impl/protocol/codec/builtin/*` | keep | protocol core | builtin type codec helpers used by all operation codecs |
| `src/client/impl/protocol/codec/custom/*` | keep | protocol core | custom type codec helpers for Address, MemberInfo, etc. |
| `src/client/HeliosClient.ts` | keep | client entrypoint | public client product surface |
| `src/client/config/ClientConfig.ts` | rewrite | config root | currently too narrow |
| `src/client/map/impl/nearcache/NearCachedClientMapProxy.ts` | rewrite | near-cache on top of remote map proxy | currently in-process backing-store shaped |
| `src/client/cache/impl/nearcache/NearCachedClientCacheProxy.ts` | rewrite | near-cache on top of remote cache proxy | currently in-process backing-store shaped |
| `src/client/map/impl/nearcache/invalidation/ClientMapInvalidationMetaDataFetcher.ts` | rewrite | near-cache metadata fetch path | must call binary protocol, not in-process objects |
| `src/client/cache/impl/nearcache/invalidation/ClientCacheInvalidationMetaDataFetcher.ts` | rewrite | near-cache metadata fetch path | must call binary protocol, not in-process objects |
| `src/client/impl/statistics/NearCacheMetricsProvider.ts` | keep | statistics | valid if connected to real client runtime |
| `src/client/impl/protocol/task/map/MapFetchNearCacheInvalidationMetadataTask.ts` | move | `src/server/clientprotocol/task/map/` | member-side handler, not client runtime |
| `src/client/impl/protocol/task/cache/CacheFetchNearCacheInvalidationMetadataTask.ts` | move | `src/server/clientprotocol/task/cache/` | member-side handler, not client runtime |
| `src/client/config/ClientNetworkConfig.ts` | keep | config | network config for remote client |
| `src/client/config/ClientConnectionStrategyConfig.ts` | keep | config | connection strategy config |
| `src/client/config/ConnectionRetryConfig.ts` | keep | config | exponential backoff retry config |
| `src/client/config/ClientSecurityConfig.ts` | keep | config | security/credentials config |
| `src/client/config/ClientFailoverConfig.ts` | keep | config | multi-cluster failover config |
| `src/client/config/ClientConfigLoader.ts` | keep | config | JSON/YAML client config loading |
| `src/client/impl/lifecycle/ClientLifecycleService.ts` | keep | lifecycle | client lifecycle management |
| `src/client/impl/serialization/ClientSerializationService.ts` | keep | serialization | client serialization owner factory |

---

## 5. Advanced And Secondary Surface Matrix

| Surface | Helios TS owner | Hazelcast anchor | Status | Prerequisite |
| --- | --- | --- | --- | --- |
| Near-cached map | `src/client/map/impl/nearcache/NearCachedClientMapProxy.ts` | `NearCachedClientMapProxy` | planned | live map proxy + listener service + metadata fetch |
| Near-cached cache | `src/client/cache/impl/nearcache/NearCachedClientCacheProxy.ts` | `NearCachedClientCacheProxy` | blocked-by-server | honest client cache runtime and binary protocol support |
| Query cache | `src/client/map/impl/querycache/**/*` | Hazelcast query-cache subscriber stack | blocked-by-server | server query-cache runtime absent |
| Transactions | `src/client/proxy/txn/**/*` | transaction proxies | blocked-by-server | cluster-safe transaction semantics |
| JCache client | `src/client/cache/**/*` | client cache manager/proxy | blocked-by-server | server cache capability audit and protocol support |
| SQL client | `src/client/sql/**/*` | `SqlClientService` | blocked-by-server | SQL runtime not releaseable today |
| Reliable topic client | `src/client/proxy/ClientReliableTopicProxy.ts` | `ClientReliableTopicProxy` | blocked-by-server | Phase 19T reliable-topic runtime absent server-side until checkpoint is green |
| PN counter client | `src/client/proxy/ClientPNCounterProxy.ts` | `ClientPNCounterProxy` | blocked-by-server | server runtime absent |
| Flake ID client | `src/client/proxy/ClientFlakeIdGeneratorProxy.ts` | `ClientFlakeIdGeneratorProxy` | blocked-by-server | server runtime absent |
| Scheduled executor client | `src/client/proxy/ClientScheduledExecutorProxy.ts` | scheduled executor proxy | blocked-by-server | server runtime absent |
| CP client | n/a | CP subsystem client surface | unsupported-by-design | Helios server runtime absent; OSS parity can reject clearly |

---

## 6. Packaging Matrix

| Surface | Owner | Status | Required change |
| --- | --- | --- | --- |
| Root export `.` | `src/index.ts` | planned | add `HeliosClient` and client config only when real |
| `./server` subpath | `package.json` | implemented | keep explicit |
| wildcard `./*` export | `package.json` | must-change | remove or narrow to prevent internal client leakage |
| internal test/support access | `package.json` | planned | add explicit internal/test-only subpath if truly needed |

---

## 7. Immediate Red Flags

- `HeliosInstance.getConfig()` currently returns `HeliosConfig` in `src/core/HeliosInstance.ts`, which is a member config type, not a remote client config type.
- `HeliosInstanceImpl.getReliableTopic()` already throws a not-implemented error in `src/instance/impl/HeliosInstanceImpl.ts`, so the shared contract remains blocked until Phase 19T removes the stub and lands the real server/runtime path.
- `HeliosInstanceImpl.getList()`, `getSet()`, `getMultiMap()`, and `getReplicatedMap()` currently instantiate local in-memory structures, which is incompatible with honest remote parity.
- `HeliosInstanceImpl.getDistributedObject()` currently returns partial no-op wrappers for some services only.
- `package.json` wildcard exports make unfinished internal client code accidentally package-public today.
