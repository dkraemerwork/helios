# Executor Scatter Production Plan

## Purpose

Reopen executor work until Helios distributed executor is honestly off-main-thread,
service-backed, and production ready. Historical Phase 17 closed the API surface, but
the current runtime still leaves distributed work inline on the main Bun event loop and
keeps fallback paths that make the feature non-production.

## Block Contract

- `plans/TYPESCRIPT_PORT_PLAN.md` is the canonical loop-selection source.
- `Block 17R.1` in that file is implemented against this document.
- Do not mark the block complete while any distributed executor path can still execute
  task factories inline on the main event loop, bypass member-local services, or silently
  fall back from Scatter to inline execution.

## Locked Product Decisions

- Prefer `@zenystx/scatterjs` worker classes only if they preserve
  Helios module-backed task registration, per-task-type pool ownership, deterministic
  recycle and shutdown behavior, and fail-closed health semantics.
- The implementation must include an explicit checked-in proof-and-decision step for the
  worker-class path versus a Helios-owned `scatter.pool()` adapter. If that proof is not
  complete, the production path defaults to the Helios-owned adapter rather than leaving
  the architecture branch implicit.
- If the worker-class path adds proxy or state-snapshot magic, or weakens deterministic
  lifecycle behavior, use a Helios-owned `scatter.pool()` adapter instead.
- Distributed `submit*` requires module-backed worker materialization metadata
  (`modulePath`, `exportName`); closure-only registrations stay local-only via
  `submitLocal()` and `executeLocal()`.
- `scatter` is the only supported production backend. `inline` is restricted to explicit test/dev
  bootstrap and parity-check flows only, and production-mode startup must reject it unless an
  explicit testing override is set.
- If Scatter is configured but unavailable, unhealthy, or degraded beyond Helios safety
  rules, fail closed; never silently move distributed executor work back onto the main
  event loop.
- Worker crash or task timeout recycles the affected task-type pool. Fail in-flight work
  explicitly, drop late results, and lazily rebuild only on future submissions.

## Repo Reality That Keeps Executor Reopened

- `src/instance/impl/HeliosInstanceImpl.ts` currently creates `ExecutorServiceProxy` and
  `TaskTypeRegistry` only; it does not yet prove real member-local executor container
  ownership end to end.
- `src/executor/impl/ExecuteCallableOperation.ts` still contains a direct factory
  execution fallback, which keeps distributed execution honest only on paper.
- `src/executor/impl/InlineExecutionBackend.ts` is the only concrete backend today.
- `src/config/ExecutorConfig.ts` exposes `inline | scatter`, but current runtime wiring
  does not yet prove the `scatter` path is real and production-safe.

## Production Target

When this block is done:

- the Bun main event loop owns transport, routing, backpressure, and response correlation
  only
- every distributed executor task body runs off-thread in Scatter workers
- no operation class can execute `desc.factory(input)` directly for distributed work
- every named executor has real member-local registry and container ownership
- distributed registration is worker-materializable and rejected early if not
- worker crash, timeout, cancel, shutdown, member-left, and late-result semantics are
  deterministic and acceptance-tested
- docs, examples, exports, and config defaults describe only the runtime Helios actually
  ships

## Non-Goals

- durable executor or scheduled executor
- closure serialization for distributed tasks
- silent auto-repair that hides worker crashes by falling back to inline execution
- sharing one generic worker pool across unrelated task types

## Ordered Implementation Tracks

### Track A - Runtime ownership and no-fallback closure

- Register real member-local executor registry and container services per executor name in
  `HeliosInstanceImpl` and bind them into shutdown lifecycle.
- Define whether named executor runtime ownership is eager or lazy and make that lifecycle
  deterministic for startup health checks, shutdown ordering, and stats visibility.
- Make `ExecuteCallableOperation`, `MemberCallableOperation`, `CancellationOperation`, and
  `ShutdownOperation` resolve those services from real runtime ownership only.
- Delete the direct `desc.factory(input)` distributed fallback from operation classes.
- Track accepted owner and member identity so cancel and task-lost semantics use the
  member that actually accepted the task, not proxy-local guesses.
- Define exactly where accepted-owner state lives and the exact transition point from
  retryable pre-accept routing to post-accept non-retryable task-lost behavior.
- Wire cluster member-left and local shutdown signals into executor containers and
  outstanding invocations so accepted tasks become `task-lost` and queued work drains or
  fails from real runtime events rather than plan-only semantics.
- Make proxy shutdown and cancel behavior end to end: reject new work once shutdown starts,
  complete outstanding futures deterministically, and preserve post-shutdown health and
  stats semantics.

### Track B - Scatter execution engine

- Add a Helios-owned Scatter backend or adapter behind `ExecutionBackend`.
- Replace the current distributed execution contract based on raw `(factory, inputData)`
  invocation with a worker-materializable contract carrying `taskType`, `modulePath`,
  `exportName`, serialized input, timeout, and correlation metadata; no backend may
  receive or invoke raw distributed factories.
