## Helios Client Parity Matrix

Historical archive for the removed proprietary `HeliosClient` product surface.

Current supported remote boundary is the server-side client protocol plus interoperability with pinned official `hazelcast-client@5.6.0`; this file no longer defines active release claims.

Topic dependency note:

- the Phase 19T checkpoint in `plans/TYPESCRIPT_PORT_PLAN.md` is green, so classic `getTopic()` can be marked implemented; `getReliableTopic()` remains `NOT-RETAINED` because the remote client surface was intentionally narrowed out

Legend:

- `implemented`: remotely usable today end to end
- `planned`: intended for remote client GA, but work remains
- `blocked-by-server`: client cannot honestly complete until member/runtime capability exists
- `NOT-RETAINED`: intentionally removed from the retained remote-client surface even if a member-only API still exists
- `unsupported-by-design`: intentionally outside scope for OSS Helios client parity

---

## 1. `HeliosInstance` Contract Matrix

Block 20.5 audit: `HeliosInstance` has been narrowed to only methods with real distributed
server-side runtime. `getList()`, `getSet()`, `getMultiMap()`, and `getReplicatedMap()` have
been removed from the shared contract and remain as member-only methods on `HeliosInstanceImpl`.

| `HeliosInstance` method | Helios TS owner | Hazelcast anchor | Status | Server/runtime prerequisite | Acceptance owner |
| --- | --- | --- | --- | --- | --- |
| `getName()` | `src/client/HeliosClient.ts` | `HazelcastInstance.getName()` | implemented | — | `test/client/e2e/ClientStartupE2E.test.ts` |
| `getMap()` | `src/client/proxy/ClientMapProxy.ts` | `ClientMapProxy` | implemented | retained binary-protocol map proxy, destroy path, and listener/metadata support are live | `test/client/e2e/ClientMapE2E.test.ts` |
| `getQueue()` | `src/client/proxy/ClientQueueProxy.ts` | `ClientQueueProxy` | implemented | retained binary-protocol queue proxy and core queue semantics are live | `test/client/e2e/ClientQueueE2E.test.ts` |
| `getTopic()` | `src/client/proxy/ClientTopicProxy.ts` | `ClientTopicProxy` | implemented | retained binary-protocol topic publish/listener flow and reconnect re-registration are live | `test/client/e2e/ClientTopicE2E.test.ts`, `test/client/e2e/ClientReconnectListenerRecoveryE2E.test.ts` |
| `getDistributedObject()` | `src/client/proxy/ProxyManager.ts` | `ProxyManager` | implemented | distributed-object create/list/destroy tasks and stable service-name mapping are live | `test/client/e2e/ClientProxyLifecycleE2E.test.ts` |
| `getLifecycleService()` | `src/client/impl/lifecycle/ClientLifecycleService.ts` | `LifecycleServiceImpl` | implemented | — | `test/client/e2e/ClientStartupE2E.test.ts` |
| `getCluster()` | `src/client/spi/ClientClusterService.ts` | `ClientClusterServiceImpl` | implemented | member-list fetch and cluster-view refresh are live on the retained client runtime | `test/client/e2e/ClientStartupE2E.test.ts` |
| `getConfig()` | `src/client/config/ClientConfig.ts` | `ClientConfig` | implemented | `InstanceConfig` shared contract resolves type mismatch | `test/client/Block20_2_ClientApiConfigSerialization.test.ts` |
| `shutdown()` | `src/client/HeliosClient.ts` | `HazelcastClient.shutdown()` | implemented | — | `test/client/e2e/ClientStartupE2E.test.ts` |

### Narrowed-out methods (member-only on `HeliosInstanceImpl`)

