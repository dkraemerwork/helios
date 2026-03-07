## Helios Client Execution Backlog

This backlog operationalizes `plans/CLIENT_E2E_PARITY_PLAN.md` into concrete phases, target files, and exit criteria.

Principles:

- `HeliosClient` must implement `HeliosInstance`.
- No phase is done if it leaves behind orphan codecs, test-only runtime paths, or public APIs without real socket-based acceptance coverage.
- Member/server prerequisites are first-class work items, not side notes.

Dependency note:

- client work for `getTopic()` depends on the Phase 19T classic-topic checkpoint in `plans/TYPESCRIPT_PORT_PLAN.md`
- client work for `getReliableTopic()` must not start, and no reliable-topic readiness claim may be made, until the Phase 19T reliable-topic checkpoint is green in `plans/TYPESCRIPT_PORT_PLAN.md`

---

## Phase B0 - Surface Freeze And Matrix

Goal: inventory all current client-related code and lock ownership before runtime work starts.

### Planning Files

- `plans/CLIENT_E2E_PARITY_PLAN.md`
- `plans/CLIENT_E2E_EXECUTION_BACKLOG.md`
- new: `plans/CLIENT_E2E_PARITY_MATRIX.md`

### Client Files To Audit

- `src/client/config/ClientConfig.ts`
- `src/client/impl/protocol/ClientMessage.ts`
- `src/client/impl/protocol/ClientMessageReader.ts`
- `src/client/impl/protocol/ClientMessageWriter.ts`
- `src/client/impl/protocol/util/*`
- `src/client/impl/protocol/codec/**/*`
- `src/client/map/impl/nearcache/**/*`
- `src/client/cache/impl/nearcache/**/*`
- `src/client/impl/statistics/NearCacheMetricsProvider.ts`
- `src/client/impl/protocol/task/**/*`

### Package/Public Surface Files To Audit

- `src/index.ts`
- `package.json`
- `tsconfig.build.json`

### Deliverables

- parity matrix per Hazelcast class/subsystem
- `keep/rewrite/move/delete` decision for every existing `src/client` file
- list of `HeliosInstance` methods that are already remotely viable versus blocked by missing server semantics

### Exit Gate

- nothing in `src/client` is ownerless

### Suggested Commit Boundaries

- `docs(client): add parity matrix for remote client program`
- `docs(client): classify existing src/client files by keep rewrite move delete`

---

## Phase B1 - Shared Contract And Packaging

Goal: define the public remote contract and lock package boundaries.

### Client Files

- new: `src/client/HeliosClient.ts`
- new: `src/client/impl/client/HeliosClientProxy.ts`
- new: `src/client/impl/client/HeliosClientInstanceImpl.ts`
- new: `src/client/impl/client/LifecycleServiceImpl.ts`

### Shared API / Packaging Files

- update: `src/index.ts`
- update: `package.json`
- update if needed: `README.md`

### Work Items

- make `HeliosClient` implement `HeliosInstance`
- define startup/shutdown/named-client registry rules
- expose only supported public entrypoints from the package root
- remove accidental deep-import publication for client internals
- decide whether any current `HeliosInstance` methods must be split out or narrowed before client GA
- if B1 narrows any `HeliosInstance` method or introduces a member-only replacement, queue the matching docs/examples/test-support/fixture cleanup immediately instead of deferring those references to the release phase

### Exit Gate

- external Bun app can import `HeliosClient` from the root package without internal paths

### Suggested Commit Boundaries

- `refactor(core): align HeliosClient contract with HeliosInstance`
- `build(pkg): lock down public exports for client rollout`
- `feat(client): add public client entrypoint and lifecycle shell`

---

## Phase B2 - Client Config And Serialization Foundation

Goal: finish config and serialization ownership before any live transport work.

### Client Config Files

- rewrite: `src/client/config/ClientConfig.ts`
- new: `src/client/config/ClientNetworkConfig.ts`
- new: `src/client/config/ClientConnectionStrategyConfig.ts`
- new: `src/client/config/ConnectionRetryConfig.ts`
- new: `src/client/config/ClientSecurityConfig.ts`
- new: `src/client/config/ClientMetricsConfig.ts`
- new: `src/client/config/ClientFailoverConfig.ts`
- new if in scope: `src/client/config/ClientSqlConfig.ts`
- new if kept: `src/client/config/ClusterRoutingConfig.ts`
- new if kept: `src/client/config/SocketOptions.ts`

