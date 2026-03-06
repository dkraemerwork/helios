## Helios Client End-to-End Parity Plan

Goal: deliver a production-grade Bun/TypeScript remote client that a separate application can use to connect to a Helios cluster over the binary client protocol, with honest Hazelcast OSS parity intent and no placeholder public APIs, no hidden member-side dependencies, no orphan codecs, and no test-only transport path.

Primary reference: `/Users/zenystx/IdeaProjects/helios-1/hazelcast/src/main/java/com/hazelcast/client` plus adjacent Hazelcast client-side and client-protocol packages.

This document supersedes the partial client checkpoints in `plans/TYPESCRIPT_PORT_PLAN.md`. Those checkpoints produced useful foundations, but they do not constitute a releaseable remote client.

Dependency note:

- client closure for topic surfaces depends on Phase 19T in `plans/TYPESCRIPT_PORT_PLAN.md`
- classic `getTopic()` client support must wait for the single-path classic-topic runtime contract to be green server-side
- `getReliableTopic()` must remain `blocked-by-server` until Phase 19T removes the member-side stub and lands the real ringbuffer-backed runtime

---

## 0. Parity Contract

We are targeting Hazelcast OSS client parity where Helios server capability actually exists.

Rules:

- If Hazelcast OSS exposes a public client feature and Helios server capability exists end to end, Helios must implement it end to end.
- If Helios server capability does not exist, the plan must say `blocked-by-server` or `unsupported-by-design`. It must not imply "client work later will make it work anyway".
- Nothing may be exported from the root barrel or documented public subpaths unless it is wired through real startup, serialization, invocation, reconnect, shutdown, and error handling.
- No remote-client feature may depend on REST when Hazelcast parity requires the binary client protocol.
- No protocol codec may remain in production code unless at least one real invocation path owns it.
- No production path may use `TestHeliosInstance`, in-process fake backing stores, or member-local shortcuts as a substitute for a networked client path.
- Server-side client-protocol handlers are not client runtime code. They must not remain hidden under `src/client` once the plan is executed.

Release gate definition:

- A fresh Bun app can `import { HeliosClient } from '@zenystx/helios-core'`, load client config, connect to a real Helios cluster over sockets, use every `HeliosInstance` capability that remains public for remote use, survive reconnects, shut down cleanly, and pass real-network acceptance suites.

---

## 1. Current State Audit

Audit conclusions from the current tree:

- `src/client` contains protocol framing primitives, selected codecs, near-cache wrappers, metadata fetch helpers, and a near-cache metrics helper.
- `src/client` does not contain a usable remote client runtime: no `HeliosClient.ts`, no client instance implementation, no connection manager, no invocation service, no listener service, no proxy manager, no real remote proxies, no public exports, and no release-grade config surface.
- `src/index.ts` exports only member/server surfaces today; it does not export `HeliosClient`, and `package.json` still exposes broad deep-import access via `"./*"`, which currently makes internal `src/client` files accidentally package-public.
- Existing `test/client/**` and `test/nearcache/**` coverage is mostly codec-level, in-process, or fake-backing-store based. It is not proof of a production remote client.
- The current member/server runtime has useful ingredients (`HeliosInstanceImpl`, TCP member transport, distributed services, near-cache metadata operations), but it does not yet expose a dedicated release-grade client protocol server comparable to Hazelcast's member-side client protocol stack.

Server capability reality from the current codebase:

- `map`: strongest candidate for first remote support; already has real distributed/member-side behavior and near-cache infrastructure.
- `queue`: member-side distributed service exists, but still needs full client-protocol operations, listener fanout, and reconnect-safe client wiring.
- classic `topic`: member-side distributed service exists, but remote client work still depends on Phase 19T hardening the server/runtime contract into one service-backed path before protocol and reconnect work can be claimed honestly.
- `list`, `set`, `multimap`, `replicated map`: current implementations are explicitly single-node/in-memory subsets, so remote parity is blocked until member-side distributed semantics exist.
- `executor service`: current API exists, but it includes Helios-specific local-only registration and inline execution behavior that is not remotely portable; remote executor parity is blocked until a real member-targeted client protocol and callable serialization model exist.
- `transactions`: current service is still documented as single-node-oriented, so remote transactional client parity is blocked until server-side transactional guarantees are cluster-safe.
- `reliable topic`, `SQL`, `CP`, `scheduled executor`, `PN counter`, `flake ID`: not currently present as releaseable server features and must remain unsupported or deferred unless server runtime lands first. Reliable topic is specifically blocked on Phase 19T in `plans/TYPESCRIPT_PORT_PLAN.md`.

Conclusion: current `src/client` is a foundation library and test harness, not a remote client product.

---

## 2. Scope And Honesty Matrix

### 2.1 Client Features That Must Exist Before GA

- `HeliosClient` factory, lifecycle, shutdown-all tracking, and named-client policy
- `HeliosClient implements HeliosInstance`
- full client config model and file loading
- serialization ownership for all client requests and responses
- connection manager, authentication, heartbeat, retry, reconnect, offline semantics
- invocation, cluster, partition, listener, and proxy-manager services
- real remote proxies for every claimed distributed object
- package exports and examples that work from a separate Bun app
- real-network CI acceptance coverage

### 2.2 Current Capability Truth Table

- `map`: planned for remote GA if binary protocol tasks are completed end to end
- `queue`: planned only if member-side queue service is exposed through client protocol and listener paths
- `topic`: planned only if Phase 19T closes the server/runtime contract first and message listener fanout plus reconnect recovery are implemented end to end
- `list`, `set`, `multimap`, `replicated map`: blocked-by-server today; do not claim Hazelcast parity until member-side distributed behavior exists
- `ringbuffer`: blocked pending explicit server capability audit; do not assume support from package presence alone
- `executor service`: blocked pending real remote callable protocol and a decision on how Helios-specific local-only methods are treated on remote clients
- transactions: blocked-by-server today
- JCache client: blocked pending honest audit of member-side cache service, client cache manager, and binary protocol support
- query cache: blocked until both map query-cache server runtime and client listener/event stack exist
- SQL, reliable topic, flake ID, PN counter, scheduled executor, CP: unsupported or deferred unless server runtime lands before client GA; reliable topic remains blocked until Phase 19T is green

### 2.3 Unsupported-By-Design Rules

- Enterprise-only Hazelcast features such as TPC, enterprise SSL/socket-interceptor internals, and enterprise observability may be explicitly unsupported.
- Unsupported features must fail fast during config validation or first public API call with a stable, deliberate error.
- Unsupported features must not have placeholder classes, fake success responses, or package-public deep paths that make them look implemented.

---

## 3. Source-Of-Truth Hazelcast Anchors

Primary Java parity anchors:

- entrypoint/runtime: `HazelcastClient`, `HazelcastClientProxy`, `HazelcastClientInstanceImpl`
- config: `ClientConfig`, `ClientNetworkConfig`, `ClientConnectionStrategyConfig`, `ConnectionRetryConfig`, `ClientSecurityConfig`, `ClientFailoverConfig`, `ClientMetricsConfig`, `ClientSqlConfig`, `ClusterRoutingConfig`, `SocketOptions`, `ProxyFactoryConfig`
- connection/auth: `TcpClientConnectionManager`, `ClientConnection`, `ClientAuthenticationCodec`
- core services: `ClientInvocationServiceImpl`, `ClientPartitionServiceImpl`, `ClientClusterServiceImpl`, `ClientListenerServiceImpl`, `ProxyManager`
- proxies: `ClientMapProxy`, `ClientQueueProxy`, `ClientTopicProxy`, `ClientListProxy`, `ClientSetProxy`, `ClientMultiMapProxy`, `ClientReplicatedMapProxy`, `ClientRingbufferProxy`, `ClientExecutorServiceProxy`
- near-cache/query-cache: `NearCachedClientMapProxy`, `NearCachedClientCacheProxy`, query-cache subscriber stack
- transactions: `ClientTransactionManagerServiceImpl`, `TransactionContextProxy`, transactional proxies
- metrics/lifecycle: `ClientStatisticsService`, `LifecycleServiceImpl`, connectivity logging utilities

