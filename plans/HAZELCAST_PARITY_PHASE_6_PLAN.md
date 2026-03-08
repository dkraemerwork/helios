# Hazelcast Parity Phase 6 Plan

## Purpose

This plan defines the remaining implementation work required for Helios to reach practical
Hazelcast-equivalent cluster-core performance/runtime parity after the completed transport work in
Phases 1-5.

This is an execution plan, not a research note. It is specifically about the remaining parity gaps
after binary wire protocol, batching, pooling, timeout sweeping, and scatter-backed outbound encode
were completed in the Helios runtime.

This plan is subordinate to `plans/TYPESCRIPT_PORT_PLAN.md`, but authoritative for the remaining
Hazelcast-parity closure items in the clustered operation path. It may tighten scope, sequencing,
and acceptance detail, but it must not weaken the parity goal.

Implementation constraints for this plan:

- Bun-native and TypeScript-native only
- no fake parity claims based on benchmark deltas alone
- no test-only or local-only bypasses in production paths
- no "message type exists" parity claims unless the production runtime uses it end to end
- no block is complete unless real clustered runtime tests prove the new behavior

**Repo:** `/Users/zenystx/IdeaProjects/helios/`
**Java reference:** `/Users/zenystx/IdeaProjects/helios-1/` (read-only)

---

## Why This Plan Exists

Helios now matches Hazelcast in several core transport optimizations:

- binary member-to-member framing
- stateful frame decoding
- outbound batching
- wire buffer pooling
- invocation timeout sweeping
- ordered scatter-backed outbound encoding

Those wins matter, but they do not by themselves make Helios Hazelcast-equivalent. Hazelcast still
has stronger clustered invocation supervision, backup-ack semantics, replica-sync protocol
robustness, and remote-path backpressure control.

As a result, Helios is now much closer on the raw wire path, but still has cluster-runtime parity
gaps in the parts that make Hazelcast reliable and fast under sustained load, backup pressure, and
node failure.

---

## Hazelcast Semantics Still To Match

The implementation in `helios` should match these Hazelcast behaviors in intent:

1. Remote invocations are supervised throughout their lifecycle, not just timed out eventually.
2. Backup-aware operations do not complete as fully successful before required backup acknowledgements
   are tracked correctly.
3. Replica sync is a real correlated network protocol with retry, stale-response rejection, and
   chunk-safe large-state handling.
4. The remote invocation path is bounded and backpressure-aware instead of allowing effectively
   unbounded in-flight pressure.

Primary Java reference points:

- `hazelcast/src/main/java/com/hazelcast/spi/impl/operationservice/impl/InvocationMonitor.java`
- `hazelcast/src/main/java/com/hazelcast/spi/impl/operationservice/impl/InboundResponseHandler.java`
- `hazelcast/src/main/java/com/hazelcast/spi/impl/operationservice/impl/responses/NormalResponse.java`
- `hazelcast/src/main/java/com/hazelcast/spi/impl/sequence/CallIdSequenceWithBackpressure.java`
- `hazelcast/src/main/java/com/hazelcast/spi/impl/operationservice/impl/BackpressureRegulator.java`
- `hazelcast/src/main/java/com/hazelcast/internal/partition/operation/PartitionReplicaSyncRequest.java`
- `hazelcast/src/main/java/com/hazelcast/internal/partition/operation/PartitionReplicaSyncResponse.java`

---

## Current Helios State

### What already matches well enough

- Binary cluster transport is implemented in `src/cluster/tcp/BinarySerializationStrategy.ts`
- Stateful frame decode is implemented in `src/cluster/tcp/TcpClusterTransport.ts`
- Outbound batching is implemented in `src/cluster/tcp/OutboundBatcher.ts`
- Wire buffer pooling is implemented in `src/internal/util/WireBufferPool.ts`
- Pending-response timeout sweeping is implemented in `src/instance/impl/HeliosInstanceImpl.ts`
- Ordered scatter outbound encoding is implemented in `src/cluster/tcp/ScatterOutboundEncoder.ts`

### What still does not match Hazelcast parity

| Area | Helios Gap | Java Reference |
|------|------------|----------------|
| Invocation supervision | timeout sweeper exists, but not full invocation monitor semantics | `InvocationMonitor.java` |
| Backup completion | clustered path does not yet enforce real backup ack accounting | `NormalResponse.java`, `InboundResponseHandler.java` |
| Replica sync protocol | no full request correlation, retry, stale-response rejection, chunk-safe large transfer contract | `PartitionReplicaSyncRequest.java`, `PartitionReplicaSyncResponse.java` |
| Remote backpressure | no Hazelcast-equivalent bounded in-flight invocation regulator on the real remote path | `CallIdSequenceWithBackpressure.java`, `BackpressureRegulator.java` |

