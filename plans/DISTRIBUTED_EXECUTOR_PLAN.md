# Distributed Executor Service Plan

## Purpose

Phase 17 delivers Tier 1 only: an immediate, non-durable, non-scheduled distributed
executor for Helios. It must support:

- `submit*` calls that return results through `InvocationFuture`
- `execute*` fire-and-forget calls
- routing to partition owner, key owner, specific member, selected members, or all members
- off-main-thread task execution via `scatter.pool()` worker threads
- bounded queueing, bounded worker-pool growth, cancellation, shutdown, and monitoring

This phase does not deliver durable replay or scheduled execution. `IDurableExecutorService`
and `IScheduledExecutorService` stay deferred to Phase 18+.

## Loop Contract

- `plans/TYPESCRIPT_PORT_PLAN.md` is the canonical queue. `loop.sh` must select the next
  unchecked Phase 17 block from the Master Todo there.
- This file is the authoritative implementation spec for the selected Phase 17 block.
- Do not assume Phase 16's checked status means the current runtime is already production-ready
  for executor work. Phase 17 must close the remaining runtime gaps explicitly.

## Deliverable and Non-Goals

### Phase 17 must guarantee

- Registered task types execute on scatter worker threads, never on the main event loop.
- Distributed submissions return typed results to callers, not raw `Data` payloads.
- Cluster members reject unknown or mismatched task registrations before enqueue.
- Queueing and active task-type pools are bounded by config; no unbounded defaults.
- Member-targeted calls do not retry on member departure.
- Partition-targeted calls retry only before the remote member accepts the task.
- Once a remote member has accepted a task, later member loss fails the caller with an explicit
  task-lost error; there is no silent replay.
- Queued-task cancellation is strong. In-flight cancellation is logical: the caller gets a
  cancellation result and any late worker result is dropped.
- Executor shutdown rejects new work immediately and drains or times out deterministically.

### Phase 17 explicitly does not guarantee

- durable recovery after node crash
- scheduled or periodic execution
- transparent replay after a task is accepted by a remote member and that member dies
- unrestricted registration of arbitrarily many active task-type pools
- silent acceptance of unsupported split-brain or scheduling config

## Reality Check: Gaps That Phase 17 Must Close

The current codebase is close, but not yet end-to-end executor-ready:

- `OperationServiceImpl` still needs a real remote operation path for production executor use.
- `NodeEngine` and `PartitionService` expose too little cluster/partition information for
  executor routing.
- `HeliosInstanceImpl` still uses a `LocalCluster`-style runtime surface and synchronous
  shutdown semantics that are not sufficient for graceful executor draining.
- The current Phase 17 draft assumed `registerTaskType()`, result unwrapping, retry hooks,
  and cluster service access that do not exist yet in the public TypeScript surface.
- The current scatter integration draft used unbounded defaults and promised crash/retry
  behavior that Tier 1 cannot safely provide.

Phase 17 therefore starts by closing runtime prerequisites before adding executor API layers.

## Reference Material

### Java parity references

- `IExecutorService.java`
- `ExecutorServiceProxy.java`
- `DistributedExecutorService.java`
- `AbstractCallableTaskOperation.java`
- `CallableTaskOperation.java`
- `MemberCallableTaskOperation.java`
- `CancellationOperation.java`
- `ShutdownOperation.java`
- `ExecutorConfig.java`

Use them for behavioral parity only. This is a TypeScript-first implementation using scatter,
not a line-by-line port of Java's thread-pool internals.

### Scatter realities from the current sibling repo

| Scatter fact | Phase 17 rule |
|---|---|
| `scatter.pool()` is monomorphic | one pool per task type; never one shared generic pool |
| `fn.toString()` cannot be executed remotely | distributed execution uses pre-registered task types only |
| Current `AbortSignal` behavior is logical cancel, not guaranteed worker interruption | queued cancel is strong; in-flight cancel drops late result but may not reclaim CPU immediately |
| Workers can disappear and reduce `workersAlive` | degraded pools must be detected and recycled explicitly |
| `shutdown()` drains forever if work never finishes | executor shutdown needs timeout + fallback terminate path |

## End-to-End Architecture

### Core components