Implementation rule:

- Every delivered TS subsystem must name its Hazelcast anchor in plan notes, code comments, or parity matrix entries.

---

## 4. Architecture Rules

Non-negotiable program rules:

- One production transport path: Bun socket transport over the binary client protocol.
- One production invocation path: every remote operation goes through `ClientInvocationService`.
- One production proxy-creation path: every distributed object comes from `ProxyManager`.
- One production listener path: every add/remove listener call flows through `ClientListenerService` and reconnect recovery.
- One client serialization owner: request/response encoding cannot be scattered across ad hoc proxy code.
- One shutdown order: listeners -> invocations -> connections -> proxies/near-caches -> lifecycle events.
- Server-side client protocol handlers live outside `src/client`; they belong to member/server packages.
- Package exports must distinguish public API from internal-only test/support paths; accidental deep-import publication is not acceptable.

---

## 5. Ownership Cleanup For Current `src/client`

Every existing file in `src/client` needs an explicit fate before implementation starts.

### 5.1 Keep And Wire

- `impl/protocol/ClientMessage.ts`
- `impl/protocol/ClientMessageReader.ts`
- `impl/protocol/ClientMessageWriter.ts`
- `impl/protocol/util/*`
- builtin/custom codecs that are actually used by retained request or event codecs
- `impl/protocol/codec/ClientAuthenticationCodec.ts`
- retained operation/event codecs such as `MapPutCodec.ts`, `MapAddEntryListenerCodec.ts`, and near-cache codecs
- `impl/protocol/AuthenticationStatus.ts`
- `impl/protocol/exception/MaxMessageSizeExceeded.ts`
- `impl/statistics/NearCacheMetricsProvider.ts`

### 5.2 Rewrite Around Real Runtime Ownership

- `config/ClientConfig.ts` currently covers only near-cache config lookup; it must become a real root client config instead of staying a lightweight special case.
- `map/impl/nearcache/NearCachedClientMapProxy.ts` and `cache/impl/nearcache/NearCachedClientCacheProxy.ts` currently wrap synchronous in-process backing-store interfaces; they must be rewritten to sit on top of real remote proxies and listener/invalidation services.
- `map/impl/nearcache/invalidation/ClientMapInvalidationMetaDataFetcher.ts` and `cache/impl/nearcache/invalidation/ClientCacheInvalidationMetaDataFetcher.ts` currently depend on in-process member metadata objects; they must be rewritten to invoke real client-protocol metadata fetch operations.

### 5.3 Move Out Of `src/client`

- `src/client/impl/protocol/task/map/MapFetchNearCacheInvalidationMetadataTask.ts`
- `src/client/impl/protocol/task/cache/CacheFetchNearCacheInvalidationMetadataTask.ts`

These are member-side client-protocol handlers, not client runtime classes. They should move into a member/server client-protocol package such as `src/server/clientprotocol/task/**` or equivalent.

### 5.4 Delete If Still Orphaned After Wiring

- any codec with no proxy or service owner
- any helper that exists only for test-only fake backing stores
- any abstract event handler that still throws `must be implemented` from production execution paths
- any internal file that remains package-public only because of wildcard exports

Done gate:

- the parity matrix lists every current `src/client` file with one of: `keep`, `rewrite`, `move`, or `delete`

---

## 6. Delivery Phases

### Phase C0 - Audit Freeze And Parity Matrix

Goal: freeze the surface and prevent more orphan foundations.

Deliverables:

- full file inventory for `src/client`
- current capability truth table for every public distributed object and advanced service
- Hazelcast-to-Helios parity matrix with `implemented`, `planned`, `blocked-by-server`, `unsupported-by-design`
- explicit export/public-subpath decision for client API versus internal paths

Done gate:

- every current client file and every claimed client feature has a named owner and fate

### Phase C1 - Public API, Packaging, And Runtime Contract

Goal: define the actual client product, not just implementation pieces.

Create and decide:

- `src/client/HeliosClient.ts`
- `HeliosClient implements HeliosInstance` as a hard contract
- lifecycle service and lifecycle listener surface
- `shutdownAll()` and named-client registry policy
- `src/index.ts` exports for `HeliosClient` and client config
- `package.json` exports policy: explicit public entries only, or a clearly named internal subpath for tests

Must also define now:

- which current `HeliosInstance` methods are truly remote-capable already
- which `HeliosInstance` methods require new member/server work before client GA
- whether any currently public `HeliosInstance` methods should be reclassified as member-only and removed from the shared contract before client GA cleanup
- whether any currently exported member internals should stop being root-barrel public during client GA cleanup

Done gate:

- a separate Bun app can import only documented public paths and construct a `HeliosClient` that satisfies the shared `HeliosInstance` contract without internal imports

### Phase C2 - Config And Serialization Foundation

Goal: make configuration and serialization complete before transport work starts.

Create and wire:

- full `ClientConfig` root
- `ClientNetworkConfig`
- `ClientConnectionStrategyConfig`
- `ConnectionRetryConfig`
- `ClientSecurityConfig`
- `ClientMetricsConfig`
- `ClientFailoverConfig`
- `ClientSqlConfig` only if SQL is in scope
- parity-reviewed support or explicit rejection for `ClusterRoutingConfig`, `SocketOptions`, discovery/cloud config, labels, load-balancing/routing, and proxy-factory config
- config file loading for JSON/YAML using the same production loading path that external users will use
- client serialization service ownership and compatibility validation

Rules:

- no "lightweight" client config may remain once the real config exists
- unsupported config sections must fail fast at startup, not be silently ignored
- if a config field is accepted from file input, its runtime behavior must either exist or be rejected explicitly

Done gate:

- config round-trips through file loading, validation, and runtime startup with no silent drops

### Phase C3 - Member-Side Client Protocol Server

Goal: create the member/server counterpart before pretending the client can talk to anything real.

Create and wire on the server/member side:

- dedicated client socket acceptor distinct from member-to-member transport concerns
- protocol version negotiation and framing compatibility
- authentication pipeline and session creation
- client endpoint/session registry
- request dispatch registry from message type to member-side handler
- correlation-aware response path and event push path
- disconnect cleanup, heartbeat handling, and lifecycle bookkeeping

Rules:

- member-side handlers must not live under `src/client`
- no client phase after C3 may rely on in-process task invocation to simulate a server

Done gate:

- a raw client socket can authenticate, issue at least one request, receive a response, and disconnect cleanly against a real member

### Phase C4 - Connection Manager, Authentication, And Ownership

Goal: make client connections durable and restartable.

Create and wire:

- `src/client/connection/ClientConnection.ts`
- `src/client/connection/ClientConnectionManager.ts`
- authentication request/response handling around `ClientAuthenticationCodec`
- heartbeat/ping handling
- retry/backoff/timeout semantics
- cluster identity validation and serialization-version checks
- offline exceptions and state transitions

Must validate explicitly:

- cluster name mismatch
- auth failure versus transient network failure
- reconnect behavior after clean close and abrupt drop
- multi-address bootstrap behavior

Done gate:

- the client authenticates over real sockets, detects invalid cluster/auth state, reconnects after drop, and shuts down without leaked sessions

### Phase C5 - Invocation, Cluster, Partition, And Listener Services

Goal: centralize all request execution and all event recovery before proxy work.