| Method | Reason for narrowing | Member-side status |
| --- | --- | --- |
| `getReliableTopic()` | NOT-RETAINED — no server-side reliable-topic protocol handler; client proxy had fake listener codec | works on member, not part of shared contract |
| `getExecutorService()` | NOT-RETAINED — no server-side executor protocol handler; client proxy was empty stub | works on member, not part of shared contract |
| `getList()` | Local-only `ListImpl`, no distributed `ListService` | works on member, not part of shared contract |
| `getSet()` | Local-only `SetImpl`, no distributed `SetService` | works on member, not part of shared contract |
| `getMultiMap()` | Local-only `MultiMapImpl`, no distributed `MultiMapService` | works on member, not part of shared contract |
| `getReplicatedMap()` | Local-only `ReplicatedMapImpl`, no replication runtime | works on member, not part of shared contract |

---

## 2. Cross-Cutting Client Runtime Matrix

| Subsystem | Helios TS owner | Hazelcast anchor | Status | Main prerequisite | Proof owner |
| --- | --- | --- | --- | --- | --- |
| Public client entrypoint | `src/client/HeliosClient.ts` | `HazelcastClient` | implemented | retained remote client product surface | `test/client/e2e/ClientStartupE2E.test.ts` |
| Client lifecycle service | `src/client/impl/lifecycle/ClientLifecycleService.ts` | `LifecycleServiceImpl` | implemented | runtime event wiring is live | `test/client/e2e/ClientStartupE2E.test.ts` |
| Connection manager | `src/client/connection/ClientConnectionManager.ts` | `TcpClientConnectionManager` | implemented | member-side client protocol server is live and exercised end to end | `test/client/Block20_4_ClientConnectionInvocationServices.test.ts`, `test/client/e2e/ClientStartupE2E.test.ts` |
| Connection abstraction | `src/client/connection/ClientConnection.ts` | `ClientConnection` | implemented | socket transport and auth/session support back the retained runtime | `test/client/Block20_4_ClientConnectionInvocationServices.test.ts` |
| Invocation core | `src/client/invocation/ClientInvocation.ts` | `ClientInvocation` | implemented | correlation IDs and retry rules back retained proxy calls | `test/client/Block20_4_ClientConnectionInvocationServices.test.ts`, `test/client/e2e/ClientMapE2E.test.ts` |
| Invocation service | `src/client/invocation/ClientInvocationService.ts` | `ClientInvocationServiceImpl` | implemented | retained request execution sits on the real connection/error model | `test/client/Block20_4_ClientConnectionInvocationServices.test.ts` |
| Partition service | `src/client/spi/ClientPartitionService.ts` | `ClientPartitionServiceImpl` | implemented | partition-table protocol tasks are live in the retained runtime | `test/client/Block20_4_ClientConnectionInvocationServices.test.ts` |
| Cluster service | `src/client/spi/ClientClusterService.ts` | `ClientClusterServiceImpl` | implemented | member-list and cluster-view tasks are live in the retained runtime | `test/client/Block20_4_ClientConnectionInvocationServices.test.ts`, `test/client/e2e/ClientStartupE2E.test.ts` |
| Listener service | `src/client/spi/ClientListenerService.ts` | `ClientListenerServiceImpl` | implemented | event push and reconnect listener recovery are live | `test/client/Block20_4_ClientConnectionInvocationServices.test.ts`, `test/client/e2e/ClientReconnectListenerRecoveryE2E.test.ts` |
| Proxy manager | `src/client/proxy/ProxyManager.ts` | `ProxyManager` | implemented | create/destroy/list tasks are live | `test/client/Block20_6_ProxyManagerDistributedObjectProxies.test.ts`, `test/client/e2e/ClientProxyLifecycleE2E.test.ts` |
| Client proxy base | `src/client/proxy/ClientProxy.ts` | `ClientProxy` | implemented | retained proxy base is exercised by the live proxy stack | `test/client/Block20_6_ProxyManagerDistributedObjectProxies.test.ts`, `test/client/e2e/ClientMapE2E.test.ts` |
| Near-cache metrics | `src/client/impl/statistics/NearCacheMetricsProvider.ts` | client metrics helpers | implemented | retained metrics emission path exists for retained near-cache surfaces | `test/client/Block20_7_NearCacheAdvancedFeatureClosure.test.ts`, `test/client/impl/statistics/NearCacheMetricsProvider.test.ts` |