- `ExecutorConfig`: bounded defaults, timeouts, pool caps
- `IExecutorService`: public executor API plus Helios-specific task registration surface
- `TaskTypeRegistry`: task registration, fingerprinting, pool metadata
- `ScatterPoolAdapter`: bounded scatter wrapper with health, timeout, and recycle behavior
- `TaskExecutionEngine`: pool lifecycle and dispatch per task type
- `ExecuteCallableOperation` / `MemberCallableOperation`: distributed operation entry points
- `ExecutorContainerService`: server-side accept/enqueue/execute/cancel/shutdown/state tracking
- `ExecutorServiceProxy`: client-facing routing, fan-out, result unwrapping, cancellation future
- `CancellationOperation` / `ShutdownOperation`: distributed control operations
- `ExecutorStatsImpl`: local metrics and health snapshots

### Registered task model

Distributed execution is registration-based.

1. Every node registers the same `taskType` locally.
2. Registration computes a fingerprint.
3. Submitter includes `{ taskType, registrationFingerprint, inputData }` on the wire.
4. Remote member rejects the task before enqueue if the type is unknown or the fingerprint differs.

Helios-specific public extension:

```typescript
executor.registerTaskType('fibonacci', (n: number) => {
  if (n <= 1) return n;
  let a = 0;
  let b = 1;
  for (let i = 2; i <= n; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return b;
}, { version: 'v1' });

const result = await executor.submit<number>({
  taskType: 'fibonacci',
  input: 42,
}).get();
```

### Local inline model

Inline functions are local-only and must never cross the network.

```typescript
const result = await executor.submitLocal<number>({
  taskType: '__inline__',
  input: 42,
  fn: (n) => Number(n) * 2,
}).get();
```

`submitToMember`, `submitToKeyOwner`, `submitToAllMembers`, and distributed `submit` reject
inline tasks with a deterministic validation error.

### Task descriptor on the wire

The proxy sends a descriptor with at least:

- `taskUuid`
- `executorName`
- `taskType`
- `registrationFingerprint`
- `inputData`
- `submitterMemberUuid`
- `timeoutMillis`
- routing metadata (`partitionId` or target member)

### Result envelope on the wire

The server returns an executor-specific response envelope, not raw task data:

```typescript
interface ExecutorOperationResult {
  readonly taskUuid: string;
  readonly status: 'success' | 'cancelled' | 'rejected' | 'task-lost' | 'timeout';
  readonly originMemberUuid: string;
  readonly resultData: Data | null;
  readonly errorName: string | null;
  readonly errorMessage: string | null;
}
```

The proxy unwraps this envelope and deserializes `resultData` before completing the caller's
`InvocationFuture<T>`.

### Failure semantics

| Scenario | Required behavior |
|---|---|
| unknown task type | reject before enqueue with `UnknownTaskTypeException` |
| fingerprint mismatch | reject before enqueue with `TaskRegistrationMismatchException` |
| queue full or pool cap exceeded | reject with `ExecutorRejectedExecutionException` |
| cancel while queued | remove from queue, return `CancellationException` |
| cancel while running | caller gets `CancellationException`, late worker result is dropped |
| member-targeted target leaves | fail immediately, no retry |
| partition migration before remote accept | retry against new owner |
| member dies after remote accept | fail with `ExecutorTaskLostException`, no replay |
| task exceeds configured timeout | fail with `ExecutorTaskTimeoutException`, recycle affected pool |
| shutdown timeout expires | terminate remaining work, fail in-flight tasks explicitly |

## Phase Structure

```text
Block 17.0 - Executor runtime foundation + scatter workspace
    -> 17.1 - ExecutorConfig + HeliosConfig extensions
    -> 17.2 - IExecutorService + TaskCallable contracts
    -> 17.3 - TaskTypeRegistry + registration fingerprinting
    -> 17.4 - ExecuteCallableOperation + MemberCallableOperation + retry rules
    -> 17.5 - ExecutorContainerService + bounded scatter execution engine
    -> 17.6 - ExecutorServiceProxy + future/result handling
    -> 17.7 - CancellationOperation + ShutdownOperation
    -> 17.8 - HeliosInstance wiring + lifecycle + permissions
    -> 17.9 - ExecutorStats + monitoring + overload signals
    -> 17.9A - real executor transport + service-backed container routing
    -> 17.9B - container hot-path rewiring
    -> 17.9C - worker-materializable registration hardening
    -> 17.9D - real control-operation and task-lost semantics
    -> 17.9E - execution-backend seam + parity flag
    -> 17.9F - prerequisite semantic freeze tests
    -> 17.10 - Multi-node integration tests
    -> 17.INT - End-to-end acceptance and rollout gate
```

All blocks are sequential. Phase 17 is intentionally not parallelized because the runtime
prerequisites and failure semantics build on one another.

---

## Ordered Finish-Up Checklist

