import type { Sink } from '@zenystx/helios-blitz/sink/Sink.js';
import type { Source } from '@zenystx/helios-blitz/source/Source.js';
import type { ExecutionPlan } from '../ExecutionPlan.js';
import type { ProcessingGuarantee } from '../JobConfig.js';
import type { JobExecutionTimestamps, VertexMetrics } from '../metrics/BlitzJobMetrics.js';
import { tagsForVertex } from '../metrics/MetricTags.js';
import { AsyncChannel } from './AsyncChannel.js';
import type { DistributedEdgeReceiver } from './DistributedEdgeReceiver.js';
import type { DistributedEdgeSender } from './DistributedEdgeSender.js';
import { OperatorProcessor } from './OperatorProcessor.js';
import type { ProcessorItem } from './ProcessorItem.js';
import { SinkProcessor } from './SinkProcessor.js';
import { SourceProcessor } from './SourceProcessor.js';

export interface OperatorFnEntry {
  readonly fn: (value: unknown) => unknown;
  readonly mode: 'map' | 'filter' | 'flatMap';
}

export interface JobExecutionConfig {
  readonly jobId: string;
  readonly jobName?: string;
  readonly executionId?: string;
  readonly plan: ExecutionPlan;
  readonly memberId: string;
  readonly sources: Map<string, Source<unknown>>;
  readonly sinks: Map<string, Sink<unknown>>;
  readonly operatorFns: Map<string, OperatorFnEntry>;
  readonly guarantee: ProcessingGuarantee;
  readonly maxProcessorAccumulatedRecords: number;
}

interface VertexRuntime {
  readonly name: string;
  readonly type: 'source' | 'operator' | 'sink';
  readonly promise: Promise<void>;
  readonly sourceProcessor?: SourceProcessor<unknown>;
  readonly sinkProcessor?: SinkProcessor<unknown>;
  readonly operatorProcessor?: OperatorProcessor;
  readonly outbox?: AsyncChannel<ProcessorItem>;
  itemsIn: number;
  itemsOut: number;
  /** Distributed senders attached to this vertex's outgoing distributed edges. */
  distributedSenders: DistributedEdgeSender[];
  /** Distributed receivers attached to this vertex's incoming distributed edges. */
  distributedReceivers: DistributedEdgeReceiver[];
  status: VertexExecutionStatus;
}

type VertexExecutionStatus = 'STARTING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

function resolveStopStatus(currentStatus: VertexExecutionStatus): VertexExecutionStatus {
  switch (currentStatus) {
    case 'FAILED':
    case 'COMPLETED':
    case 'CANCELLED':
      return currentStatus;
    default:
      return 'CANCELLED';
  }
}

/**
 * JobExecution — wires up a full DAG on a single member.
 *
 * Creates AsyncChannels for local edges, SourceProcessors for source vertices,
 * OperatorProcessors for operator vertices, SinkProcessors for sink vertices.
 * Starts all async loops and stops all on cancel via AbortController.
 *
 * Now also tracks:
 *   - T11: watermark fields via OperatorProcessor.getLatencyMetrics()
 *   - T12: queueCapacity from AsyncChannel
 *   - T13: executionStartTime / executionCompletionTime
 *   - T14: per-vertex tag maps via tagsForVertex()
 *   - T15: user-defined custom metrics from OperatorProcessor
 */
export class JobExecution {
  private readonly config: JobExecutionConfig;
  private readonly abortController = new AbortController();
  private readonly vertexRuntimes: VertexRuntime[] = [];
  private readonly sourceProcessors: SourceProcessor<unknown>[] = [];
  private _completionPromise: Promise<PromiseSettledResult<void>[]> | null = null;

  /** T13: wall-clock time when start() is called. */
  private readonly _startTime = Date.now();
  /** T13: wall-clock time when the job finishes naturally. -1 while running. */
  private _completionTime = -1;
  private _status: VertexExecutionStatus = 'STARTING';

  constructor(config: JobExecutionConfig) {
    this.config = config;
  }

  get jobId(): string {
    return this.config.jobId;
  }

  /** T13: Epoch ms when this execution was started. */
  get startTime(): number {
    return this._startTime;
  }

