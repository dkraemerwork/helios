import type { ExecutionPlan } from '../ExecutionPlan.js';
import type { VertexMetrics } from '../metrics/BlitzJobMetrics.js';
import type { Source } from '@zenystx/helios-blitz/source/Source.js';
import type { Sink } from '@zenystx/helios-blitz/sink/Sink.js';
import type { ProcessingGuarantee } from '../JobConfig.js';
import { AsyncChannel } from './AsyncChannel.js';
import type { ProcessorItem } from './ProcessorItem.js';
import { SourceProcessor } from './SourceProcessor.js';
import { SinkProcessor } from './SinkProcessor.js';
import { OperatorProcessor } from './OperatorProcessor.js';

export interface OperatorFnEntry {
  readonly fn: (value: unknown) => unknown;
  readonly mode: 'map' | 'filter' | 'flatMap';
}

export interface JobExecutionConfig {
  readonly jobId: string;
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
}

/**
 * JobExecution — wires up a full DAG on a single member.
 *
 * Creates AsyncChannels for local edges, SourceProcessors for source vertices,
 * OperatorProcessors for operator vertices, SinkProcessors for sink vertices.
 * Starts all async loops and stops all on cancel via AbortController.
 */
export class JobExecution {
  private readonly config: JobExecutionConfig;
  private readonly abortController = new AbortController();
  private readonly vertexRuntimes: VertexRuntime[] = [];
  private readonly sourceProcessors: SourceProcessor<unknown>[] = [];
  private _completionPromise: Promise<void> | null = null;

  constructor(config: JobExecutionConfig) {
    this.config = config;
  }

  get jobId(): string {
    return this.config.jobId;
  }

  /**
   * Wire up the DAG and start all processing loops.
   */
  async start(): Promise<void> {
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

          const promise = sourceProc.run(signal).catch(err => {
            if (!signal.aborted) throw err;
          });

          this.vertexRuntimes.push({
            name: vertexDesc.name,
            type: 'source',
            promise,
            sourceProcessor: sourceProc,
            outbox,
            itemsIn: 0,
            itemsOut: 0,
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

          const promise = operatorProc.run(signal).catch(err => {
            if (!signal.aborted) throw err;
          });

          this.vertexRuntimes.push({
            name: vertexDesc.name,
            type: 'operator',
            promise,
            operatorProcessor: operatorProc,
            outbox,
            itemsIn: 0,
            itemsOut: 0,
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

          const promise = sinkProc.run(signal).then(() => {}).catch(err => {
            if (!signal.aborted) throw err;
          });

          this.vertexRuntimes.push({
            name: vertexDesc.name,
            type: 'sink',
            promise,
            sinkProcessor: sinkProc,
            itemsIn: 0,
            itemsOut: 0,
          });
          promises.push(promise);
          break;
        }
      }
    }

    this._completionPromise = Promise.allSettled(promises).then(() => {});
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

  /**
   * Stop all processing loops.
   */
  async stop(): Promise<void> {
    this.abortController.abort();
    if (this._completionPromise) {
      await this._completionPromise;
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
   * Collect per-vertex metrics from the running execution.
   */
  getMetrics(): VertexMetrics[] {
    return this.vertexRuntimes.map(vr => ({
      name: vr.name,
      type: vr.type,
      itemsIn: vr.itemsIn,
      itemsOut: vr.itemsOut,
      queueSize: vr.outbox?.size ?? 0,
      latencyP50Ms: 0,
      latencyP99Ms: 0,
      latencyMaxMs: 0,
    }));
  }
}