This checklist reflects the repository's current reality, not just the intended Phase 17 design.
Complete these steps in order before treating Phase 17 as truly end-to-end.
These steps map 1:1 to canonical queue blocks `17.9A`-`17.9F` in
`plans/TYPESCRIPT_PORT_PLAN.md`.

### Step 1 / Block 17.9A - Make executor operations truly remote and service-backed

Primary files:

- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`
- `src/spi/NodeEngine.ts`
- `src/spi/PartitionService.ts`
- `src/spi/impl/NodeEngineImpl.ts`
- `src/instance/impl/HeliosInstanceImpl.ts`

Checklist:

- [ ] finish real non-local `invokeOnTarget()` and `invokeOnPartition()` transport for executor use
- [ ] preserve response correlation, binary payload transport, and remote error propagation
- [ ] expose partition-owner, migration, and member-left signals needed by executor routing
- [ ] register a real member-local executor container service instead of relying on proxy-local state
- [ ] make instance shutdown await executor-aware service shutdown

Exit gate:

- a distributed executor operation can reach a non-local member, invoke a member-local service,
  and fail with real transport/member errors instead of local stubs

### Step 2 / Block 17.9B - Put `ExecutorContainerService` on the hot path

Primary files:

- `src/executor/impl/ExecuteCallableOperation.ts`
- `src/executor/impl/MemberCallableOperation.ts`
- `src/executor/impl/ExecutorContainerService.ts`
- `src/executor/impl/ExecutorServiceProxy.ts`

Checklist:

- [ ] stop executing `desc.factory(input)` directly inside executor operations
- [ ] make `ExecuteCallableOperation` validate registration then delegate to a resolved container
- [ ] make `MemberCallableOperation` use the same container path while preserving no-retry semantics
- [ ] resolve containers by `executorName` from a real member-local service registry
- [ ] keep the existing executor result-envelope contract stable for callers

Exit gate:

- no distributed executor task is executed by directly invoking the registered factory from an
  operation class

### Step 3 / Block 17.9C - Harden registration so tasks are worker-materializable

Primary files:

- `src/executor/IExecutorService.ts`
- `src/executor/impl/TaskTypeRegistry.ts`
- executor registration tests

Checklist:

- [ ] extend `registerTaskType()` metadata so distributed tasks describe how they load in a worker
- [ ] store worker materialization metadata in `TaskTypeRegistry`, not only `{ factory, version, poolSize }`
- [ ] include worker materialization metadata in the fingerprint contract
- [ ] validate that distributed registrations are worker-safe before accepting them
- [ ] prefer module-backed distributed task registration over closure-dependent raw functions
- [ ] preserve `submitLocal` / `executeLocal` as the only inline-function path

Exit gate:

- every distributed task registration carries enough information for a future Scatter adapter to
  materialize the task on every member without closure access

### Step 4 / Block 17.9D - Finish cancellation, timeout, shutdown, and task-lost semantics

Primary files:

- `src/executor/impl/CancellationOperation.ts`
- `src/executor/impl/ShutdownOperation.ts`
- `src/executor/impl/ExecutorServiceProxy.ts`
- `src/executor/impl/ExecutorContainerService.ts`
- invocation/member-left handling files

Checklist:

- [ ] wire `CancellationOperation` to the resolved container and return real results
- [ ] wire `ShutdownOperation` to the resolved container and wait for drain/timeout
- [ ] make proxy futures cancel back to the member that accepted the task
- [ ] produce real `task-lost` results for member death after remote accept
- [ ] preserve strong queued cancel and logical in-flight cancel with late-result drop accounting
- [ ] define shutdown-timeout fallback behavior explicitly and test it

Exit gate:

- all executor statuses (`success`, `cancelled`, `rejected`, `task-lost`, `timeout`) are produced
  by real runtime paths, not only surfaced by types and proxy mapping

### Step 5 / Block 17.9E - Add an internal execution-backend seam before swapping to Scatter

Primary files:

- new internal executor runtime files
- `src/executor/impl/ExecutorContainerService.ts`
- `src/config/ExecutorConfig.ts`
- stats files

Checklist:

- [ ] introduce an internal execution-backend abstraction owned by Helios
- [ ] keep the public executor API stable while allowing `inline` and `scatter` backends internally
- [ ] add a temporary runtime/config flag for parity testing during the backend swap
- [ ] keep stats and lifecycle behavior backend-independent

Exit gate:

- Helios can run the same executor semantics through a backend seam, making the later Scatter swap
  an implementation change rather than an API rewrite

### Step 6 / Block 17.9F - Freeze semantics with tests before full Scatter integration

Primary files:

- executor unit/integration test suites
- multi-node executor tests

Checklist:

- [ ] unit-test queueing, pool caps, cancellation, timeout, shutdown, and late-result handling
- [ ] add multi-node tests for member-targeted no-retry, partition retry-before-accept, and task-lost after accept
- [ ] add registration mismatch/unknown-task tests using the new worker-materialization metadata
- [ ] prove executor shutdown drains or fails deterministically across instance shutdown
- [ ] keep existing Phase 16 transport/invocation coverage green while executor semantics are tightened

Exit gate:

- only after Steps 1-6 are green should Phase 17 proceed to the final Scatter-backed multi-node
  integration and rollout gates in Blocks `17.10` and `17.INT`

---

## Block 17.0 - Executor Runtime Foundation + Scatter Workspace

### Goal

Close the runtime gaps that would otherwise make the executor plan fake-end-to-end.

### Required changes

- Add scatter as a workspace dependency.
- Finish the remote `OperationServiceImpl` path for production executor use using the existing
  cluster transport message types.
- Extend `NodeEngine` with the cluster/runtime surfaces the executor actually needs.
- Extend `PartitionService` with owner/migration queries needed for routing.
- Ensure operation payloads/responses use the binary-safe serialization path; do not leak raw
  `Data` values to public API callers.
- Add internal graceful shutdown hook support so executor services can be awaited during node
  shutdown. If a public async hook is needed, add `shutdownAsync(): Promise<void>` while keeping
  `shutdown()` as a compatibility wrapper.

### Primary files

- `package.json`
- `src/spi/NodeEngine.ts`
- `src/spi/PartitionService.ts`
- `src/spi/impl/NodeEngineImpl.ts`
- `src/spi/impl/operationservice/Operation.ts`
- `src/spi/impl/operationservice/Invocation.ts`
- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`
- `src/cluster/tcp/ClusterMessage.ts`
- `src/instance/impl/HeliosInstanceImpl.ts`