### Related Runtime Files

- new or update: client config loader under `src/client/config/`
- new or update: client serialization owner under `src/client/impl/`

### Work Items

- convert the current near-cache-only config into the real root config
- wire JSON/YAML config loading through production paths
- validate unsupported config sections explicitly at startup
- establish one client serialization service used by all request/response paths

### Exit Gate

- config file input either works end to end or fails loudly and deliberately

### Suggested Commit Boundaries

- `feat(client-config): add root client config model`
- `feat(client-config): add network security retry and metrics config`
- `feat(client-config): add production client config loading and validation`
- `feat(client-core): add shared client serialization ownership`

---

## Phase B3 - Member-Side Client Protocol Server

Goal: create the real thing the client will talk to.

### Server Files

- new package root: `src/server/clientprotocol/`
- new: `src/server/clientprotocol/ClientProtocolServer.ts`
- new: `src/server/clientprotocol/ClientSession.ts`
- new: `src/server/clientprotocol/ClientSessionRegistry.ts`
- new: `src/server/clientprotocol/ClientMessageDispatcher.ts`
- new: `src/server/clientprotocol/task/**/*`

### Existing Files Likely Touched

- update: `src/instance/impl/HeliosInstanceImpl.ts`
- update: `src/server/HeliosServer.ts`
- move from client package:
  - `src/client/impl/protocol/task/map/MapFetchNearCacheInvalidationMetadataTask.ts`
  - `src/client/impl/protocol/task/cache/CacheFetchNearCacheInvalidationMetadataTask.ts`

### Work Items

- add client socket acceptor and session lifecycle
- add auth handshake and protocol version negotiation
- add dispatch from message type to member-side task handler
- add response correlation and event push support
- add disconnect cleanup and heartbeat handling

### Exit Gate

- raw socket client can auth, issue one request, receive one response, and disconnect cleanly

### Suggested Commit Boundaries

- `refactor(client-protocol): move member-side tasks out of src/client`
- `feat(client-protocol): add member-side client protocol server and sessions`
- `feat(client-protocol): add auth handshake and request dispatch registry`
- `test(client-protocol): prove raw socket request response lifecycle`

---

## Phase B4 - Connection Manager And Authentication

Goal: make the remote client actually connect and stay connected.

### Client Files

- new: `src/client/connection/ClientConnection.ts`
- new: `src/client/connection/ClientConnectionManager.ts`
- new: `src/client/connection/ClientConnectionState.ts`
- update: `src/client/impl/protocol/codec/ClientAuthenticationCodec.ts`
- update: `src/client/impl/protocol/AuthenticationStatus.ts`

### Work Items

- bootstrap against multiple addresses
- auth success/failure classification
- heartbeat and idle detection
- reconnect/backoff behavior
- cluster mismatch detection
- clean shutdown and session teardown

### Exit Gate

- client survives connect, drop, reconnect, shutdown, and wrong-cluster scenarios over real sockets

---

## Phase B5 - Invocation, Cluster, Partition, And Listener Services

Goal: centralize execution before proxy implementation.

### Client Files

- new: `src/client/impl/spi/ClientInvocation.ts`
- new: `src/client/impl/spi/ClientInvocationService.ts`
- new: `src/client/impl/spi/ClientPartitionService.ts`
- new: `src/client/impl/spi/ClientClusterService.ts`
- new: `src/client/impl/spi/ClientListenerService.ts`

### Server Files

- new/update: `src/server/clientprotocol/task/cluster/**/*`
- new/update: `src/server/clientprotocol/task/listener/**/*`
- new/update: `src/server/clientprotocol/task/partition/**/*`

### Work Items

- request correlation and response completion
- retryable versus terminal error mapping
- member-list and partition-table refresh
- listener registration bookkeeping and reconnect recovery
- event delivery for membership and distributed-object listeners

### Exit Gate

- all remote calls and listeners flow through central services only