- First evaluate the published `@zenystx/scatterjs` worker-class runtime against Helios
  rules:
  - module-backed task loading only
  - no serialized instance-state proxy contract
  - one task-type pool per named executor task type
  - deterministic terminate, shutdown, and recycle hooks
  - observable pool health and fail-closed startup
- If any rule is violated or cannot be proven, implement the production path on
  `@zenystx/scatterjs` `scatter.pool()` instead.
- Keep bounded queueing, bounded concurrency, and per-task-type pool ownership in Helios,
  not hidden inside an unbounded generic wrapper.
- Implement the worker bootstrap and loader contract end to end: worker entrypoint,
  module resolution rules, `modulePath` and `exportName` loading, input and result
  serialization, error serialization, timeout handoff, and packaged-runtime path handling.
- Wire any new Scatter adapter or loader artifacts through package exports and installed
  runtime resolution so production use does not depend on repo-relative paths.

### Track C - Registration hardening

- Require worker materialization metadata in the public registration API for all
  distributed registrations.
- Keep inline closures legal only for `submitLocal()` and `executeLocal()`.
- Include worker materialization metadata in fingerprint validation so mismatched worker
  loading details are rejected before enqueue.
- Make registration and submission errors explicit and deterministic; never accept a task
  that cannot be materialized inside a worker.
- Reject distributed `submit*` and `execute*` locally before invoke when the registered
  task is not worker-materializable.

### Track D - Defaults, health, and recycle policy

- Make `scatter` the only production backend and keep `inline` legal only for explicit test/dev
  bootstrap flows.
- Define the exact defaulting and validation rules through `ExecutorConfig`, `HeliosConfig`, and
  any file-config or bootstrap entrypoint touched by executor config so production-mode startup
  rejects `inline` unless an explicit testing override is set, while dev and test behavior stay
  honest and deterministic.
- Define the explicit testing override contract by name and scope, require it to be opt-in rather
  than inferred from backend choice alone, and forbid docs/examples from presenting it as a
  production runtime switch.
- Fail fast if the configured Scatter backend cannot initialize, cannot spawn healthy
  workers, or loses the minimum health required by Helios semantics.
- Recycle the affected task-type pool on worker crash or task timeout.
- Define timeout and shutdown fallback explicitly: fail outstanding work, terminate
  degraded workers, and surface deterministic errors to callers.
- Define ongoing health ownership after startup: who monitors worker health, what the
  degradation threshold is, whether fail-closed scope is task-type pool, named executor,
  or instance, and what surfaced error callers receive.

### Track E - Proof, docs, and rollout gate

- Add single-node and multi-node acceptance coverage for:
  - no distributed work on the main event loop
  - member-targeted no-retry
  - partition retry only before remote accept
  - task-lost after accept
  - queued cancel vs in-flight logical cancel
  - worker crash recycle
  - timeout recycle
  - fail-closed Scatter startup and health behavior
  - production-mode startup with executor backend `inline` fails fast unless the explicit testing
    override is set
  - deterministic shutdown drain and timeout fallback
- Prove off-main-thread execution by observable worker-thread identity or another
  worker-only signal, not by timing heuristics alone.
- Update docs, examples, and config guidance to state that distributed tasks must be
  module-backed and that `inline` is limited to explicit test/dev bootstrap flows with a testing
  override, not a supported production runtime or silent production fallback.
- Update exports, test-support utilities, and any file-config documentation so installed
  package use, examples, and tests all describe the same executor rules.
- Do not close the block until root executor suites and targeted real multi-node executor
  suites are green with the Scatter-backed path enabled.

## Exit Gate

This plan is not complete until all of the following are true:

- `src/executor/impl/ExecuteCallableOperation.ts` has no distributed inline fallback path
- `src/instance/impl/HeliosInstanceImpl.ts` owns real executor registry and container
  lifecycle
- `src/executor/impl/ExecutionBackend.ts` has a real Scatter-backed production
  implementation
- `src/config/ExecutorConfig.ts` defaults and validation match the fail-closed policy, including
  rejecting production-mode `inline` unless the explicit testing override is set
- automated proof shows production-mode startup with executor backend `inline` fails fast without
  the explicit testing override
- every distributed task registration is module-backed and worker-materializable
- no acceptance proof path depends on keeping executor work on the main event loop
- crash, timeout, shutdown, and member-loss semantics are proven by real tests
- all Scatter adapter, worker-loader, export, and packaging surfaces are resolvable in an
  installed-package runtime, not only in repo-local tests

## Files That Must Be Treated As In Scope

- `plans/TYPESCRIPT_PORT_PLAN.md`
- `plans/DISTRIBUTED_EXECUTOR_PLAN.md`
- `package.json`
- `src/config/ExecutorConfig.ts`
- `src/executor/`
- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/spi/impl/NodeEngineImpl.ts`
- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`
- `src/cluster/` and `src/internal/partition/`
- `src/index.ts`
- `test/executor/`
- `test/instance/`
- `@zenystx/scatterjs` package and upstream runtime source/docs if worker-class or
  `scatter.pool()` behavior needs source-level verification