### Test plan (~12 tests)

- remote `invokeOnTarget` round-trip over cluster transport
- remote `invokeOnPartition` round-trip to current owner
- response correlation by `callId`
- remote error propagation preserves error class/message
- `PartitionService.getPartitionOwner()` used by invocation routing
- migration guard exposed to caller path
- binary operation payload survives transport round-trip
- graceful shutdown hook awaits registered services
- existing Phase 16 invocation tests remain green

---

## Block 17.1 - ExecutorConfig + HeliosConfig Extensions

### Goal

Introduce bounded, production-safe executor configuration.

### Required changes

Add `src/config/ExecutorConfig.ts` with at least:

- `name`
- `poolSize` (default `min(16, navigator.hardwareConcurrency)`)
- `queueCapacity` (default `1024`, never unbounded by default)
- `maxActiveTaskTypePools` (default `32`)
- `poolIdleMillis` (default `300_000`)
- `taskTimeoutMillis` (default `300_000`)
- `shutdownTimeoutMillis` (default `10_000`)
- `statisticsEnabled` (default `true`)
- `splitBrainProtectionName`

Validation rules:

- `poolSize > 0`
- `queueCapacity > 0`
- `maxActiveTaskTypePools > 0`
- `taskTimeoutMillis >= 0`
- `shutdownTimeoutMillis > 0`
- if `splitBrainProtectionName` is set but unsupported for Phase 17, fail fast during config
  verification; do not accept and silently ignore it

Update `HeliosConfig` with executor-config storage and lookup.

### Test plan (~8 tests)

- defaults are bounded and non-zero
- fluent builder/getters round-trip
- invalid negative/zero values throw
- named config lookup works
- unknown executor falls back to default config
- unsupported split-brain config fails fast

---

## Block 17.2 - IExecutorService + TaskCallable Contracts

### Goal

Define a public API that matches Helios reality rather than the earlier draft's missing methods.

### Required changes

`IExecutorService` must include:

- Hazelcast-style execution methods: `submit`, `submitToMember`, `submitToKeyOwner`,
  `submitToAllMembers`, `submitToMembers`, `execute`, `executeOnMember`,
  `executeOnKeyOwner`, `executeOnAllMembers`
- Helios-specific registration methods: `registerTaskType`, `unregisterTaskType`,
  `getRegisteredTaskTypes`
- local-only inline helpers: `submitLocal`, `executeLocal`
- lifecycle: `shutdown(): Promise<void>`, `isShutdown()`
- stats: `getLocalExecutorStats()`