---

## Design Rules

- Performance parity claims must include correctness parity on the clustered runtime path.
- If Hazelcast waits for backup accounting, Helios must not claim parity while completing early.
- If Hazelcast bounds pressure, Helios must not claim parity while allowing unbounded remote
  invocation growth.
- Replica sync must be robust under delay, retry, duplicate response, and large state transfer.
- Production code must have one real path. Test helpers may inject failure, but not alternate
  production semantics.
- New runtime supervision must compose cleanly with the already-completed binary transport,
  batching, pooling, and scatter encoding work.

---

## Priority Order

The blocks below are ordered by parity importance, not by microbenchmark impact.

1. Invocation monitor parity
2. Backup ack parity
3. Replica sync parity
4. Remote backpressure parity
5. Scatter/control-path cleanup and remaining allocator cleanup

Blocks P1-P4 are required for Hazelcast-equivalent clustered parity. Block P5 is recommended follow-up
performance cleanup, but is not the main semantic parity gap.

---

## Implementation Blocks

### Block P1 - Invocation Monitor Parity

Goal: upgrade Helios from "timeouts eventually get swept" to full clustered invocation supervision.

Tasks:

- Replace the current timeout-only pending-response supervision with a real invocation monitor layer.
- Track invocation creation time, last-progress/last-response activity, target member, required backup
  count, and member-left invalidation state.
- On member removal, fail matching pending invocations deterministically instead of waiting for the
  sweeper deadline.
- Add explicit handling for late responses, duplicate responses, and late backup acknowledgements.
- Add monitor-driven timeout/cleanup hooks rather than relying only on the generic pending map walk.

Primary touched areas:

- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/instance/impl/PendingResponseEntryPool.ts`
- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`
- `src/instance/impl/HeliosClusterCoordinator.ts`

Acceptance criteria:

- Pending clustered invocations are failed promptly when the target member leaves.
- Duplicate or late responses do not corrupt invocation completion state.
- Timeout handling and member-left handling share one authoritative invocation state machine.
- Multi-node tests prove that a departed target does not leave orphaned or indefinitely pending calls.

Suggested tests:

- target member leaves during invocation
- response arrives after timeout
- duplicate response arrives after successful completion
- backup ack arrives after failure/completion and is ignored safely

---

### Block P2 - Real Backup Ack Integration

Goal: make backup-aware clustered operation completion semantics match Hazelcast's intent.

Tasks:

- Wire `BACKUP` and `BACKUP_ACK` into the production clustered operation path.
- Add required-backup and received-backup accounting to invocation state.
- Ensure primary completion and backup completion are coordinated according to the operation contract.
- Stop treating all remote successes as if `backupAcks=0`.
- Make backup ack timeout behavior explicit and monitor-driven.

Primary touched areas:

- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/spi/impl/operationservice/impl/OperationServiceImpl.ts`
- `src/cluster/tcp/ClusterMessage.ts`
- `src/cluster/tcp/TcpClusterTransport.ts`
- map/partition backup-aware operation classes under `src/internal/partition/` and `src/map/`

Acceptance criteria:

- backup-aware operations send backup work to replica owners on the real clustered path
- `BACKUP_ACK` is consumed and associated with the correct invocation
- invocation completion state reflects required vs received backup count
- backup ack timeout is observable, bounded, and tested

Suggested tests:

- sync backup operation with successful ack
- delayed backup ack
- missing backup ack timeout
- backup target leaves before ack

---

### Block P3 - Replica Sync Correlation, Retry, and Chunking

Goal: make Helios replica sync protocol robust enough to match Hazelcast-style recovery semantics.

Tasks:

- Add sync request correlation IDs to recovery sync request/response messages.
- Reject stale or duplicate sync responses.
- Add retryable timeout cleanup for outstanding sync requests.
- Introduce chunked transfer for large namespace or partition state payloads.
- Define deterministic apply/finalize behavior for multi-chunk sync completion.
- Ensure namespace-scoped sync remains authoritative, not metadata-only.

Primary touched areas:

- `src/internal/partition/impl/InternalPartitionServiceImpl.ts`
- `src/internal/partition/operation/PartitionReplicaSyncRequest.ts`
- `src/internal/partition/operation/PartitionReplicaSyncResponse.ts`
- `src/internal/partition/operation/PartitionBackupReplicaAntiEntropyOp.ts`
- `src/cluster/tcp/ClusterMessage.ts`
- `src/instance/impl/HeliosInstanceImpl.ts`

Acceptance criteria:

- every sync response is correlated to a live request id
- stale responses are rejected safely
- retries do not double-apply namespace state
- large sync payloads are transferred without one-shot oversized message assumptions
- owner crash/rejoin and delayed network tests prove replica repair remains correct

Suggested tests:

- delayed sync response after retry
- duplicate sync response
- large namespace state requiring multiple chunks
- sync request timeout and retry completion

---

### Block P4 - Remote Invocation Backpressure Parity

Goal: bound the clustered remote path the way Hazelcast bounds in-flight pressure.

Tasks:

- Introduce a real remote invocation admission regulator for the clustered path.
- Cap in-flight invocation count or call-id budget per member/runtime.
- Define explicit behavior when the limit is reached: reject, wait, or shed according to one
  deterministic policy.
- Add visibility/metrics for throttling and rejected admission.
- Ensure the new regulator cooperates with batching and scatter outbound encoding rather than
  bypassing them.

Primary touched areas:

- `src/instance/impl/HeliosInstanceImpl.ts`
- `src/spi/impl/operationservice/InvocationRegistry.ts`
- `src/config/HeliosConfig.ts`
- `src/config/ConfigLoader.ts`

Acceptance criteria:

- remote invocation growth is bounded under stress
- admission behavior is deterministic and tested
- the system does not create unbounded pending remote work under a slow or failing cluster
- regulator behavior is observable in tests and logs/metrics

Suggested tests:

- force slow remote target and saturate invocation limit
- verify bounded in-flight count
- verify timeout/retry/member-left logic still works with regulator enabled

---

### Block P5 - Post-Parity Hot-Path Cleanup

Goal: clean up remaining obvious transport-path inefficiencies after parity-critical runtime work is
complete.

This block is not required to claim the main Hazelcast parity closure if Blocks P1-P4 are complete,
but it is the right next place to continue performance work.

Tasks:

- Replace JSON/base64 worker-control payloads in `src/cluster/tcp/ScatterOutboundEncoder.ts` with a
  lower-overhead structured or raw DTO encoding path.
- Replace `Array.shift()`-based queue hot paths with ring/deque structures where backlog can form.
- Reduce remaining `OutboundBatcher` copy/allocation churn where safe.

Primary touched areas:

- `src/cluster/tcp/ScatterOutboundEncoder.ts`
- `src/cluster/tcp/OutboundBatcher.ts`
- `src/internal/eventloop/Eventloop.ts`

Acceptance criteria:

- no correctness regression in scatter ordering/failover behavior
- measured reduction in enqueue/drain overhead vs the current implementation
- full clustered TCP test suite remains green

---

## Execution Sequence

Recommended order:

1. P1 Invocation monitor parity
2. Verify P1 end to end
3. P2 Backup ack parity
4. Verify P2 end to end
5. P3 Replica sync parity
6. Verify P3 end to end
7. P4 Remote invocation backpressure parity
8. Verify P4 end to end
9. P5 Hot-path cleanup
10. Re-benchmark and compare against Hazelcast target throughput

Do not start P5 before P1-P4 are complete. Otherwise the repo risks over-optimizing the transport
while still missing core clustered parity semantics.

---

## Proof Requirements

This plan is not complete unless the live repo proves the following:

- clustered operations fail or complete correctly across target-member death
- backup-aware operations do not silently complete without correct backup accounting
- replica sync survives retry, delay, duplicate response, and large-state transfer
- remote invocation pressure is bounded under stress
- existing binary transport, batching, pooling, and scatter paths remain green after the runtime
  parity work lands

Minimum verification expectations:

- targeted unit tests for each block
- focused multi-node TCP integration tests for each block
- at least one stress or soak test covering bounded remote invocation growth
- full `bun test`

---

## Non-Goals

This plan does not require:

- JVM thread-model mimicry for its own sake
- inbound decode offload unless later profiling proves it necessary
- mmap-backed storage or other speculative storage/runtime work
- weakening correctness guarantees to chase headline throughput

---

## Done Definition

Helios can claim Hazelcast-equivalent clustered parity for this area only when:

- P1-P4 are implemented in the production runtime
- multi-node tests prove the semantics end to end
- no old clustered shortcuts bypass the new runtime path
- performance claims are backed by the new correct path, not by a reduced-semantics fast path

Until then, Helios has strong transport-path progress, but not full Hazelcast-equivalent clustered
parity.