---

## Phase B6 - Server Capability Closure Per `HeliosInstance`

Goal: close the gaps between the shared `HeliosInstance` contract and actual remote-capable server semantics.

### Member/Server Files To Audit Or Extend

- `src/collection/impl/**/*`
- `src/topic/impl/**/*`
- `src/multimap/impl/**/*`
- `src/replicatedmap/impl/**/*`
- `src/ringbuffer/impl/**/*`
- `src/executor/impl/**/*`
- `src/transaction/impl/**/*`
- `src/cache/impl/**/*`
- `src/map/impl/**/*`

### Work Items

- prove which current `HeliosInstance` methods are truly remote-capable
- add missing distributed/member semantics where the shared contract requires them
- define remote semantics for destroy, listenering, iteration, and failure behavior
- block client GA if any retained `HeliosInstance` method lacks a credible remote path

### Exit Gate

- every `HeliosInstance` method retained for remote use has a server/runtime owner

---

## Phase B7 - Proxy Manager And Distributed Object Lifecycle

Goal: one creation path for all remote objects.

### Client Files

- new: `src/client/impl/spi/ClientProxy.ts`
- new: `src/client/impl/spi/ProxyManager.ts`

### Server Files

- new/update: `src/server/clientprotocol/task/proxy/**/*`

### Work Items

- stable proxy identity by service/name
- create/destroy distributed objects over the binary protocol
- distributed object enumeration if retained
- client-side destroy cleanup for near-cache/listeners

### Exit Gate

- no public API creates proxies directly

---

## Phase B8 - Core Remote Proxies

Goal: implement the first set of real remote distributed objects.

### Client Files

- new: `src/client/proxy/ClientMapProxy.ts`
- new: `src/client/proxy/ClientQueueProxy.ts`
- new: `src/client/proxy/ClientTopicProxy.ts`
- new when cleared by B6: `src/client/proxy/ClientListProxy.ts`
- new when cleared by B6: `src/client/proxy/ClientSetProxy.ts`
- new when cleared by B6: `src/client/proxy/ClientMultiMapProxy.ts`
- new when cleared by B6: `src/client/proxy/ClientReplicatedMapProxy.ts`
- new when cleared by B6: `src/client/proxy/ClientRingbufferProxy.ts`
- new when cleared by B6: `src/client/proxy/ClientExecutorServiceProxy.ts`

### Existing Client Codec Files Likely Retained/Expanded

- `src/client/impl/protocol/codec/MapPutCodec.ts`
- `src/client/impl/protocol/codec/MapAddEntryListenerCodec.ts`
- plus one retained codec per proxy method family

### Server Files

- new/update: `src/server/clientprotocol/task/map/**/*`
- new/update: `src/server/clientprotocol/task/queue/**/*`
- new/update: `src/server/clientprotocol/task/topic/**/*`
- new/update for advanced families only after B6

Phase rule:

- do not claim `ClientTopicProxy` GA readiness until Phase 19T closes the single-path classic-topic server/runtime contract

### Exit Gate

- separate Bun app can use every shipped proxy over real sockets

---

## Phase B9 - Near Cache Completion

Goal: finish near-cache on top of the real runtime instead of sidecar helpers.

### Client Files To Rewrite

- rewrite: `src/client/map/impl/nearcache/NearCachedClientMapProxy.ts`
- rewrite: `src/client/cache/impl/nearcache/NearCachedClientCacheProxy.ts`
- rewrite: `src/client/map/impl/nearcache/invalidation/ClientMapInvalidationMetaDataFetcher.ts`
- rewrite: `src/client/cache/impl/nearcache/invalidation/ClientCacheInvalidationMetaDataFetcher.ts`
- update: `src/client/impl/statistics/NearCacheMetricsProvider.ts`

### Server Files

- update: `src/server/clientprotocol/task/map/**/*`
- update: `src/server/clientprotocol/task/cache/**/*`

### Exit Gate

- miss -> hit -> invalidate -> re-fetch -> reconnect repair works over real sockets

---

## Phase B10 - Advanced Features Required By Shared Contract

Goal: close whatever remains on the `HeliosInstance` surface and its immediate advanced relatives.