Task contracts:

```typescript
export interface TaskCallable<T> {
  readonly taskType: string;
  readonly input: unknown;
}

export interface InlineTaskCallable<T> {
  readonly taskType: '__inline__';
  readonly input: unknown;
  readonly fn: (input: unknown) => T | Promise<T>;
}
```

Add `PartitionAware` support using `task.input.getPartitionKey()` when present.

### Test plan (~10 tests)

- interface compiles with full public surface
- registration methods exist on executor service
- inline/local-only methods reject remote routing
- `PartitionAware` routing uses key partition
- `submitToAllMembers` / `submitToMembers` signatures compile
- new executor error classes export cleanly

---

## Block 17.3 - TaskTypeRegistry + Registration Fingerprinting

### Goal

Make pre-registration safe for rolling deploys and multi-node verification.

### Required changes

Create `src/executor/impl/TaskTypeRegistry.ts` and related types.

Each registration stores:

- `taskType`
- `factory`
- `version` (optional explicit rollout version)
- `fingerprint`
- optional task-type-specific pool overrides

Fingerprint rule:

- preferred: explicit `version`
- fallback: hash of normalized `factory.toString()`

Distributed submissions must include the fingerprint. Remote members compare it to their local
registration before enqueue.

Define clear failures:

- `UnknownTaskTypeException`
- `TaskRegistrationMismatchException`

### Test plan (~10 tests)

- register/get/unregister round-trip
- duplicate register replaces existing descriptor
- explicit version becomes fingerprint seed
- fallback fingerprint derived deterministically from factory source
- unknown task type throws expected error
- mismatch between local and remote fingerprint rejects before enqueue

---

## Block 17.4 - ExecuteCallableOperation + MemberCallableOperation + Retry Rules

### Goal

Add executor operations with explicit retry boundaries and typed result envelopes.

### Required changes

- Add `ExecuteCallableOperation`
- Add `MemberCallableOperation`
- Add executor response envelope type
- Extend invocation retry policy so member-targeted tasks can opt out of retry on member loss
- Distinguish pre-acceptance retryable failures from post-acceptance task-lost failures

Required retry rules:

- `MemberCallableOperation`: never retry on `MemberLeftException` or `TargetNotMemberException`
- partition-targeted executor ops: retry on `WrongTargetException` and `PartitionMigratingException`
  only until the remote member accepts the task
- after remote accept, any member loss becomes `ExecutorTaskLostException`

### Test plan (~12 tests)

- operation serializes/deserializes descriptor fields
- successful operation returns typed executor result envelope
- unknown task type returns rejection envelope
- member-targeted no-retry on member departure
- partition-targeted pre-acceptance retry on migration
- post-acceptance failure maps to task-lost error
- response sent exactly once per task UUID

---

## Block 17.5 - ExecutorContainerService + Bounded Scatter Execution Engine

### Goal

Implement the server-side execution engine with bounded memory and deterministic failure handling.

### Required changes

Create:

- `src/executor/impl/ScatterPoolAdapter.ts`
- `src/executor/impl/TaskExecutionEngine.ts`
- `src/executor/impl/ExecutorContainerService.ts`

Required behavior:

- one scatter pool per task type, created lazily
- cap active task-type pools using `maxActiveTaskTypePools`
- evict idle pools after `poolIdleMillis`
- reject new work when queue capacity is full
- maintain task handles keyed by UUID with explicit state enum
- queued cancel removes task from queue
- in-flight cancel marks caller cancelled and drops late result
- task timeout fails task with `ExecutorTaskTimeoutException` and recycles the affected pool
- degraded pool (`workersAlive < configured`) is recycled before more work is accepted

Suggested task states:

- `QUEUED`
- `RUNNING`
- `CANCELLED`
- `COMPLETED`
- `FAILED`
- `TIMED_OUT`
- `TASK_LOST`

### Test plan (~15 tests)

- lazy pool creation on first use
- queue full rejection is deterministic
- idle pool eviction works
- pool cap enforcement works
- executeTask deserializes input and serializes result
- queued cancel removes handle and rejects future
- running cancel drops late result
- timeout recycles pool and fails task
- degraded pool detection triggers recycle
- handles cleaned up after completion/failure/cancel

---

## Block 17.6 - ExecutorServiceProxy + Future/Result Handling

### Goal

Implement the caller-facing executor proxy with correct routing and result unwrapping.

### Required changes

Create `src/executor/impl/ExecutorServiceProxy.ts` and `CancellableFuture` support.