---

## 3. Config Matrix

| Config surface | Helios TS owner | Hazelcast anchor | Status | Notes | Proof owner |
| --- | --- | --- | --- | --- | --- |
| Root client config | `src/client/config/ClientConfig.ts` | `ClientConfig` | implemented | retained public config entrypoint | `test/client/Block20_2_ClientApiConfigSerialization.test.ts` |
| Network config | `src/client/config/ClientNetworkConfig.ts` | `ClientNetworkConfig` | implemented | addresses, bootstrap, and connection options are retained today | `test/client/Block20_2_ClientApiConfigSerialization.test.ts` |
| Connection strategy | `src/client/config/ClientConnectionStrategyConfig.ts` | `ClientConnectionStrategyConfig` | implemented | reconnect mode and async start semantics are retained today | `test/client/Block20_2_ClientApiConfigSerialization.test.ts` |
| Retry config | `src/client/config/ConnectionRetryConfig.ts` | `ConnectionRetryConfig` | implemented | timeout/backoff policy is retained today | `test/client/Block20_2_ClientApiConfigSerialization.test.ts` |
| Security config | `src/client/config/ClientSecurityConfig.ts` | `ClientSecurityConfig` | implemented | credentials and cluster identity config are retained today | `test/client/Block20_2_ClientApiConfigSerialization.test.ts` |
| Failover config | `src/client/config/ClientFailoverConfig.ts` | `ClientFailoverConfig` | implemented | retained config surface exists even though multi-cluster runtime failover is not claimed here | `test/client/Block20_2_ClientApiConfigSerialization.test.ts` |
| Config loader | `src/client/config/ClientConfigLoader.ts` | client XML/YAML/JSON loader surface | implemented | loader support is retained for the current supported client fields | `test/client/Block20_2_ClientApiConfigSerialization.test.ts` |

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
| `src/client/impl/protocol/codec/MapSizeCodec.ts` | keep | proxy | map size operation codec |
| `src/client/impl/protocol/codec/MapGetCodec.ts` | keep | proxy | map get operation codec |
| `src/client/impl/protocol/codec/MapSetCodec.ts` | keep | proxy | map set operation codec |
| `src/client/impl/protocol/codec/MapRemoveCodec.ts` | keep | proxy | map remove operation codec |
| `src/client/impl/protocol/codec/MapClearCodec.ts` | keep | proxy | map clear operation codec |
| `src/client/impl/protocol/codec/MapContainsKeyCodec.ts` | keep | proxy | map containsKey operation codec |
| `src/client/impl/protocol/codec/MapDeleteCodec.ts` | keep | proxy | map delete operation codec |
| `src/client/impl/protocol/codec/QueueClearCodec.ts` | keep | proxy | queue clear operation codec |
| `src/client/impl/protocol/codec/QueueOfferCodec.ts` | keep | proxy | queue offer operation codec |
| `src/client/impl/protocol/codec/QueuePollCodec.ts` | keep | proxy | queue poll operation codec |
| `src/client/impl/protocol/codec/QueuePeekCodec.ts` | keep | proxy | queue peek operation codec |
| `src/client/impl/protocol/codec/QueueSizeCodec.ts` | keep | proxy | queue size operation codec |
| `src/client/impl/protocol/codec/TopicPublishCodec.ts` | keep | proxy | topic publish operation codec |
| `src/client/impl/protocol/codec/TopicAddMessageListenerCodec.ts` | keep | proxy/listener service | retained topic listener registration codec |
| `src/client/impl/protocol/codec/TopicRemoveMessageListenerCodec.ts` | keep | proxy/listener service | retained topic listener deregistration codec |
| `src/client/impl/protocol/codec/ClientGetDistributedObjectsCodec.ts` | keep | proxy | distributed objects listing codec |
| `src/client/impl/protocol/codec/ClientDestroyProxyCodec.ts` | keep | proxy | proxy destroy operation codec |
| `src/client/impl/protocol/codec/ClientCreateProxyCodec.ts` | keep | proxy | proxy create operation codec |
| `src/client/impl/protocol/codec/ScheduledExecutorSubmitToPartitionCodec.ts` | keep | scheduled executor | submit-to-partition operation codec |
| `src/client/impl/protocol/codec/ScheduledExecutorSubmitToMemberCodec.ts` | keep | scheduled executor | submit-to-member operation codec |
| `src/client/impl/protocol/codec/ScheduledExecutorCancelCodec.ts` | keep | scheduled executor | cancel task operation codec |
| `src/client/impl/protocol/codec/ScheduledExecutorDisposeCodec.ts` | keep | scheduled executor | dispose task operation codec |
| `src/client/impl/protocol/codec/ScheduledExecutorGetAllScheduledFuturesCodec.ts` | keep | scheduled executor | get all futures operation codec |
| `src/client/impl/protocol/codec/ScheduledExecutorGetStatsCodec.ts` | keep | scheduled executor | get stats operation codec |
| `src/client/impl/protocol/codec/ScheduledExecutorGetStateCodec.ts` | keep | scheduled executor | get state operation codec |
| `src/client/impl/protocol/codec/ScheduledExecutorShutdownCodec.ts` | keep | scheduled executor | shutdown operation codec |
| `src/client/proxy/*.ts` | keep | proxy layer | retained public/runtime proxies for map, queue, topic, executor deferral, and proxy manager |
| `src/client/spi/*.ts` | keep | runtime services | retained listener, cluster, and partition services |
| `src/client/invocation/*.ts` | keep | invocation layer | retained request execution primitives |
| `src/client/connection/*.ts` | keep | connection layer | retained transport/session wiring |
| `src/client/impl/protocol/codec/builtin/*` | keep | protocol core | builtin type codec helpers used by all operation codecs |
| `src/client/impl/protocol/codec/custom/*` | keep | protocol core | custom type codec helpers for Address, MemberInfo, etc. |
| `src/client/HeliosClient.ts` | keep | client entrypoint | public client product surface |
| `src/client/config/ClientConfig.ts` | keep | config root | retained supported client config surface |
| `src/client/impl/nearcache/ClientNearCacheManager.ts` | keep | near-cache | client-side near-cache lifecycle manager |
| `src/client/proxy/ClientExecutorProxy.ts` | NOT-RETAINED | — | No server-side executor protocol handler; proxy was empty stub; narrowed out of `HeliosInstance` shared contract in Block 20.7 |
| `src/client/map/impl/nearcache/NearCachedClientMapProxy.ts` | keep | near-cache on top of remote map proxy | rewritten onto the retained async map proxy/runtime path |
| `src/client/cache/impl/nearcache/NearCachedClientCacheProxy.ts` | keep | near-cache on top of remote cache proxy | rewritten to avoid sync backing-store assumptions, but overall cache client surface stays blocked-by-server |
| `src/client/map/impl/nearcache/invalidation/ClientMapInvalidationMetaDataFetcher.ts` | keep | near-cache metadata fetch path | rewritten to use binary-protocol metadata fetch flow |
| `src/client/cache/impl/nearcache/invalidation/ClientCacheInvalidationMetaDataFetcher.ts` | keep | near-cache metadata fetch path | rewritten to use binary-protocol metadata fetch flow |
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
| `src/client/connection/WaitStrategy.ts` | keep | connection | exponential backoff wait strategy for reconnect |