### Candidate Client Files

- new: `src/client/proxy/txn/**/*`
- new: `src/client/cache/**/*`
- new: query-cache support under `src/client/map/`
- new advanced map iterator/query support under `src/client/proxy/`

### Candidate Server Files

- `src/server/clientprotocol/task/transaction/**/*`
- `src/server/clientprotocol/task/cache/**/*`
- `src/server/clientprotocol/task/query/**/*`

Phase rule:

- any `ClientReliableTopicProxy` work is blocked until the Phase 19T checkpoint is green

### Exit Gate

- no `HeliosClient`/`HeliosInstance` contract item remains half-public or fake

---

## Phase B11 - Secondary Services, Metrics, And Diagnostics

Goal: operational completeness.

### Client Files

- new: `src/client/impl/statistics/ClientStatisticsService.ts`
- update: `src/client/config/ClientMetricsConfig.ts`
- new if server support lands: secondary service proxies/config

### Exit Gate

- reconnect, rolling restart, and observability behavior are measurable and acceptance-tested

---

## Phase B12 - Docs, Examples, And Release Gates

Goal: make the client consumable and keep it honest.

### Files

- update: `src/index.ts`
- update: `package.json`
- new/updated examples under `examples/`
- update: `README.md`

### Required Examples

- separate Bun app connecting to cluster
- auth example
- reconnect example
- near-cache example

### Mandatory Proof Owners And Commands

Add and keep the exact Phase 20 proof-label contract from `plans/CLIENT_E2E_PARITY_PLAN.md` in sync with implementation.

Required owning proof files:

- new: `test/client/e2e/ClientStartupE2E.test.ts`
- new: `test/client/e2e/ClientMapE2E.test.ts`
- new: `test/client/e2e/ClientQueueE2E.test.ts`
- new: `test/client/e2e/ClientTopicE2E.test.ts`
- new if retained: `test/client/e2e/ClientReliableTopicE2E.test.ts`
- new if retained: `test/client/e2e/ClientExecutorE2E.test.ts`
- new: `test/client/e2e/ClientReconnectListenerRecoveryE2E.test.ts`
- new: `test/client/e2e/ClientProxyLifecycleE2E.test.ts`
- new: `test/client/e2e/ClientExternalBunAppE2E.test.ts`
- retain/update: `test/client/Block20_8_ExamplesDocsExportsGAProof.test.ts`

Work Items:

- bind each required proof file to its exact label and command in `plans/CLIENT_E2E_PARITY_PLAN.md`
- do not let map, queue, topic, reconnect/listener recovery, proxy lifecycle, external Bun app, or hygiene proof collapse into a shared catch-all suite
- if reliable-topic or executor is removed from the retained remote contract, keep the proof label and record it as `NOT-RETAINED` with parity-matrix and docs citations rather than deleting the row
- require the final Phase 20 completion note to end with the exact ordered footer from the parity plan, including the terminal `P20-GATE-CHECK — green` line
- audit `README.md`, `examples/`, `src/test-support/`, and shipped fixtures for stale shared-contract references and update or remove any member-only substitute or narrowed-out method usage before client GA

### Exit Gate

- external user can install, import documented paths only, and run the examples unchanged
- exact proof-label report exists and includes `P20-STARTUP`, `P20-MAP`, `P20-QUEUE`, `P20-TOPIC`, `P20-RELIABLE-TOPIC`, `P20-EXECUTOR`, `P20-RECONNECT-LISTENER`, `P20-PROXY-LIFECYCLE`, `P20-EXTERNAL-BUN-APP`, `P20-HYGIENE`, and final `P20-GATE-CHECK`

---

## Cross-Cutting Cleanup Queue

- delete or move any orphan codec after its owning phase finishes
- remove any member-side task class left under `src/client`
- close package wildcard exports that leak internal client files
- ensure every acceptance test uses the binary client protocol, not REST, when claiming remote support
- ensure every public `HeliosInstance` method on `HeliosClient` has a real acceptance test owner
- audit and scrub docs/examples/test-support/fixtures whenever `HeliosInstance` is narrowed so no stale member-only substitute or removed-method reference survives into client GA