  /** T13: Epoch ms when this execution completed. -1 while still running. */
  get completionTime(): number {
    return this._completionTime;
  }

  get status(): VertexExecutionStatus {
    return this._status;
  }

  getExecutionTimestamps(): JobExecutionTimestamps {
    return {
      startTime: this._startTime,
      completionTime: this._completionTime,
    };
  }

  /**
   * Wire up the DAG and start all processing loops.
   */
  async start(): Promise<void> {
    this._status = 'RUNNING';
    const { plan, sources, sinks, operatorFns, guarantee, maxProcessorAccumulatedRecords } = this.config;
    const { pipeline } = plan;
    const signal = this.abortController.signal;

    // Build adjacency: for each vertex, what edges feed into it and what edges go out
    const inboxChannels = new Map<string, AsyncChannel<ProcessorItem>>();
    const outboxChannels = new Map<string, AsyncChannel<ProcessorItem>>();

    // Create channels for each edge
    for (const edgeDesc of pipeline.edges) {
      const channelName = `${edgeDesc.from}→${edgeDesc.to}`;
      const channel = new AsyncChannel<ProcessorItem>(maxProcessorAccumulatedRecords);
      // The edge's channel serves as outbox for `from` and inbox for `to`
      outboxChannels.set(channelName, channel);
      inboxChannels.set(channelName, channel);
    }

    // For each vertex, find its inbox (from incoming edges) and outbox (from outgoing edges)
    const promises: Promise<void>[] = [];

    for (const vertexDesc of pipeline.vertices) {
      const incomingEdges = pipeline.edges.filter(e => e.to === vertexDesc.name);
      const outgoingEdges = pipeline.edges.filter(e => e.from === vertexDesc.name);

      switch (vertexDesc.type) {
        case 'source': {
          const source = sources.get(vertexDesc.name);
          if (!source) {
            throw new Error(`Source not found for vertex '${vertexDesc.name}'`);
          }

          // Source has no inbox, only outbox
          if (outgoingEdges.length === 0) {
            throw new Error(`Source vertex '${vertexDesc.name}' has no outgoing edges`);
          }
          const outChannelName = `${outgoingEdges[0].from}→${outgoingEdges[0].to}`;
          const outbox = outboxChannels.get(outChannelName)!;

          const sourceProc = new SourceProcessor(source, outbox, vertexDesc.name, 0);
          this.sourceProcessors.push(sourceProc);

          const promise = this._wrapVertexPromise(
            vertexDesc.name,
            sourceProc.run(signal).catch(err => {
              if (!signal.aborted) throw err;
            }),
          );

          this.vertexRuntimes.push({
            name: vertexDesc.name,
            type: 'source',
            promise,
            sourceProcessor: sourceProc,
            outbox,
            itemsIn: 0,
            itemsOut: 0,
            distributedSenders: [],
            distributedReceivers: [],
            status: 'RUNNING',
          });
          promises.push(promise);
          break;
        }

        case 'operator': {
          const entry = operatorFns.get(vertexDesc.name);
          const fn = entry?.fn ?? (vertexDesc.fnSource ? new Function('x', `return (${vertexDesc.fnSource})(x)`) as (value: unknown) => unknown : null);
          const mode = entry?.mode ?? 'map';

          if (!fn) {
            throw new Error(`No operator function for vertex '${vertexDesc.name}'`);
          }

          if (incomingEdges.length === 0) {
            throw new Error(`Operator vertex '${vertexDesc.name}' has no incoming edges`);
          }
          if (outgoingEdges.length === 0) {
            throw new Error(`Operator vertex '${vertexDesc.name}' has no outgoing edges`);
          }

          const inChannelName = `${incomingEdges[0].from}→${incomingEdges[0].to}`;
          const inbox = inboxChannels.get(inChannelName)!;
          const outChannelName = `${outgoingEdges[0].from}→${outgoingEdges[0].to}`;
          const outbox = outboxChannels.get(outChannelName)!;

          const operatorProc = new OperatorProcessor(fn, mode, inbox, outbox, vertexDesc.name, 0);

          const promise = this._wrapVertexPromise(
            vertexDesc.name,
            operatorProc.run(signal).catch(err => {
              if (!signal.aborted) throw err;
            }),
          );

          this.vertexRuntimes.push({
            name: vertexDesc.name,
            type: 'operator',
            promise,
            operatorProcessor: operatorProc,
            outbox,
            itemsIn: 0,
            itemsOut: 0,
            distributedSenders: [],
            distributedReceivers: [],
            status: 'RUNNING',
          });
          promises.push(promise);
          break;
        }

        case 'sink': {
          const sink = sinks.get(vertexDesc.name);
          if (!sink) {
            throw new Error(`Sink not found for vertex '${vertexDesc.name}'`);
          }

          if (incomingEdges.length === 0) {
            throw new Error(`Sink vertex '${vertexDesc.name}' has no incoming edges`);
          }

          const inChannelName = `${incomingEdges[0].from}→${incomingEdges[0].to}`;
          const inbox = inboxChannels.get(inChannelName)!;

          const sinkProc = new SinkProcessor(sink, inbox, vertexDesc.name, 0);

          const promise = this._wrapVertexPromise(
            vertexDesc.name,
            sinkProc.run(signal).then(() => {}).catch(err => {
              if (!signal.aborted) throw err;
            }),
          );

          this.vertexRuntimes.push({
            name: vertexDesc.name,
            type: 'sink',
            promise,
            sinkProcessor: sinkProc,
            itemsIn: 0,
            itemsOut: 0,
            distributedSenders: [],
            distributedReceivers: [],
            status: 'RUNNING',
          });
          promises.push(promise);
          break;
        }
      }
    }

    this._completionPromise = Promise.allSettled(promises).then((results) => {
      // T13: record completion time when all vertex promises settle
      this._completionTime = Date.now();
      if (this._status !== 'CANCELLED') {
        this._status = results.some((result) => result.status === 'rejected') ? 'FAILED' : 'COMPLETED';
      }
      return results;
    });
  }