Proxy responsibilities:

- resolve partition owner/member target using current cluster/partition services
- serialize input to `Data`
- attach registration fingerprint
- unwrap executor result envelope and deserialize `resultData`
- support `submitToAllMembers` / `submitToMembers` fan-out
- expose local inline fast path for `submitLocal` / `executeLocal`

### Test plan (~16 tests)

- submit routes to partition owner and returns typed result
- `PartitionAware` input routes by partition key
- submitToMember routes to fixed target
- submitToKeyOwner routes to key owner
- submitToAllMembers fans out and collects results
- proxy unwraps `Data` to `T`
- registration mismatch surfaces clean error to caller
- inline local path works and remote inline path rejects
- `CancellableFuture.cancel()` routes to original execution target

---

## Block 17.7 - CancellationOperation + ShutdownOperation

### Goal

Add distributed control operations for cancel and executor shutdown.

### Required changes

- `CancellationOperation` routes to the same owner/target used for the original task
- `ShutdownOperation` marks the named executor closed on all members
- shutdown rejects new tasks immediately
- shutdown drains until `shutdownTimeoutMillis`, then terminates remaining pools and fails the
  remaining tasks explicitly

### Test plan (~8 tests)

- cancel known queued task returns `true`
- cancel unknown task returns `false`
- cancel already-completed task returns `false`
- cluster-wide shutdown closes named executor on all members
- shutdown timeout triggers pool terminate fallback
- duplicate shutdown is idempotent

---

## Block 17.8 - HeliosInstance Wiring + Lifecycle + Permissions

### Goal

Expose the executor through the public instance facade and integrate lifecycle cleanly.

### Required changes

- add `getExecutorService(name)` to `HeliosInstance`
- create/cache proxies by executor name
- register `ExecutorContainerService` with `NodeEngine`
- expose any missing cluster service runtime needed by executor code
- wire executor draining into node shutdown path via awaited shutdown hook
- keep `getScheduledExecutorService()` as a deterministic stub
- use `ExecutorServicePermission` when the broader security enforcement path is active

If needed for graceful shutdown, add `shutdownAsync(): Promise<void>` to `HeliosInstance` or
`HeliosInstanceImpl` while keeping `shutdown()` as a compatibility wrapper.

### Test plan (~10 tests)

- `getExecutorService(name)` returns cached proxy
- executor config is applied by name
- executor service registered in node engine
- shutdown path awaits executor drain hook
- named executors coexist with different configs
- scheduled executor stub message stays explicit and deterministic

---

## Block 17.9 - ExecutorStats + Monitoring + Overload Signals

### Goal

Add observability needed for rollout and operations.

### Required changes

`LocalExecutorStats` must include at least:

- `pending`
- `started`
- `completed`
- `cancelled`
- `rejected`
- `timedOut`
- `taskLost`
- `lateResultsDropped`
- `totalStartLatencyMs`
- `totalExecutionTimeMs`
- `activeWorkers`
- `workersAlive`

Expose snapshots only, never live mutable objects.

### Test plan (~8 tests)

- counters move correctly through task lifecycle
- start latency and execution time accumulate correctly
- queue rejection increments `rejected`
- timeout increments `timedOut`
- late result after cancel increments `lateResultsDropped`
- snapshot is immutable from caller perspective

---

## Block 17.9A - Real Executor Transport + Service-Backed Container Routing

### Goal

Close the remaining gap between the Phase 17 executor API surface and the actual distributed
runtime path.

### Required changes

- finish real non-local `invokeOnTarget()` / `invokeOnPartition()` transport for executor use
- preserve response correlation, binary payload transport, and remote error propagation
- expose partition-owner, migration, and member-left signals needed by executor routing
- register a real member-local executor container service instead of relying on proxy-local state
- make instance shutdown await executor-aware service shutdown

### Primary files

- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`
- `src/spi/NodeEngine.ts`
- `src/spi/PartitionService.ts`
- `src/spi/impl/NodeEngineImpl.ts`
- `src/instance/impl/HeliosInstanceImpl.ts`

### Test plan (~12 tests)

- remote `invokeOnTarget` reaches a non-local member for executor operations
- remote `invokeOnPartition` resolves current owner and round-trips successfully
- response correlation remains correct for concurrent executor calls
- remote error propagation preserves executor error class/message
- partition-owner/migration lookup is visible to executor routing
- member-left detection is surfaced distinctly from generic invocation failure
- executor container service is resolved from member-local service wiring
- instance shutdown awaits executor-aware service shutdown hooks

---

## Block 17.9B - Put `ExecutorContainerService` on the Hot Path

### Goal

Ensure distributed executor tasks are always accepted and executed through the container service,
never by directly invoking registered factories from operation classes.

### Required changes

- stop executing `desc.factory(input)` directly inside executor operations
- make `ExecuteCallableOperation` validate registration then delegate to a resolved container
- make `MemberCallableOperation` use the same container path while preserving no-retry semantics
- resolve containers by `executorName` from a real member-local service registry
- keep the existing executor result-envelope contract stable for callers

### Primary files

- `src/executor/impl/ExecuteCallableOperation.ts`
- `src/executor/impl/MemberCallableOperation.ts`
- `src/executor/impl/ExecutorContainerService.ts`
- `src/executor/impl/ExecutorServiceProxy.ts`

### Test plan (~10 tests)

- `ExecuteCallableOperation` delegates to the resolved container
- `MemberCallableOperation` delegates to the resolved container
- direct inline factory execution path is no longer used for distributed tasks
- unknown task type still rejects before enqueue through the container path
- result envelope remains unchanged for successful tasks
- container resolution is by `executorName`, not proxy-local state
- member-targeted no-retry behavior remains intact after rewiring

---

## Block 17.9C - Worker-Materializable Registration Hardening

### Goal

Make distributed task registration describe how a task can be materialized inside a worker, not
just how it runs on the main thread.

### Required changes

- extend `registerTaskType()` metadata so distributed tasks describe how they load in a worker
- store worker materialization metadata in `TaskTypeRegistry`, not only `{ factory, version, poolSize }`
- include worker materialization metadata in the fingerprint contract
- validate that distributed registrations are worker-safe before accepting them
- prefer module-backed distributed task registration over closure-dependent raw functions
- preserve `submitLocal` / `executeLocal` as the only inline-function path

### Primary files

- `src/executor/IExecutorService.ts`
- `src/executor/impl/TaskTypeRegistry.ts`
- related executor registration tests

### Test plan (~10 tests)

- module-backed task registration stores worker materialization metadata correctly
- fingerprint changes when worker materialization metadata changes
- closure-dependent distributed registrations are rejected deterministically
- local inline registration path still works for `submitLocal` / `executeLocal`
- remote inline submissions are still rejected deterministically
- registration mismatch still rejects before enqueue with the stronger fingerprint contract

---

## Block 17.9D - Real Cancel / Shutdown / Task-Lost Runtime Semantics

### Goal

Finish the executor control paths so cancellation, shutdown, and post-acceptance failure
semantics are enforced by real runtime behavior.

### Required changes

- wire `CancellationOperation` to the resolved container and return real results
- wire `ShutdownOperation` to the resolved container and wait for drain/timeout
- make proxy futures cancel back to the member that accepted the task
- produce real `task-lost` results for member death after remote accept
- preserve strong queued cancel and logical in-flight cancel with late-result drop accounting
- define shutdown-timeout fallback behavior explicitly and test it

### Primary files

- `src/executor/impl/CancellationOperation.ts`
- `src/executor/impl/ShutdownOperation.ts`
- `src/executor/impl/ExecutorServiceProxy.ts`
- `src/executor/impl/ExecutorContainerService.ts`
- invocation/member-left handling files

### Test plan (~12 tests)

- queued cancel returns the real container-backed result
- cancelling an accepted remote task routes to the original owner member
- shutdown drains healthy work through the container path
- shutdown timeout triggers explicit fallback behavior
- member death after remote accept surfaces `ExecutorTaskLostException`
- late result after logical cancel is dropped and accounted for
- duplicate cancel/shutdown operations remain deterministic and idempotent where expected

---

## Block 17.9E - Internal Execution Backend Seam + Parity Flag

### Goal

Create a clean Helios-owned seam so swapping from inline execution to Scatter is an internal
backend change rather than an API rewrite.

### Required changes

- introduce an internal execution-backend abstraction owned by Helios
- keep the public executor API stable while allowing `inline` and `scatter` backends internally
- add a temporary runtime/config flag for parity testing during the backend swap
- keep stats and lifecycle behavior backend-independent

### Primary files

- new internal executor runtime files
- `src/executor/impl/ExecutorContainerService.ts`
- `src/config/ExecutorConfig.ts`
- stats files

### Test plan (~8 tests)

- executor container can run through the `inline` backend via the new seam
- backend selection is config-driven and deterministic
- unsupported backend values fail fast
- stats snapshots remain stable across backend choice
- lifecycle behavior (`shutdown`, rejection after close) is backend-independent
- parity flag defaults remain safe for the current rollout stage

---

## Block 17.9F - Prerequisite Semantic Freeze Tests

### Goal

Lock in the corrected executor semantics before the final Scatter-backed multi-node integration
and rollout work.

### Required changes

- add single-node and multi-node tests for the corrected prerequisite semantics
- prove queueing, pool caps, cancellation, timeout, shutdown, and late-result handling through
  the real runtime path
- add registration mismatch/unknown-task tests using the stronger worker-materialization metadata
- prove executor shutdown drains or fails deterministically across instance shutdown
- keep existing Phase 16 transport/invocation coverage green while executor semantics tighten

### Test plan (~14 tests)

- container queueing and pool-cap semantics remain deterministic
- member-targeted no-retry still holds after the routing fixes
- partition retry-before-accept still holds after the routing fixes
- task-lost after remote accept is covered end-to-end before Scatter swap
- registration mismatch and unknown task type both fail before enqueue
- instance shutdown drains or times out deterministically with executors present
- existing invocation transport tests remain green after prerequisite changes

---

## Block 17.10 - Scatter-Backed Multi-Node Integration Tests

### Goal

Prove the Scatter-backed executor works across a real Helios cluster path, not only in isolated
unit tests.

### Required scenarios (~18 tests)

- 3-node `submit()` routes to partition owner and returns result
- `submitToMember()` runs only on the requested member
- `submitToKeyOwner()` respects key affinity
- `submitToAllMembers()` returns one result per member
- member-targeted submission fails without retry when target leaves
- partition-targeted submission retries before remote accept when owner changes
- post-acceptance member death returns `ExecutorTaskLostException`
- registration mismatch fails before enqueue
- queue full rejection is deterministic across nodes
- local inline execution works and remote inline execution rejects
- stats reflect cross-node executions correctly
- executor shutdown propagates to all members

Use the same multi-node runtime path used by the current cluster/invocation stack; do not create
an executor-only fake transport.

---

## Block 17.INT - End-to-End Acceptance and Rollout Gate

### Goal

Prove the Phase 17 deliverable is rollout-ready within Tier 1's non-durable contract.

### Acceptance scenarios (~12 tests)

- full lifecycle: config -> register -> submit -> execute -> result
- 3-node burst of at least 1000 tasks with all results correct
- bounded queue/backpressure under overload (no silent growth, explicit rejection path)
- cancel queued task returns cancellation and task never starts
- cancel running task returns cancellation and late result is dropped
- graceful shutdown drains healthy tasks and respects shutdown timeout for stuck work
- fingerprint mismatch between nodes fails fast during rollout scenario
- task timeout recycles pool and restores capacity for subsequent tasks
- root `bun test` remains 0 fail / 0 error after Phase 17 implementation
- root `bun run tsc --noEmit` is clean

### Rollout rules

Phase 17 is not complete unless all of the following are true:

- no unbounded queue default remains anywhere in executor code
- no executor API returns raw `Data` to callers
- no member-targeted task retries on member departure
- no crash-retry claim remains in docs or tests for accepted Tier 1 tasks
- registration mismatch is covered by an automated test
- shutdown timeout behavior is covered by an automated test

---

## Scope Exclusions

Deferred to Phase 18+:

- `IDurableExecutorService`
- `IScheduledExecutorService`
- task result retrieval after submitter death
- durable ring-buffer replication of submitted tasks
- periodic/stateful scheduled task containers

Not accepted in Phase 17:

- silent ignore of `splitBrainProtectionName`
- remote inline function execution
- unbounded `queueCapacity = 0` semantics
- transparent replay after accepted remote task loss

## Success Criteria

1. `helios.getExecutorService('compute')` returns a working executor proxy.
2. Distributed tasks run on scatter worker threads, not the main event loop.
3. Task registration mismatch is detected before execution begins.
4. Results are deserialized and delivered as typed values.
5. Queueing, active pools, and shutdown are bounded and configurable.
6. Cancellation, timeout, and task-lost paths are explicit and covered by tests.
7. Member-targeted no-retry and partition-targeted pre-acceptance retry are both enforced.
8. Phase 17 tests pass and the full repository stays green.

*Plan v2.2 - updated 2026-03-05 | Scope: Phase 17 Tier 1 only | Contract: immediate, non-durable, non-scheduled distributed executor | Canonical queue: `plans/TYPESCRIPT_PORT_PLAN.md` Master Todo | Deferred: durable executor + scheduled executor (Phase 18+)*