---

## 5. Advanced And Secondary Surface Matrix

| Surface | Helios TS owner | Hazelcast anchor | Status | Prerequisite | Proof owner |
| --- | --- | --- | --- | --- | --- |
| Near-cached map | `src/client/map/impl/nearcache/NearCachedClientMapProxy.ts` | `NearCachedClientMapProxy` | implemented | live map proxy, listener service, and metadata fetch are wired through the retained client runtime | `test/client/Block20_7_NearCacheAdvancedFeatureClosure.test.ts`, `test/client/map/impl/nearcache/NearCachedClientMapProxy.test.ts` |
| Near-cached cache | `src/client/cache/impl/nearcache/NearCachedClientCacheProxy.ts` | `NearCachedClientCacheProxy` | blocked-by-server | honest client cache runtime and binary protocol support | `test/client/Block20_7_NearCacheAdvancedFeatureClosure.test.ts` |
| Query cache | `src/client/map/impl/querycache/**/*` | Hazelcast query-cache subscriber stack | blocked-by-server | server query-cache runtime absent | — |
| Transactions | `src/client/proxy/txn/**/*` | transaction proxies | blocked-by-server | cluster-safe transaction semantics | — |
| JCache client | `src/client/cache/**/*` | client cache manager/proxy | blocked-by-server | server cache capability audit and protocol support | — |
| SQL client | `src/client/sql/**/*` | `SqlClientService` | blocked-by-server | SQL runtime not releaseable today | — |
| Reliable topic client | `src/client/proxy/ClientReliableTopicProxy.ts` | `ClientReliableTopicProxy` | NOT-RETAINED | No server-side reliable-topic protocol handler; client proxy had fake listener codec; narrowed out of `HeliosInstance` shared contract in Block 20.7 | `test/client/Block20_7_NearCacheAdvancedFeatureClosure.test.ts` |
| PN counter client | `src/client/proxy/ClientPNCounterProxy.ts` | `ClientPNCounterProxy` | blocked-by-server | server runtime absent | — |
| Flake ID client | `src/client/proxy/ClientFlakeIdGeneratorProxy.ts` | `ClientFlakeIdGeneratorProxy` | blocked-by-server | server runtime absent | — |
| Scheduled executor client | `src/client/proxy/ClientScheduledExecutorProxy.ts` | scheduled executor proxy | implemented | server runtime live via Phase 22 | `test/scheduledexecutor/ScheduledExecutorAcceptanceTest.test.ts` |
| CP client | n/a | CP subsystem client surface | unsupported-by-design | Helios server runtime absent; OSS parity can reject clearly | — |