  /**
   * Wait for all processors to complete (batch mode).
   */
  async waitForCompletion(timeoutMs: number): Promise<void> {
    if (!this._completionPromise) return;

    await Promise.race([
      this._completionPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`JobExecution timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  }

  whenComplete(): Promise<PromiseSettledResult<void>[]> {
    return this._completionPromise ?? Promise.resolve([]);
  }

  /**
   * Stop all processing loops.
   */
  async stop(): Promise<void> {
    this._status = resolveStopStatus(this._status);
    for (const runtime of this.vertexRuntimes) {
      runtime.status = resolveStopStatus(runtime.status);
    }
    this.abortController.abort();
    if (this._completionPromise) {
      await this._completionPromise;
    }
    if (this._completionTime < 0) {
      this._completionTime = Date.now();
    }
  }

  /**
   * Inject a snapshot barrier into all source processors.
   */
  injectSnapshotBarrier(snapshotId: string): void {
    for (const sp of this.sourceProcessors) {
      sp.injectBarrier(snapshotId);
    }
  }

  /**
   * Attach a DistributedEdgeSender to a vertex so its counters appear in getMetrics().
   * Call this after start() for each distributed outgoing edge on the vertex.
   */
  attachDistributedSender(vertexName: string, sender: DistributedEdgeSender): void {
    const vr = this.vertexRuntimes.find(r => r.name === vertexName);
    if (vr) {
      vr.distributedSenders.push(sender);
    }
  }

  /**
   * Attach a DistributedEdgeReceiver to a vertex so its counters appear in getMetrics().
   * Call this after start() for each distributed incoming edge on the vertex.
   */
  attachDistributedReceiver(vertexName: string, receiver: DistributedEdgeReceiver): void {
    const vr = this.vertexRuntimes.find(r => r.name === vertexName);
    if (vr) {
      vr.distributedReceivers.push(receiver);
    }
  }

  /**
   * Collect per-vertex metrics from the running execution.
   *
   * Reads actual item counts from processors, queue sizes and capacities from
   * channels, watermark tracking state, tags, user-defined metrics, and
   * distributed traffic counters from any attached distributed edge components.
   */
  getMetrics(): VertexMetrics[] {
    const jobId = this.config.jobId;
    const jobName = this.config.jobName ?? jobId;
    const executionId = this.config.executionId ?? jobId;

    return this.vertexRuntimes.map(vr => {
      let itemsIn = 0;
      let itemsOut = 0;

      let latencyP50Ms = 0;
      let latencyP99Ms = 0;
      let latencyMaxMs = 0;

      // T11: watermark defaults
      let topObservedWm = -1;
      let coalescedWm = -1;
      let lastForwardedWm = -1;
      let lastForwardedWmLatency = -1;

      // T15: user metrics default
      let userMetrics: ReadonlyMap<string, number> | undefined;

      if (vr.sourceProcessor) {
        // Sources have no inbox — itemsIn is 0, itemsOut = items emitted
        itemsOut = vr.sourceProcessor.getEmittedCount();
      } else if (vr.operatorProcessor) {
        // Operators: itemsIn = itemsProcessed (items received), itemsOut = items emitted
        const processed = vr.operatorProcessor.getItemsProcessed();
        itemsIn = processed;
        itemsOut = vr.operatorProcessor.getItemsEmitted();
        const latency = vr.operatorProcessor.getLatencyMetrics();
        latencyP50Ms = latency.latencyP50Ms;
        latencyP99Ms = latency.latencyP99Ms;
        latencyMaxMs = latency.latencyMaxMs;
        // T11: watermarks from operator
        topObservedWm = latency.topObservedWm;
        coalescedWm = latency.coalescedWm;
        lastForwardedWm = latency.lastForwardedWm;
        lastForwardedWmLatency = latency.lastForwardedWmLatency;
        // T15: user metrics from operator
        userMetrics = latency.userMetrics.size > 0 ? latency.userMetrics : undefined;
      } else if (vr.sinkProcessor) {
        // Sinks: itemsIn = items written, no outbox
        itemsIn = vr.sinkProcessor.getItemsWritten();
      }

      // Aggregate distributed traffic from all attached senders/receivers
      let distributedItemsOut = 0;
      let distributedBytesOut = 0;
      for (const sender of vr.distributedSenders) {
        distributedItemsOut += sender.itemsOut;
        distributedBytesOut += sender.bytesOut;
      }

      let distributedItemsIn = 0;
      let distributedBytesIn = 0;
      for (const receiver of vr.distributedReceivers) {
        distributedItemsIn += receiver.itemsIn;
        distributedBytesIn += receiver.bytesIn;
      }

      // T14: build tag map for this vertex
      const tags = tagsForVertex({
        jobId,
        jobName,
        executionId,
        vertexName: vr.name,
        procType: vr.type,
        isSource: vr.type === 'source',
        isSink: vr.type === 'sink',
        processorIndex: 0,
      });

      return {
        name: vr.name,
        type: vr.type,
        status: vr.status,
        parallelism: this.config.plan.pipeline.parallelism,
        itemsIn,
        itemsOut,
        queueSize: vr.outbox?.size ?? 0,
        // T12: real channel capacity
        queueCapacity: vr.outbox?.capacity ?? 0,
        latencyP50Ms,
        latencyP99Ms,
        latencyMaxMs,
        distributedItemsIn,
        distributedItemsOut,
        distributedBytesIn,
        distributedBytesOut,
        // T11: watermark fields
        topObservedWm,
        coalescedWm,
        lastForwardedWm,
        lastForwardedWmLatency,
        // T14: tags
        tags,
        // T15: user metrics (omit key when empty to keep object clean)
        ...(userMetrics ? { userMetrics } : {}),
      };
    });
  }

  private _wrapVertexPromise(vertexName: string, promise: Promise<void>): Promise<void> {
    return promise.then(
      (value) => {
        const runtime = this.vertexRuntimes.find((candidate) => candidate.name === vertexName);
        if (runtime && runtime.status !== 'CANCELLED') {
          runtime.status = 'COMPLETED';
        }
        return value;
      },
      (error) => {
        const runtime = this.vertexRuntimes.find((candidate) => candidate.name === vertexName);
        if (runtime) {
          runtime.status = this.abortController.signal.aborted ? 'CANCELLED' : 'FAILED';
        }
        throw error;
      },
    );
  }
}