Create and wire:

- `src/client/impl/spi/ClientInvocation.ts`
- `src/client/impl/spi/ClientInvocationService.ts`
- `src/client/impl/spi/ClientPartitionService.ts`
- `src/client/impl/spi/ClientClusterService.ts`
- `src/client/impl/spi/ClientListenerService.ts`
- retry classification, correlation tracking, timeout handling, and redirection/resubmission rules
- member-list and partition-table refresh handling
- listener registration bookkeeping and reconnect re-registration

Server-side prerequisites:

- binary protocol tasks for partition-table fetch, member-list fetch, distributed-object events, and listener registration/removal
- retryable versus terminal error-code mapping
- event push delivery semantics for listeners

Done gate:

- all requests flow only through the invocation service, and listeners can register, receive events, survive reconnects, and deregister through one central service

### Phase C6 - Server Capability Closure For Public APIs

Goal: stop the program from exporting client proxies for member features that are not remotely real.

Required audit and follow-up for each public distributed object family:

- verify whether the member/server side already has distributed semantics beyond single-node local containers
- if not, add the required member-side service/operation work to the same program before any client proxy is exported
- if that server work is intentionally out of scope, either remove that surface from the shared remote `HeliosInstance` contract before GA or mark the entire client GA as blocked; do not leave a `HeliosInstance` method permanently half-supported on `HeliosClient`

This phase is mandatory for at least:

- `list`
- `set`
- `multimap`
- `replicated map`
- `ringbuffer`
- `executor service`
- transactions
- JCache client

Done gate:

- every public client-facing data structure is either backed by audited server capability or explicitly removed from the client scope

### Phase C7 - Proxy Manager And Distributed Object Lifecycle

Goal: give all remote objects one creation and lifecycle path.

Create and wire:

- `src/client/impl/spi/ClientProxy.ts`
- `src/client/impl/spi/ProxyManager.ts`
- proxy factory registry by service/object type
- distributed object create/destroy protocol tasks
- `getDistributedObjects()` support if retained in the public client surface
- distributed object listener support if retained

Rules:

- no direct proxy construction from public APIs
- same object name must return a stable proxy instance until destroy/shutdown
- destroy must travel over binary protocol and reconcile client-side cache/proxy state

Done gate:

- every remote distributed object is created, looked up, enumerated, destroyed, and re-created only through `ProxyManager`

### Phase C8 - Core Remote Proxies

Goal: implement the remote proxies for features that passed C6.

Initial minimum target:

- `ClientMapProxy`
- `ClientQueueProxy`
- `ClientTopicProxy`

Additional proxies only after server capability is proven in C6:

- `ClientListProxy`
- `ClientSetProxy`
- `ClientMultiMapProxy`
- `ClientReplicatedMapProxy`
- `ClientRingbufferProxy`
- `ClientExecutorServiceProxy`

Per proxy requirements:

- every retained public method has a real codec, invocation path, and member-side handler
- serialization/deserialization parity is owned centrally, not ad hoc per test
- listener APIs work through `ClientListenerService`
- destroy semantics are real
- error mapping is deliberate and documented
- every method retained on the shared `HeliosInstance` contract is remotely implemented end to end; if a method cannot be remote-capable, it must be removed or split out of the shared contract before client GA

Done gate:

- a remote client can use every claimed distributed object over real sockets with no internal imports and no fake backing store

### Phase C9 - Near Cache Completion

Goal: finish near-cache only after remote proxies and listener services are real.

Keep and finish:

- `NearCachedClientMapProxy`
- `NearCachedClientCacheProxy`
- metadata fetchers
- `NearCacheMetricsProvider`

Must add:

- wrapping of real remote proxies, not synchronous local backing stores
- reconnect re-registration logic through `ClientListenerService`
- metadata fetch through binary protocol, not in-process member objects
- stale-read detector integration on the live invocation path
- clear/evict/destroy semantics on proxy shutdown and distributed-object destroy
- config attachment from the real `ClientConfig`

