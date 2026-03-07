# Blitz Job Supervision — Full Implementation Plan

**Goal:** 100% Hazelcast Jet semantic parity for autonomous job supervision, built on NATS + TypeScript + Bun. Zero stubs, zero deferrals, zero mock implementations.

**Scope:** Everything lives in `packages/blitz/`. No application-level supervision code.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [New Types & Interfaces](#2-new-types--interfaces)
3. [Job Lifecycle State Machine](#3-job-lifecycle-state-machine)
4. [Streaming Runtime Engine](#4-streaming-runtime-engine)
5. [Distributed Execution Model](#5-distributed-execution-model)
6. [Snapshot Barrier Protocol (Chandy-Lamport)](#6-snapshot-barrier-protocol-chandy-lamport)
7. [Job Coordination (Master-Supervised)](#7-job-coordination-master-supervised)
8. [Auto-Scaling & Failover](#8-auto-scaling--failover)
9. [Job Metrics](#9-job-metrics)
10. [BlitzService API Changes](#10-blitzservice-api-changes)
11. [NestJS Bridge Changes](#11-nestjs-bridge-changes)
12. [File Manifest](#12-file-manifest)
13. [Implementation Order](#13-implementation-order)
14. [Testing Strategy](#14-testing-strategy)

---

## 1. Architecture Overview

### Hazelcast Jet Model (What We're Matching)

```
┌──────────────────────────────────────────────────────────┐
│                    Jet Coordinator (Master)               │
│  - Owns JobRepository (IMap<jobId, JobRecord>)            │
│  - Monitors member liveness via heartbeats                │
│  - Initiates snapshot cycles                              │
│  - Restarts jobs on member loss (from last snapshot)      │
│  - Debounces scale-up (scaleUpDelayMillis)                │
│  - Replicates ENTIRE DAG to every member                  │
│  - Distribution is at the EDGE level, not vertex level    │
└──────────────────┬───────────────────────────────────────┘
                   │ IMap + ITopic
     ┌─────────────┼─────────────┐
     ▼             ▼             ▼
┌─────────┐  ┌─────────┐  ┌─────────┐
│ Member A │  │ Member B │  │ Member C │
│ - Runs   │  │ - Runs   │  │ - Runs   │
│   ALL    │  │   ALL    │  │   ALL    │
│  vertices│  │  vertices│  │  vertices│
│ - Local  │  │ - Local  │  │ - Local  │
│   edges  │  │   edges  │  │   edges  │
│   in-proc│  │   in-proc│  │   in-proc│
│ - Dist   │  │ - Dist   │  │ - Dist   │
│   edges  │  │   edges  │  │   edges  │
│   via    │  │   via    │  │   via    │
│   NATS   │  │   NATS   │  │   NATS   │
└─────────┘  └─────────┘  └─────────┘
```

### Blitz Translation

| Jet Concept | Blitz Equivalent |
|---|---|
| `JetService` (coordinator) | `BlitzJobCoordinator` (runs on master) |
| `JobRepository` (IMap) | IMap `__blitz.jobs` via Helios IMap |
| `JobExecutionService` | `BlitzJobExecutor` (runs on every member) |
| `MasterContext` | `BlitzJobCoordinator` authority-fenced operations |
| `ExecutionPlan` | `ExecutionPlan` (DAG descriptor + edge routing table) |
| Hazelcast cooperative thread pool | Node.js event loop + async/await |
| Hazelcast `Inbox`/`Outbox` | Async queues between vertex processors |
| Distributed edge (Hazelcast network) | NATS JetStream subjects |
| Local edge (same-JVM queue) | In-process async channel (no serialization) |
| Snapshot barriers | NATS message headers `blitz-barrier: true` |
| IMap snapshot storage | NATS KV bucket `__blitz.snapshots.{jobId}` |
| Job metrics (Jet `JobMetrics`) | `BlitzJobMetrics` collected via NATS request/reply |

---

## 2. New Types & Interfaces

### 2.1 `JobConfig` — `src/job/JobConfig.ts`

```typescript
export enum ProcessingGuarantee {
  NONE = 'NONE',
  AT_LEAST_ONCE = 'AT_LEAST_ONCE',
  EXACTLY_ONCE = 'EXACTLY_ONCE',
}

export interface JobConfig {
  /** Job name (optional; unnamed jobs get auto-generated names). */
  readonly name?: string;

  /** Processing guarantee level. @default ProcessingGuarantee.NONE */
  readonly processingGuarantee?: ProcessingGuarantee;

  /** Interval between automatic snapshots in ms. @default 10000 */
  readonly snapshotIntervalMillis?: number;

  /** Whether to auto-restart job when cluster topology changes. @default true */
  readonly autoScaling?: boolean;

  /** Whether to suspend (not fail) the job on unrecoverable processing error. @default false */
  readonly suspendOnFailure?: boolean;

  /** Delay before restarting job after a member joins (debounce). @default 10000 */
  readonly scaleUpDelayMillis?: number;

  /** Enable split-brain protection (requires majority of members). @default false */
  readonly splitBrainProtection?: boolean;

  /** Maximum records buffered per processor before backpressure. @default 16384 */
  readonly maxProcessorAccumulatedRecords?: number;

  /** Initial snapshot to restore from (for suspend/resume). */
  readonly initialSnapshotName?: string;
}

export interface ResolvedJobConfig {
  readonly name: string;
  readonly processingGuarantee: ProcessingGuarantee;
  readonly snapshotIntervalMillis: number;
  readonly autoScaling: boolean;
  readonly suspendOnFailure: boolean;
  readonly scaleUpDelayMillis: number;
  readonly splitBrainProtection: boolean;
  readonly maxProcessorAccumulatedRecords: number;
  readonly initialSnapshotName: string | undefined;
}

export function resolveJobConfig(config?: JobConfig, pipelineName?: string): ResolvedJobConfig;
```

### 2.2 `JobStatus` — `src/job/JobStatus.ts`

Exact Hazelcast Jet state machine:

```typescript
export enum JobStatus {
  /** Job submitted but not yet started by coordinator. */
  NOT_RUNNING = 'NOT_RUNNING',
  /** Coordinator is initializing the execution plan and distributing to members. */
  STARTING = 'STARTING',
  /** Job is actively processing data on all participating members. */
  RUNNING = 'RUNNING',
  /** Job is completing (batch mode: all sources exhausted, draining pipeline). */
  COMPLETING = 'COMPLETING',
  /** Job completed successfully (terminal — batch mode only). */
  COMPLETED = 'COMPLETED',
  /** Job failed with an unrecoverable error (terminal). */
  FAILED = 'FAILED',
  /** Job was cancelled by the user (terminal). */
  CANCELLED = 'CANCELLED',
  /** Coordinator is exporting a snapshot before suspending. */
  SUSPENDED_EXPORTING_SNAPSHOT = 'SUSPENDED_EXPORTING_SNAPSHOT',
  /** Job is suspended — can be resumed. */
  SUSPENDED = 'SUSPENDED',
  /** Job is restarting (failover or auto-scale — restoring from snapshot). */
  RESTARTING = 'RESTARTING',
}
```

### 2.3 `BlitzJob` — `src/job/BlitzJob.ts`

The user-facing handle returned by `blitz.newJob()`. Mirrors Jet's `Job` interface:

```typescript
export interface JobStatusListener {
  (oldStatus: JobStatus, newStatus: JobStatus): void;
}

export class BlitzJob {
  /** Unique job ID (UUID). */
  readonly id: string;

  /** Job name (from config or auto-generated). */
  readonly name: string;

  /** Resolved configuration. */
  readonly config: ResolvedJobConfig;

  /** Get current job status. */
  getStatus(): JobStatus;

  /**
   * Wait for the job to complete/fail/cancel.
   * For streaming jobs, this blocks until cancellation or failure.
   * For batch jobs, resolves when all sources are exhausted.
   */
  join(): Promise<void>;

  /** Cancel the job. Terminates execution on all members. */
  cancel(): Promise<void>;

  /** Suspend the job: export snapshot then stop execution. */
  suspend(): Promise<void>;

  /** Resume a suspended job from its last snapshot. */
  resume(): Promise<void>;

  /** Restart the job from the last snapshot (force). */
  restart(): Promise<void>;

  /** Export a named snapshot without stopping the job. */
  exportSnapshot(name: string): Promise<void>;

  /** Get current job metrics (aggregated from all members). */
  getMetrics(): Promise<BlitzJobMetrics>;

  /** Register a status change listener. Returns unsubscribe function. */
  addStatusListener(listener: JobStatusListener): () => void;

  /** Get the submission time. */
  getSubmissionTime(): number;
}
```

### 2.4 `JobRecord` — `src/job/JobRecord.ts`

Stored in IMap `__blitz.jobs`. The coordinator reads/writes these:

```typescript
export interface JobRecord {
  /** Unique job ID. */
  readonly id: string;
  /** Job name. */
  readonly name: string;
  /** Current status. */
  status: JobStatus;
  /** Resolved config (serializable). */
  readonly config: ResolvedJobConfig;
  /** Serialized pipeline descriptor (DAG). */
  readonly pipelineDescriptor: PipelineDescriptor;
  /** Timestamp when the job was submitted. */
  readonly submittedAt: number;
  /** Member IDs currently executing this job. */
  participatingMembers: string[];
  /** ID of the last completed snapshot (null if none). */
  lastSnapshotId: string | null;
  /** Error message if status is FAILED. */
  failureReason: string | null;
  /** Light job flag (no coordination overhead, single member). */
  readonly lightJob: boolean;
}
```

### 2.5 `PipelineDescriptor` — `src/job/PipelineDescriptor.ts`

Serializable representation of the DAG that can be stored in IMap and sent to members:

```typescript
export interface VertexDescriptor {
  readonly name: string;
  readonly type: 'source' | 'operator' | 'sink';
  /** Serialized operator function (for map/filter — stored as string via fn.toString()). */
  readonly fnSource: string | null;
  /** Source config (subject, stream, consumer, codec name). */
  readonly sourceConfig: SourceDescriptor | null;
  /** Sink config. */
  readonly sinkConfig: SinkDescriptor | null;
}

export interface SourceDescriptor {
  readonly type: 'nats-subject' | 'nats-stream' | 'helios-map' | 'helios-topic' | 'file' | 'http-webhook';
  readonly config: Record<string, unknown>;
}

export interface SinkDescriptor {
  readonly type: 'nats-subject' | 'nats-stream' | 'helios-map' | 'helios-topic' | 'file' | 'log';
  readonly config: Record<string, unknown>;
}

export interface EdgeDescriptor {
  readonly from: string;  // vertex name
  readonly to: string;    // vertex name
  readonly edgeType: EdgeType;
  /** NATS subject used as the wire. Computed by ExecutionPlan. */
  readonly subject: string;
  /** Partition key function source (for partitioned edges). */
  readonly keyFnSource: string | null;
}

export enum EdgeType {
  LOCAL = 'LOCAL',
  LOCAL_PARTITIONED = 'LOCAL_PARTITIONED',
  DISTRIBUTED_UNICAST = 'DISTRIBUTED_UNICAST',
  DISTRIBUTED_PARTITIONED = 'DISTRIBUTED_PARTITIONED',
  DISTRIBUTED_BROADCAST = 'DISTRIBUTED_BROADCAST',
  ALL_TO_ONE = 'ALL_TO_ONE',
}

export interface PipelineDescriptor {
  readonly name: string;
  readonly vertices: VertexDescriptor[];
  readonly edges: EdgeDescriptor[];
  readonly parallelism: number;
}
```

### 2.6 `ExecutionPlan` — `src/job/ExecutionPlan.ts`

Computed by the coordinator. Maps edges to concrete NATS subjects based on topology:

```typescript
export interface ExecutionPlan {
  /** Job ID this plan belongs to. */
  readonly jobId: string;
  /** Pipeline descriptor (the full DAG). */
  readonly pipeline: PipelineDescriptor;
  /** Member IDs participating in this execution. */
  readonly memberIds: string[];
  /** Edge routing table: for each distributed edge, the NATS subjects per member. */
  readonly edgeRouting: EdgeRoutingTable;
  /** Authority fence at creation time. */
  readonly fenceToken: string;
  readonly masterMemberId: string;
  readonly memberListVersion: number;
}

export interface EdgeRoutingEntry {
  readonly edgeName: string; // "vertexA→vertexB"
  readonly edgeType: EdgeType;
  /** For DISTRIBUTED_PARTITIONED: subject pattern with {partition} placeholder. */
  readonly subjectPattern: string;
  /** For DISTRIBUTED_UNICAST: round-robin subject list per member. */
  readonly memberSubjects: Record<string, string>;
  /** For DISTRIBUTED_BROADCAST: single subject all members subscribe to. */
  readonly broadcastSubject: string | null;
  /** Partition count for partitioned edges. */
  readonly partitionCount: number;
}

export type EdgeRoutingTable = Map<string, EdgeRoutingEntry>;

export function computeExecutionPlan(
  jobId: string,
  pipeline: PipelineDescriptor,
  memberIds: string[],
  authority: { fenceToken: string; masterMemberId: string; memberListVersion: number },
): ExecutionPlan;
```

### 2.7 `BlitzJobMetrics` — `src/job/BlitzJobMetrics.ts`

```typescript
export interface BlitzJobMetrics {
  /** Total items received by all source vertices. */
  readonly totalIn: number;
  /** Total items emitted by all sink vertices. */
  readonly totalOut: number;
  /** Per-vertex metrics. */
  readonly vertices: Map<string, VertexMetrics>;
  /** Snapshot metrics. */
  readonly snapshots: SnapshotMetrics;
  /** Collection timestamp. */
  readonly collectedAt: number;
}

export interface VertexMetrics {
  readonly name: string;
  readonly type: 'source' | 'operator' | 'sink';
  /** Items received by this vertex. */
  readonly itemsIn: number;
  /** Items emitted by this vertex. */
  readonly itemsOut: number;
  /** Items currently queued (backpressure indicator). */
  readonly queueSize: number;
  /** Processing latency: p50, p99, max (ms). */
  readonly latencyP50Ms: number;
  readonly latencyP99Ms: number;
  readonly latencyMaxMs: number;
}

export interface SnapshotMetrics {
  /** Total snapshots completed. */
  readonly snapshotCount: number;
  /** Last snapshot duration (ms). */
  readonly lastSnapshotDurationMs: number;
  /** Last snapshot size (bytes). */
  readonly lastSnapshotBytes: number;
  /** Last snapshot timestamp. */
  readonly lastSnapshotTimestamp: number;
}
```

---

## 3. Job Lifecycle State Machine

Exact replica of Hazelcast Jet's state machine:

```
                    ┌──────────────┐
                    │ NOT_RUNNING  │ ◄── initial state on submit
                    └──────┬───────┘
                           │ coordinator starts execution plan
                           ▼
                    ┌──────────────┐
              ┌────►│   STARTING   │
              │     └──────┬───────┘
              │            │ all members report ready
              │            ▼
              │     ┌──────────────┐
              │     │   RUNNING    │ ◄─────────────────────────────┐
              │     └──┬───┬───┬───┘                               │
              │        │   │   │                                   │
              │        │   │   │ member lost + autoScaling          │
              │        │   │   ▼                                   │
              │        │   │ ┌──────────────┐   restore snapshot   │
              │        │   │ │  RESTARTING  │──────────────────────┘
              │        │   │ └──────────────┘
              │        │   │
              │        │   │ user calls suspend()
              │        │   ▼
              │        │ ┌──────────────────────────────┐
              │        │ │ SUSPENDED_EXPORTING_SNAPSHOT  │
              │        │ └──────────────┬───────────────┘
              │        │                │ snapshot complete
              │        │                ▼
              │        │         ┌──────────────┐
              │        │         │  SUSPENDED    │
              │        │         └──────┬───────┘
              │        │                │ user calls resume()
              │        │                ▼
              │        │         ┌──────────────┐
              │        │         │ NOT_RUNNING  │ (then → STARTING → RUNNING)
              │        │         └──────────────┘
              │        │
              │        │ batch: all sources exhausted
              │        ▼
              │  ┌──────────────┐
              │  │  COMPLETING  │
              │  └──────┬───────┘
              │         │ all sinks flushed
              │         ▼
              │  ┌──────────────┐
              │  │  COMPLETED   │  (terminal)
              │  └──────────────┘
              │
              │  user calls cancel()      unrecoverable error
              │         │                        │
              │         ▼                        ▼
              │  ┌──────────────┐        ┌──────────────┐
              │  │  CANCELLED   │        │    FAILED    │
              │  └──────────────┘        └──────────────┘
              │                           (if suspendOnFailure → SUSPENDED instead)
              │
              │  RESTARTING path:
              └──────────── from RESTARTING back to STARTING
```

### Transition Rules

| From | To | Trigger |
|---|---|---|
| NOT_RUNNING | STARTING | Coordinator begins execution plan distribution |
| STARTING | RUNNING | All members confirm vertex processors initialized |
| RUNNING | COMPLETING | Batch: all sources report end-of-stream |
| COMPLETING | COMPLETED | All sinks flushed + final acks received |
| RUNNING | RESTARTING | Member lost/joined + autoScaling=true |
| RESTARTING | STARTING | Snapshot restored, new execution plan computed |
| RUNNING | SUSPENDED_EXPORTING_SNAPSHOT | User calls `job.suspend()` |
| SUSPENDED_EXPORTING_SNAPSHOT | SUSPENDED | Snapshot export complete |
| SUSPENDED | NOT_RUNNING | User calls `job.resume()` |
| RUNNING | CANCELLED | User calls `job.cancel()` |
| RUNNING | FAILED | Unrecoverable error + suspendOnFailure=false |
| RUNNING | SUSPENDED | Unrecoverable error + suspendOnFailure=true |
| Any non-terminal | CANCELLED | User calls `job.cancel()` |

---

## 4. Streaming Runtime Engine

The **critical missing piece**: an engine that actually drives data through the DAG.

### 4.1 `ProcessorTasklet` — `src/job/engine/ProcessorTasklet.ts`

One tasklet per vertex per member. Mirrors Jet's cooperative `Processor` executed by the cooperative thread pool. In our case, each tasklet is a long-running async function on the Node.js event loop.

```typescript
export class ProcessorTasklet {
  /** Vertex this tasklet processes. */
  readonly vertex: VertexDescriptor;
  /** Inbox: receives items from upstream edges. */
  readonly inbox: AsyncChannel<ProcessorItem>;
  /** Outbox: emits items to downstream edges. */
  readonly outbox: AsyncChannel<ProcessorItem>;

  /** Metrics counters (atomic — no locking needed in single-threaded JS). */
  itemsIn: number;
  itemsOut: number;
  queueSize: number;
  latencyTracker: LatencyTracker;

  /**
   * Run the tasklet's processing loop.
   * Reads from inbox, applies vertex fn, writes to outbox.
   * Respects backpressure: blocks when outbox is full (maxProcessorAccumulatedRecords).
   * Handles snapshot barriers (barrier alignment for exactly-once).
   */
  async run(signal: AbortSignal): Promise<void>;

  /** Inject a snapshot barrier into this tasklet's inbox. */
  injectBarrier(snapshotId: string): void;

  /** Save this tasklet's state to the snapshot store. */
  async saveSnapshot(snapshotId: string, store: SnapshotStore): Promise<number>;

  /** Restore this tasklet's state from the snapshot store. */
  async restoreSnapshot(snapshotId: string, store: SnapshotStore): Promise<void>;
}
```

### 4.2 `AsyncChannel` — `src/job/engine/AsyncChannel.ts`

Bounded async queue for in-process edges (local edges). This replaces Hazelcast's concurrent `Inbox`/`Outbox` queues.

```typescript
/**
 * Bounded async channel with backpressure.
 * When the channel is full, `send()` awaits until space is available.
 * When the channel is empty, `receive()` awaits until an item arrives.
 */
export class AsyncChannel<T> {
  constructor(capacity: number);
  async send(item: T): Promise<void>;
  async receive(): Promise<T>;
  tryReceive(): T | undefined;
  get size(): number;
  get isFull(): boolean;
  close(): void;
  [Symbol.asyncIterator](): AsyncIterableIterator<T>;
}
```

### 4.3 `ProcessorItem` — `src/job/engine/ProcessorItem.ts`

```typescript
export type ProcessorItem =
  | { type: 'data'; value: unknown; key?: string; timestamp: number }
  | { type: 'barrier'; snapshotId: string }
  | { type: 'eos' }  // end-of-stream (batch mode)
  | { type: 'watermark'; timestamp: number };
```

### 4.4 `SourceProcessor` — `src/job/engine/SourceProcessor.ts`

Wraps a `Source<T>` and drives its async iterable into the tasklet's outbox:

```typescript
export class SourceProcessor {
  constructor(
    source: Source<unknown>,
    outbox: AsyncChannel<ProcessorItem>,
    snapshotStore: SnapshotStore,
  );

  /**
   * Run loop: iterate source.messages(), wrap as ProcessorItem, push to outbox.
   * On barrier injection: pause reading, save current offset to snapshot, forward barrier.
   * On EOS (source iterator completes): push { type: 'eos' } and return.
   */
  async run(signal: AbortSignal): Promise<void>;
}
```

### 4.5 `SinkProcessor` — `src/job/engine/SinkProcessor.ts`

Wraps a `Sink<T>` and drains the tasklet's inbox:

```typescript
export class SinkProcessor {
  constructor(
    sink: Sink<unknown>,
    inbox: AsyncChannel<ProcessorItem>,
    snapshotStore: SnapshotStore,
  );

  /**
   * Run loop: read from inbox, call sink.write() for data items.
   * On barrier: save sink state to snapshot, forward barrier downstream (no-op for sinks).
   * On EOS: flush sink, signal completion.
   */
  async run(signal: AbortSignal): Promise<void>;
}
```

### 4.6 `OperatorProcessor` — `src/job/engine/OperatorProcessor.ts`

Wraps a vertex function (map, filter, flatMap, etc.):

```typescript
export class OperatorProcessor {
  constructor(
    fn: Function,
    inbox: AsyncChannel<ProcessorItem>,
    outbox: AsyncChannel<ProcessorItem>,
    snapshotStore: SnapshotStore,
  );

  async run(signal: AbortSignal): Promise<void>;
}
```

### 4.7 `DistributedEdgeSender` — `src/job/engine/DistributedEdgeSender.ts`

Takes items from a local outbox and publishes to NATS for distributed edges:

```typescript
export class DistributedEdgeSender {
  constructor(
    routing: EdgeRoutingEntry,
    localMemberId: string,
    nc: NatsConnection,
    js: JetStreamClient,
  );

  /** Consumes from localOutbox, serializes, publishes to appropriate NATS subject. */
  async run(localOutbox: AsyncChannel<ProcessorItem>, signal: AbortSignal): Promise<void>;
}
```

### 4.8 `DistributedEdgeReceiver` — `src/job/engine/DistributedEdgeReceiver.ts`

Subscribes to NATS subjects for distributed edges and feeds into a local inbox:

```typescript
export class DistributedEdgeReceiver {
  constructor(
    routing: EdgeRoutingEntry,
    localMemberId: string,
    nc: NatsConnection,
    js: JetStreamClient,
  );

  /** Subscribes to NATS, deserializes, pushes to localInbox. */
  async run(localInbox: AsyncChannel<ProcessorItem>, signal: AbortSignal): Promise<void>;
}
```

### 4.9 Performance Strategy: Edge Classification

| Edge Type | Transport | Serialization | Delivery | Performance |
|---|---|---|---|---|
| LOCAL | AsyncChannel (in-process) | None | Guaranteed | ~millions/sec |
| LOCAL_PARTITIONED | AsyncChannel (key-routed) | None | Guaranteed | ~millions/sec |
| DISTRIBUTED_UNICAST | Core NATS pub/sub | JSON/MsgPack | At-most-once | ~10M msgs/sec |
| DISTRIBUTED_PARTITIONED | JetStream | JSON/MsgPack | At-least-once | ~500K msgs/sec |
| DISTRIBUTED_BROADCAST | Core NATS pub/sub | JSON/MsgPack | At-most-once | ~10M msgs/sec |
| ALL_TO_ONE | JetStream | JSON/MsgPack | At-least-once | ~500K msgs/sec |

Local edges use **zero-copy in-process async channels** — no serialization, no NATS overhead.
Distributed edges use NATS, with core pub/sub for fire-and-forget and JetStream for durable delivery.

When `ProcessingGuarantee.EXACTLY_ONCE` or `AT_LEAST_ONCE`: all distributed edges use JetStream.
When `ProcessingGuarantee.NONE`: distributed edges use core NATS pub/sub for max throughput.

---

## 5. Distributed Execution Model

### Key insight: Jet replicates the ENTIRE DAG to every member

Every member runs every vertex. Distribution happens at the **edge level**:
- **Local edges**: items flow through in-process AsyncChannels
- **Distributed edges**: items flow through NATS subjects, partitioned by key

### 5.1 `BlitzJobExecutor` — `src/job/BlitzJobExecutor.ts`

Runs on **every member**. Receives execution plans from the coordinator and manages local processing:

```typescript
export class BlitzJobExecutor {
  /** Active job executions on this member. */
  private readonly _executions = new Map<string, JobExecution>();

  constructor(
    private readonly _memberId: string,
    private readonly _nc: NatsConnection,
    private readonly _js: JetStreamClient,
  );

  /** Initialize and start processing for a job on this member. */
  async startExecution(plan: ExecutionPlan): Promise<void>;

  /** Stop execution of a job on this member (cancel, suspend, or restart). */
  async stopExecution(jobId: string, reason: 'cancel' | 'suspend' | 'restart'): Promise<void>;

  /** Get metrics for a job running on this member. */
  getLocalMetrics(jobId: string): VertexMetrics[] | null;

  /** Inject a snapshot barrier into all source processors for a job. */
  injectSnapshotBarrier(jobId: string, snapshotId: string): void;

  /** Report snapshot completion for a job. */
  onSnapshotComplete(jobId: string, snapshotId: string): Promise<void>;
}
```

### 5.2 `JobExecution` — `src/job/engine/JobExecution.ts`

Represents a single job running on a single member:

```typescript
export class JobExecution {
  readonly jobId: string;
  readonly plan: ExecutionPlan;
  readonly memberId: string;

  /** All processor tasklets (one per vertex). */
  readonly tasklets: ProcessorTasklet[];
  /** All distributed edge senders. */
  readonly senders: DistributedEdgeSender[];
  /** All distributed edge receivers. */
  readonly receivers: DistributedEdgeReceiver[];
  /** Abort controller to stop all async loops. */
  readonly abortController: AbortController;

  /**
   * Wire up the DAG: create channels, processors, senders, receivers.
   * Start all async loops.
   */
  async start(): Promise<void>;

  /**
   * Stop all async loops. Cancel in-flight work.
   */
  async stop(): Promise<void>;

  /**
   * Collect local vertex metrics.
   */
  getMetrics(): VertexMetrics[];
}
```

---

## 6. Snapshot Barrier Protocol (Chandy-Lamport)

### Exact Hazelcast Jet implementation, adapted to NATS:

### 6.1 `SnapshotCoordinator` — `src/job/snapshot/SnapshotCoordinator.ts`

Runs on the **master** node. Initiates and tracks snapshot cycles:

```typescript
export class SnapshotCoordinator {
  constructor(
    private readonly _jobId: string,
    private readonly _config: ResolvedJobConfig,
    private readonly _memberIds: string[],
    private readonly _topic: ITopic,  // Helios distributed topic for commands
  );

  /**
   * Start the periodic snapshot timer.
   * Every snapshotIntervalMillis, initiate a new snapshot cycle.
   */
  start(): void;

  /**
   * Initiate a snapshot cycle:
   * 1. Generate snapshotId (UUID)
   * 2. Send INJECT_BARRIER command to all members via ITopic
   * 3. Wait for BARRIER_COMPLETE from all members
   * 4. Mark snapshot as committed in SnapshotStore
   * 5. Update JobRecord.lastSnapshotId
   */
  async initiateSnapshot(snapshotId?: string): Promise<SnapshotResult>;

  /**
   * Handle BARRIER_COMPLETE from a member.
   */
  onMemberSnapshotComplete(memberId: string, snapshotId: string, sizeBytes: number): void;

  stop(): void;
}

export interface SnapshotResult {
  readonly snapshotId: string;
  readonly durationMs: number;
  readonly totalBytes: number;
  readonly memberResults: Map<string, { sizeBytes: number; durationMs: number }>;
}
```

### 6.2 `SnapshotStore` — `src/job/snapshot/SnapshotStore.ts`

Uses NATS KV for snapshot storage:

```typescript
export class SnapshotStore {
  /** KV bucket: `__blitz.snapshots.{jobId}` */
  constructor(kvm: Kvm, jobId: string);

  /**
   * Save processor state.
   * Key: `{snapshotId}.{vertexName}.{processorIndex}`
   * Value: serialized state (Uint8Array)
   */
  async saveProcessorState(
    snapshotId: string,
    vertexName: string,
    processorIndex: number,
    state: Uint8Array,
  ): Promise<void>;

  /**
   * Load processor state for snapshot restoration.
   */
  async loadProcessorState(
    snapshotId: string,
    vertexName: string,
    processorIndex: number,
  ): Promise<Uint8Array | null>;

  /**
   * Mark a snapshot as committed (all members completed).
   */
  async commitSnapshot(snapshotId: string): Promise<void>;

  /**
   * Get the latest committed snapshot ID.
   */
  async getLatestSnapshotId(): Promise<string | null>;

  /**
   * Delete old snapshots (keep last N).
   */
  async pruneSnapshots(keepCount: number): Promise<void>;

  /**
   * Delete the entire snapshot bucket for a job.
   */
  async destroy(): Promise<void>;
}
```

### 6.3 Barrier Alignment (Exactly-Once)

In each `ProcessorTasklet`, when `ProcessingGuarantee.EXACTLY_ONCE`:

```
For a vertex with multiple inputs (e.g., join):

Input A:  ──[data]──[data]──[BARRIER]──[data]──[data]──
Input B:  ──[data]──[data]──[data]──[data]──[BARRIER]──

When BARRIER arrives on Input A but NOT yet on Input B:
  - Stop processing Input A (buffer post-barrier items)
  - Continue processing Input B normally
  - When BARRIER arrives on Input B:
    1. Save state to SnapshotStore
    2. Forward BARRIER to outbox
    3. Resume processing both inputs
    4. Flush buffered Input A items
```

For `AT_LEAST_ONCE`: no alignment. Each input saves state immediately upon receiving barrier, forwards barrier, continues processing. Possible duplicates on restore.

For `NONE`: barriers are not injected. No snapshots taken.

### 6.4 Snapshot Barrier in NATS Messages

For distributed edges, barriers are transmitted as special NATS messages:

```typescript
// Publishing a barrier on a distributed edge:
nc.publish(subject, new Uint8Array(0), {
  headers: headers({
    'blitz-barrier': 'true',
    'blitz-snapshot-id': snapshotId,
    'blitz-job-id': jobId,
  }),
});
```

JetStream guarantees per-subject FIFO ordering, which is the prerequisite for Chandy-Lamport correctness.

### 6.5 Exactly-Once End-to-End

Exactly-once = snapshot barriers + dedup at sinks:

1. **Source dedup**: JetStream consumer with `AckPolicy.Explicit` — redelivered messages get the same `msg.seq`, which is tracked in snapshot state
2. **Operator state**: saved/restored via SnapshotStore on barrier
3. **Sink dedup**: JetStream publish with `msgID` header (derived from `jobId + snapshotId + sequence`) — NATS deduplicates by msgID within the dedup window
4. **External sinks** (HeliosMapSink, FileSink): idempotent by design (IMap.put overwrites; file appends tracked by offset in snapshot)

---

## 7. Job Coordination (Master-Supervised)

### 7.1 `BlitzJobCoordinator` — `src/job/BlitzJobCoordinator.ts`

Runs on the **master** node. Uses the Helios fencing pattern from `HeliosBlitzCoordinator`:

```typescript
export class BlitzJobCoordinator {
  /** Authority fence: (masterMemberId, memberListVersion, fenceToken). */
  private _authority: AuthorityTuple;
  /** Active snapshot coordinators per job. */
  private readonly _snapshotCoordinators = new Map<string, SnapshotCoordinator>();

  constructor(
    private readonly _imap: IMap<string, JobRecord>,  // __blitz.jobs
    private readonly _topic: ITopic,                   // __blitz.job-commands
    private readonly _executor: BlitzJobExecutor,
    private readonly _memberIds: string[],
  );

  /**
   * Submit a new job. Called by BlitzService.newJob().
   *
   * 1. Create JobRecord with status=NOT_RUNNING
   * 2. Store in IMap
   * 3. Transition to STARTING
   * 4. Compute ExecutionPlan
   * 5. Send START_EXECUTION command to all members via ITopic
   * 6. Wait for all members to confirm
   * 7. Transition to RUNNING
   * 8. Start SnapshotCoordinator (if guarantee != NONE)
   */
  async submitJob(
    pipeline: PipelineDescriptor,
    config: ResolvedJobConfig,
  ): Promise<BlitzJob>;

  /**
   * Cancel a job.
   * 1. Validate authority fence
   * 2. Send STOP_EXECUTION(reason=cancel) to all members
   * 3. Transition to CANCELLED
   * 4. Clean up snapshot coordinator
   */
  async cancelJob(jobId: string): Promise<void>;

  /**
   * Suspend a job.
   * 1. Transition to SUSPENDED_EXPORTING_SNAPSHOT
   * 2. Initiate final snapshot
   * 3. Send STOP_EXECUTION(reason=suspend) to all members
   * 4. Transition to SUSPENDED
   */
  async suspendJob(jobId: string): Promise<void>;

  /**
   * Resume a suspended job.
   * 1. Transition to NOT_RUNNING
   * 2. Transition to STARTING
   * 3. Restore from last snapshot
   * 4. Compute new ExecutionPlan
   * 5. Send START_EXECUTION to all members
   * 6. Transition to RUNNING
   */
  async resumeJob(jobId: string): Promise<void>;

  /**
   * Restart a job (failover path).
   * Same as resume but from RESTARTING state.
   */
  async restartJob(jobId: string): Promise<void>;

  /**
   * Called when a member is lost. For each affected job:
   * 1. If autoScaling: transition to RESTARTING, wait scaleUpDelayMillis, restartJob
   * 2. If !autoScaling + suspendOnFailure: transition to SUSPENDED
   * 3. If !autoScaling + !suspendOnFailure: transition to FAILED
   */
  async onMemberLost(memberId: string): Promise<void>;

  /**
   * Called when a member joins. For each running job with autoScaling:
   * 1. Start debounce timer (scaleUpDelayMillis)
   * 2. If no more joins within debounce window: restartJob to include new member
   */
  async onMemberJoined(memberId: string): Promise<void>;

  /** Look up a job by ID. */
  async getJob(jobId: string): Promise<BlitzJob | null>;

  /** Look up a job by name. */
  async getJobByName(name: string): Promise<BlitzJob | null>;

  /** Get all jobs (optionally filtered by name). */
  async getJobs(name?: string): Promise<BlitzJob[]>;

  /**
   * Called on demotion (this node is no longer master).
   * Cancel all snapshot coordinators, clear authority.
   * Jobs continue running on members — new master will pick them up.
   */
  onDemotion(): void;

  /**
   * Called on promotion (this node becomes master).
   * Read all JobRecords from IMap, resume coordination for RUNNING jobs.
   */
  async onPromotion(authority: AuthorityTuple, memberIds: string[]): Promise<void>;
}

interface AuthorityTuple {
  masterMemberId: string;
  memberListVersion: number;
  fenceToken: string;
}
```

### 7.2 Inter-Member Communication

Job commands are broadcast via **Helios ITopic** `__blitz.job-commands`:

```typescript
export type JobCommand =
  | { type: 'START_EXECUTION'; jobId: string; plan: ExecutionPlan }
  | { type: 'STOP_EXECUTION'; jobId: string; reason: 'cancel' | 'suspend' | 'restart' }
  | { type: 'INJECT_BARRIER'; jobId: string; snapshotId: string }
  | { type: 'BARRIER_COMPLETE'; jobId: string; snapshotId: string; memberId: string; sizeBytes: number }
  | { type: 'EXECUTION_READY'; jobId: string; memberId: string }
  | { type: 'EXECUTION_FAILED'; jobId: string; memberId: string; error: string }
  | { type: 'EXECUTION_COMPLETED'; jobId: string; memberId: string }  // batch: EOS reached
  | { type: 'COLLECT_METRICS'; jobId: string; requestId: string }
  | { type: 'METRICS_RESPONSE'; jobId: string; requestId: string; memberId: string; metrics: VertexMetrics[] };
```

### 7.3 Light Jobs

Hazelcast Jet has `newLightJob()` for lightweight, single-member jobs with no coordination overhead:

```typescript
// Light jobs skip the coordinator entirely:
// - No IMap storage
// - No snapshot coordination
// - No failover
// - Run on the submitting member only
// - Cancel/join still work via local reference
```

---

## 8. Auto-Scaling & Failover

### 8.1 Member Loss

```
1. HeliosClusterCoordinator detects member disconnect (via heartbeat)
2. Fires onMembersRemoved callback → BlitzJobCoordinator.onMemberLost()
3. For each RUNNING job where the lost member was participating:
   a. If autoScaling=true:
      - Transition job to RESTARTING
      - Stop SnapshotCoordinator
      - Send STOP_EXECUTION(restart) to surviving members
      - Compute new ExecutionPlan with surviving members
      - Restore from lastSnapshotId
      - Send START_EXECUTION with new plan to surviving members
      - Transition to STARTING → RUNNING
   b. If autoScaling=false && suspendOnFailure=true:
      - Transition to SUSPENDED
      - Stop SnapshotCoordinator
      - Send STOP_EXECUTION(suspend) to surviving members
   c. If autoScaling=false && suspendOnFailure=false:
      - Transition to FAILED
      - Stop SnapshotCoordinator
      - Send STOP_EXECUTION(cancel) to surviving members
```

### 8.2 Member Join

```
1. HeliosClusterCoordinator detects new member (via join protocol)
2. Fires onMembersAdded callback → BlitzJobCoordinator.onMemberJoined()
3. For each RUNNING job where autoScaling=true:
   a. Start/reset scaleUpDelayMillis debounce timer
   b. When timer fires (no more joins within window):
      - Transition job to RESTARTING
      - Take snapshot
      - Send STOP_EXECUTION(restart) to all current members
      - Compute new ExecutionPlan including new member
      - Restore from snapshot
      - Send START_EXECUTION with new plan to ALL members (including new)
      - Transition to STARTING → RUNNING
```

### 8.3 Master Failover

```
1. Old master dies
2. HeliosClusterCoordinator elects new master (lowest UUID)
3. New master's BlitzJobCoordinator.onPromotion() fires:
   a. Read all JobRecords from IMap __blitz.jobs
   b. For each RUNNING job:
      - Verify participating members are still alive
      - If all alive: resume SnapshotCoordinator, continue
      - If some lost: treat as member-loss scenario (step 8.1)
   c. For each STARTING job: restart from NOT_RUNNING
   d. For each RESTARTING job: continue restart sequence
   e. For each SUSPENDED job: no action (wait for user resume)
```

### 8.4 Split-Brain Protection

When `splitBrainProtection=true`:
- Job only runs if `alive members >= ceil(total members / 2)`
- On partition, the minority side suspends all protected jobs
- On heal, majority side coordinator restarts jobs normally

---

## 9. Job Metrics

### 9.1 Collection Flow

```
1. User calls job.getMetrics()
2. BlitzJob sends COLLECT_METRICS command via ITopic with requestId
3. Each member's BlitzJobExecutor collects local VertexMetrics
4. Each member publishes METRICS_RESPONSE via ITopic
5. BlitzJob aggregates all responses (with timeout)
6. Returns BlitzJobMetrics
```

### 9.2 `LatencyTracker` — `src/job/metrics/LatencyTracker.ts`

```typescript
/**
 * HDR histogram-style latency tracking.
 * Maintains a circular buffer of recent latencies for p50/p99 computation.
 * Lock-free (single-threaded JS).
 */
export class LatencyTracker {
  constructor(bufferSize?: number);  // default 10000
  record(latencyMs: number): void;
  getP50(): number;
  getP99(): number;
  getMax(): number;
  reset(): void;
}
```

### 9.3 `MetricsCollector` — `src/job/metrics/MetricsCollector.ts`

```typescript
export class MetricsCollector {
  /**
   * Aggregate metrics from multiple members into a single BlitzJobMetrics.
   */
  static aggregate(responses: Array<{ memberId: string; metrics: VertexMetrics[] }>): BlitzJobMetrics;
}
```

---

## 10. BlitzService API Changes

### Current API (Block 10.x):
```typescript
blitz.pipeline(name) → Pipeline
blitz.submit(pipeline) → Promise<void>
blitz.cancel(name) → Promise<void>
blitz.isRunning(name) → boolean
```

### New API (Jet-parity):
```typescript
// Primary job submission (mirrors Jet)
blitz.newJob(pipeline: Pipeline, config?: JobConfig): Promise<BlitzJob>
blitz.newLightJob(pipeline: Pipeline): Promise<BlitzJob>

// Job lookup (mirrors Jet)
blitz.getJob(id: string): Promise<BlitzJob | null>
blitz.getJob(name: string): Promise<BlitzJob | null>   // overloaded
blitz.getJobs(): Promise<BlitzJob[]>
blitz.getJobs(name: string): Promise<BlitzJob[]>

// Keep existing for backward compat (deprecated — delegates to newJob internally)
blitz.submit(pipeline) → Promise<void>  // @deprecated
blitz.cancel(name) → Promise<void>      // @deprecated

// New: set the Helios coordinator for cluster-aware operation
blitz.setCoordinator(coordinator: HeliosClusterCoordinator): void
```

### Integration with Helios Coordinator

When `BlitzService` has a coordinator set:
- `newJob()` delegates to `BlitzJobCoordinator` on the master
- Jobs are distributed across the cluster
- Failover and snapshots are automatic

When standalone (no coordinator):
- `newJob()` runs locally like a light job
- No distribution, no failover
- Still gets the full streaming runtime engine

---

## 11. NestJS Bridge Changes

`HeliosBlitzService` gets new proxy methods:

```typescript
// New methods
async newJob(pipeline: Pipeline, config?: JobConfig): Promise<BlitzJob>
async newLightJob(pipeline: Pipeline): Promise<BlitzJob>
async getJob(idOrName: string): Promise<BlitzJob | null>
async getJobs(name?: string): Promise<BlitzJob[]>
```

---

## 12. File Manifest

All files to be created or modified, in `packages/blitz/src/`:

### New Files

| File | Purpose |
|---|---|
| `src/job/JobConfig.ts` | ProcessingGuarantee enum, JobConfig, ResolvedJobConfig, resolveJobConfig() |
| `src/job/JobStatus.ts` | JobStatus enum (all Jet states) |
| `src/job/BlitzJob.ts` | User-facing job handle with join/cancel/suspend/resume/restart/getMetrics |
| `src/job/JobRecord.ts` | IMap-stored job state |
| `src/job/PipelineDescriptor.ts` | Serializable DAG: VertexDescriptor, EdgeDescriptor, SourceDescriptor, SinkDescriptor |
| `src/job/ExecutionPlan.ts` | ExecutionPlan, EdgeRoutingEntry, computeExecutionPlan() |
| `src/job/JobCommand.ts` | JobCommand union type for inter-member communication |
| `src/job/BlitzJobCoordinator.ts` | Master-side job lifecycle management (submit, cancel, suspend, resume, failover) |
| `src/job/BlitzJobExecutor.ts` | Member-side execution management (start/stop executions) |
| `src/job/engine/AsyncChannel.ts` | Bounded async queue with backpressure |
| `src/job/engine/ProcessorItem.ts` | Data/barrier/EOS/watermark union type |
| `src/job/engine/ProcessorTasklet.ts` | Per-vertex processing loop with barrier alignment |
| `src/job/engine/JobExecution.ts` | Wire up DAG on a single member, start/stop all tasklets |
| `src/job/engine/SourceProcessor.ts` | Source → outbox driver |
| `src/job/engine/SinkProcessor.ts` | Inbox → sink driver |
| `src/job/engine/OperatorProcessor.ts` | Inbox → fn → outbox driver |
| `src/job/engine/DistributedEdgeSender.ts` | Local outbox → NATS pub |
| `src/job/engine/DistributedEdgeReceiver.ts` | NATS sub → local inbox |
| `src/job/snapshot/SnapshotCoordinator.ts` | Master-side periodic snapshot orchestration |
| `src/job/snapshot/SnapshotStore.ts` | NATS KV-backed snapshot persistence |
| `src/job/metrics/BlitzJobMetrics.ts` | Metrics types |
| `src/job/metrics/LatencyTracker.ts` | p50/p99 latency computation |
| `src/job/metrics/MetricsCollector.ts` | Cross-member metrics aggregation |

### Modified Files

| File | Changes |
|---|---|
| `src/BlitzService.ts` | Add `newJob()`, `newLightJob()`, `getJob()`, `getJobs()`, `setCoordinator()`. Wire up BlitzJobCoordinator and BlitzJobExecutor. |
| `src/BlitzEvent.ts` | Add job lifecycle events: JOB_STARTED, JOB_COMPLETED, JOB_FAILED, JOB_CANCELLED, JOB_SUSPENDED, JOB_RESTARTING, SNAPSHOT_STARTED, SNAPSHOT_COMPLETED |
| `src/Pipeline.ts` | Add `toDescriptor()` method to serialize DAG to PipelineDescriptor. Store Source/Sink references on vertices. Add edge type configuration (`.distributed()`, `.partitioned(keyFn)`, `.broadcast()`). |
| `src/Vertex.ts` | Add optional `sourceRef` and `sinkRef` fields to store Source/Sink instances for descriptor generation. |
| `src/Edge.ts` | Add `edgeType: EdgeType` field (default LOCAL). Add fluent setters: `.distributed()`, `.partitioned()`, `.broadcast()`, `.allToOne()`. |
| `src/index.ts` | Export all new job types. |
| `src/nestjs/HeliosBlitzService.ts` | Add `newJob()`, `newLightJob()`, `getJob()`, `getJobs()` proxy methods. |

---

## 13. Implementation Order

Strict bottom-up dependency order. Each step is independently testable.

### Step 1: Foundation Types
1. `JobConfig.ts` — enum + interface + resolver
2. `JobStatus.ts` — enum
3. `PipelineDescriptor.ts` — serializable DAG types
4. `ProcessorItem.ts` — data/barrier/eos union
5. `JobCommand.ts` — inter-member command types
6. `BlitzJobMetrics.ts` — metrics types

### Step 2: Engine Core
7. `AsyncChannel.ts` — bounded async queue (test with unit tests)
8. `LatencyTracker.ts` — p50/p99 tracker (test with unit tests)
9. `SnapshotStore.ts` — NATS KV snapshot persistence

### Step 3: Processors
10. `SourceProcessor.ts` — source → outbox driver
11. `SinkProcessor.ts` — inbox → sink driver
12. `OperatorProcessor.ts` — inbox → fn → outbox driver
13. `ProcessorTasklet.ts` — per-vertex loop with barrier alignment

### Step 4: Distributed Edges
14. `DistributedEdgeSender.ts` — outbox → NATS
15. `DistributedEdgeReceiver.ts` — NATS → inbox

### Step 5: Execution Assembly
16. `ExecutionPlan.ts` — compute edge routing from DAG + topology
17. `JobExecution.ts` — wire up full DAG on one member
18. `BlitzJobExecutor.ts` — manage multiple executions per member

### Step 6: Pipeline Serialization
19. Modify `Vertex.ts` — add source/sink refs
20. Modify `Edge.ts` — add edge types
21. Modify `Pipeline.ts` — add `toDescriptor()`, edge type fluent API

### Step 7: Job Handle
22. `JobRecord.ts` — IMap storage type
23. `BlitzJob.ts` — user-facing handle

### Step 8: Snapshot Coordination
24. `SnapshotCoordinator.ts` — master-side snapshot orchestration
25. Wire barrier alignment into ProcessorTasklet

### Step 9: Job Coordination
26. `BlitzJobCoordinator.ts` — full master-side lifecycle
27. `MetricsCollector.ts` — cross-member aggregation

### Step 10: Service Integration
28. Modify `BlitzService.ts` — wire everything together
29. Modify `BlitzEvent.ts` — add job events
30. Modify `index.ts` — export all new types
31. Modify `HeliosBlitzService.ts` — NestJS proxy methods

---

## 14. Testing Strategy

### Unit Tests (no NATS required)

| Test | What It Covers |
|---|---|
| `AsyncChannel.test.ts` | Bounded queue: send/receive/backpressure/close/iterator |
| `LatencyTracker.test.ts` | p50/p99/max computation, buffer rotation |
| `JobConfig.test.ts` | Resolver defaults, validation |
| `ExecutionPlan.test.ts` | Edge routing computation for all edge types |
| `ProcessorTasklet.test.ts` | Barrier alignment (exactly-once vs at-least-once), data flow |
| `PipelineDescriptor.test.ts` | DAG serialization/deserialization round-trip |
| `BlitzJob.test.ts` | Status transitions, listener notifications |

### Integration Tests (embedded NATS)

| Test | What It Covers |
|---|---|
| `SourceProcessor.test.ts` | NatsSource → outbox, EOS detection |
| `SinkProcessor.test.ts` | inbox → NatsSink, flush on EOS |
| `DistributedEdge.test.ts` | Sender/receiver round-trip via NATS, barrier passthrough |
| `SnapshotStore.test.ts` | KV save/load/commit/prune |
| `JobExecution.test.ts` | Full DAG execution: source → map → filter → sink |

### Cluster Tests (multi-node embedded NATS)

| Test | What It Covers |
|---|---|
| `BlitzJobCoordinator.test.ts` | Submit/cancel/suspend/resume lifecycle |
| `Failover.test.ts` | Member loss → job restart from snapshot |
| `AutoScaling.test.ts` | Member join → debounced restart |
| `MasterFailover.test.ts` | Master dies → new master resumes coordination |
| `ExactlyOnce.test.ts` | Barrier alignment + dedup sink, verify no duplicates after restart |
| `LightJob.test.ts` | Single-member execution, no coordination |
| `JobMetrics.test.ts` | Cross-member metrics collection |
| `SplitBrain.test.ts` | Split-brain protection: minority suspends jobs |

---

## Design Decisions & Rationale

### Why AsyncChannel instead of Node.js streams?
Node.js Readable/Writable streams have complex backpressure semantics and high overhead for in-process communication. AsyncChannel is a minimal bounded queue (~50 lines) with predictable backpressure, zero allocation overhead, and direct async/await integration.

### Why NATS KV for snapshots instead of IMap?
IMap partitions data across members — if the member holding a snapshot partition dies, the snapshot is lost until replication catches up. NATS KV is backed by JetStream Raft consensus with guaranteed R=quorum replication, providing stronger durability guarantees for snapshot data that must survive member loss.

### Why ITopic for job commands instead of IExecutorService?
IExecutorService executes code on specific members — good for targeted operations. ITopic broadcasts to all members simultaneously — better for START_EXECUTION (all members need the plan) and INJECT_BARRIER (all members must receive simultaneously). For targeted operations (cancel a specific member), the coordinator sends to ITopic and members filter by their own ID.

### Why fn.toString() for operator serialization?
Hazelcast Jet serializes processors via Java serialization. In JavaScript, `fn.toString()` captures the source code of lambdas. Combined with `new Function()` reconstruction, this provides equivalent serialization for `map`, `filter`, etc. Closures over external state are NOT supported (same limitation as Jet's serializable lambdas) — users must use `Source`/`Sink` for external state access.

### Why per-subject FIFO matters for Chandy-Lamport?
The correctness of barrier-based snapshotting requires that barriers are received in-order relative to data items on each channel. NATS JetStream guarantees per-subject FIFO delivery, which provides exactly this property. Core NATS pub/sub also guarantees per-connection FIFO, sufficient for `ProcessingGuarantee.NONE` edges.