---

## 6. Packaging Matrix

| Surface | Owner | Status | Required change |
| --- | --- | --- | --- |
| Root export `.` | `src/index.ts` | implemented | keep root barrel as the supported broad public API |
| `./server` subpath | `package.json` | implemented | keep explicit |
| `./client` subpath | `package.json` | implemented | expose only retained remote client entrypoint |
| `./client/config` subpath | `package.json` | implemented | expose only retained client config entrypoint |
| wildcard `./*` export | `package.json` | removed | no internal client proxies/codecs/tasks are package-public |

---

## 7. Block 20.5 Decisions And Remaining Red Flags

- ~~`HeliosInstance.getConfig()` type mismatch~~ — resolved: `HeliosInstance.getConfig()` now returns `InstanceConfig`, a shared interface satisfied by both `HeliosConfig` and `ClientConfig`.
- ~~`getReliableTopic()` client readiness remains blocked~~ — resolved: `getReliableTopic()` and `getExecutorService()` have been marked NOT-RETAINED on the client and narrowed out of the shared `HeliosInstance` contract in Block 20.7. They remain available as member-only methods on `HeliosInstanceImpl`.
- ~~`getList()`, `getSet()`, `getMultiMap()`, `getReplicatedMap()` local-only~~ — resolved: these methods have been narrowed out of the shared `HeliosInstance` contract and remain member-only on `HeliosInstanceImpl`.
- ~~`getDistributedObject()` partial coverage~~ — resolved: member path still recognizes reliable topic and executor, while `HeliosClient.getDistributedObject()` now retains only map/queue/topic and explicitly rejects not-retained remote service names instead of falling through to a generic proxy-factory miss.
- `package.json` now exposes only `.`, `./server`, `./client`, and `./client/config`; internal client proxies, codecs, and not-retained surfaces are no longer package-public.