Rules:

- current in-process near-cache acceptance tests are not enough for sign-off
- no near-cache file may remain as a standalone mini-runtime disconnected from the real client instance

Done gate:

- real-network sequence works: miss -> hit -> remote invalidation -> re-fetch -> reconnect repair

### Phase C10 - Transactions, Cache, Query Cache, And Advanced Features

Goal: finish higher-level client features only where server capability is real.

Implement only when corresponding server capability exists end to end:

- transaction manager and transaction context
- transactional map/queue/list/set/multimap proxies
- client cache manager and cache proxy factory
- query-cache subscriber stack
- advanced map iterators, projections, aggregations, paging, and query surfaces that are already public and truly supported on the server

Rule:

- do not export or document these until they are fully wired through real protocol handlers and acceptance tests

Done gate:

- no advanced client feature remains half-public, half-internal, or test-only

### Phase C11 - Secondary Services, Failover, Metrics, And Diagnostics

Goal: make the client operationally real.

Implement only when backed by real server/runtime support:

- failover validation and runtime cluster switching
- client statistics service
- metrics publication hooks
- connectivity logging and diagnostics metadata
- client name and labels propagation
- secondary services such as SQL, reliable topic, PN counter, flake ID only when server runtime exists; reliable topic specifically requires the Phase 19T checkpoint to be green first

Rules:

- if failover is not supported, config must reject it clearly during startup
- if a service maps to a public `HeliosInstance` method or a claimed remote surface, the server/runtime blocker must be resolved before GA; otherwise the contract itself must be narrowed before GA

Done gate:

- restart, brownout, rolling restart, and reconnect behavior are measurable, documented, and acceptance-tested

### Phase C12 - Examples, Docs, And Release Readiness

Goal: make the client consumable by external users.

Implement:

- root-barrel exports for the supported client surface
- explicit package export entries for public client API and only the intended internal/test subpaths
- example Bun remote-client app against a multi-member Helios cluster
- auth example, reconnect example, near-cache example
- migration notes for embedded member versus remote client usage

Done gate:

- a fresh external Bun app can install the package, import documented paths only, connect, run examples, and pass acceptance suites without source edits

---

## 7. Required Member/Server Counterpart Work

The client cannot be completed in isolation. The same program must own these member/server tasks:

- client protocol listener and session acceptor
- authentication and credential validation pipeline
- request-dispatch registry from message type to member-side handler
- partition table, member list, cluster view, and distributed-object metadata fetch tasks
- listener registration storage and event fanout to remote clients
- Phase 19T topic closure for classic topic and reliable topic before any client GA claim on those surfaces
- distributed-object create/destroy protocol tasks
- client-aware disconnect cleanup and session teardown
- error-code mapping for retryable, auth, serialization, and terminal failures
- metrics/statistics ingestion if client stats are reported server-side
- any missing member-side distributed semantics uncovered by C6 for collections, executor, transactions, cache, ringbuffer, or secondary services

Rule:

- each client phase must list its member/server prerequisites before implementation starts; otherwise the phase is not ready to begin

---

## 8. Test And Acceptance Program

### 8.1 Unit Suites

- protocol framing and fragmentation
- retained codecs
- config parsing and validation
- connection state machine
- retry classification and timeout behavior
- proxy semantics where logic is local and deterministic
- near-cache bookkeeping and stale-read logic

### 8.2 Real-Network Integration Suites

- single client -> single member
- single client -> multi-member cluster
- two clients -> shared map/topic/queue behavior
- reconnect after member restart and connection drop
- auth success, auth failure, cluster mismatch, serialization mismatch
- distributed object destroy and re-create
- listener add/remove and reconnect recovery
- partition-table and membership refresh

### 8.3 Capability-Gated Acceptance Suites

- one suite per exported distributed object family
- one suite per exported advanced feature family
- no exported client symbol without at least one real-network acceptance path
- no feature accepted via REST when it is claimed as binary-protocol client support

### 8.4 Negative And Hygiene Gates

- no package-public client path that still points to a fake or orphan class
- no `Stub`, `Placeholder`, or `Test*` class in the production client graph
- no member-side client protocol handler left under `src/client`
- no codec left without a proxy/service owner
- no acceptance suite using in-process fake backing stores as proof of remote parity

---

## 9. Target File Plan

Target shape after cleanup:

```text
src/client/
  HeliosClient.ts
  config/
    ClientConfig.ts
    ClientNetworkConfig.ts
    ClientConnectionStrategyConfig.ts
    ConnectionRetryConfig.ts
    ClientSecurityConfig.ts
    ClientMetricsConfig.ts
    ClientFailoverConfig.ts
    ClientSqlConfig.ts
  connection/
    ClientConnection.ts
    ClientConnectionManager.ts
    ClientConnectionState.ts
  impl/
    client/
      HeliosClientInstanceImpl.ts
      HeliosClientProxy.ts
      LifecycleServiceImpl.ts
    spi/
      ClientInvocation.ts
      ClientInvocationService.ts
      ClientPartitionService.ts
      ClientClusterService.ts
      ClientListenerService.ts
      ClientProxy.ts
      ProxyManager.ts
    protocol/
      ClientMessage.ts
      ClientMessageReader.ts
      ClientMessageWriter.ts
      codec/
      util/
    statistics/
      ClientStatisticsService.ts
      NearCacheMetricsProvider.ts
  proxy/
    ClientMapProxy.ts
    ClientQueueProxy.ts
    ClientTopicProxy.ts
    ClientListProxy.ts
    ClientSetProxy.ts
    ClientMultiMapProxy.ts
    ClientReplicatedMapProxy.ts
    ClientRingbufferProxy.ts
    ClientExecutorServiceProxy.ts
    txn/
  map/
    impl/nearcache/
  cache/
    impl/

src/server/clientprotocol/
  task/
    ... member-side client message handlers ...
```

Rule:

- `src/client` is for the remote client runtime; member-side client-protocol task handlers live under server/member packages.

---

## 10. Non-Negotiable Completion Gates

The client program is not done until all are true:

- `HeliosClient` is publicly exported, documented, and implements `HeliosInstance`
- package exports expose only intended public paths
- a separate Bun app connects to a real cluster over the binary client protocol
- every `HeliosInstance` capability retained for remote use works remotely end to end
- reconnect, shutdown, and listener recovery are deterministic
- near-cache is production-safe under invalidation loss and reconnect
- the capability matrix is honest for every Hazelcast OSS client subsystem considered
- no public client stubs, dead exports, fake transports, or in-process-only proof paths remain
- real-network acceptance suites run green in CI

---

## 11. Recommended Execution Order

1. C0 audit freeze and parity matrix
2. C1 public API and package contract
3. C2 config and serialization foundation
4. C3 member-side client protocol server
5. C4 connection manager and authentication
6. C5 invocation/cluster/partition/listener services
7. C6 server capability closure for public APIs
8. C7 proxy manager and distributed-object lifecycle
9. C8 core remote proxies
10. C9 near-cache completion
11. C10 transactions/cache/query-cache/advanced features
12. C11 secondary services/failover/metrics
13. C12 examples/docs/release readiness

This order prevents the current dead-end pattern where codecs and near-cache wrappers exist before the owning runtime, listener service, and member-side protocol server exist.

---

## 12. Immediate Next Step

Before implementation begins, create or update a dedicated parity matrix document with these columns:

- Hazelcast Java class or subsystem
- Helios TS target file or package owner
- status: `implemented`, `planned`, `blocked-by-server`, `unsupported-by-design`
- notes: required member/server prerequisite, export decision, and acceptance suite owner

That matrix becomes the control document used alongside this plan during implementation.
