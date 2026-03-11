import { describe, expect, it } from 'bun:test';
import { BlitzJobExecutor } from '@zenystx/helios-core/job/BlitzJobExecutor';
import { computeExecutionPlan } from '@zenystx/helios-core/job/ExecutionPlan';
import type { PipelineDescriptor, VertexDescriptor, EdgeDescriptor } from '@zenystx/helios-core/job/PipelineDescriptor';
import { EdgeType } from '@zenystx/helios-core/job/PipelineDescriptor';
import { ProcessingGuarantee } from '@zenystx/helios-core/job/JobConfig';
import type { Source, SourceMessage } from '@zenystx/helios-blitz/source/Source';
import type { Sink } from '@zenystx/helios-blitz/sink/Sink';
import type { BlitzCodec } from '@zenystx/helios-blitz/codec/BlitzCodec';

// ─── Test Helpers ───────────────────────────────────────────────────────────

const identityCodec: BlitzCodec<unknown> = {
  encode: (v: unknown) => new TextEncoder().encode(JSON.stringify(v)),
  decode: (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)),
};

function arraySource<T>(items: T[], name = 'test-source'): Source<T> {
  return {
    name,
    codec: identityCodec as BlitzCodec<T>,
    messages(): AsyncIterable<SourceMessage<T>> {
      return (async function* () {
        for (const item of items) {
          yield { value: item, ack: () => {}, nak: () => {} };
        }
      })();
    },
  };
}

function collectSink<T>(collected: T[], name = 'test-sink'): Sink<T> {
  return {
    name,
    async write(value: T): Promise<void> {
      collected.push(value);
    },
  };
}

function vertex(name: string, type: VertexDescriptor['type']): VertexDescriptor {
  return { name, type, fnSource: null, sourceConfig: null, sinkConfig: null };
}

function edge(from: string, to: string, edgeType: EdgeType = EdgeType.LOCAL): EdgeDescriptor {
  return { from, to, edgeType, subject: '', keyFnSource: null };
}

const authority = {
  fenceToken: 'fence-1',
  masterMemberId: 'master-1',
  memberListVersion: 1,
};

describe('BlitzJobExecutor — multi-job management', () => {
  it('starts and completes a single job execution', async () => {
    const collected: number[] = [];
    const source = arraySource([10, 20, 30]);
    const sink = collectSink(collected);

    const pipeline: PipelineDescriptor = {
      name: 'single-job',
      vertices: [vertex('source', 'source'), vertex('sink', 'sink')],
      edges: [edge('source', 'sink')],
      parallelism: 1,
    };
    const plan = computeExecutionPlan('job-exec-1', pipeline, ['member-1'], authority);

    const executor = new BlitzJobExecutor('member-1');

    await executor.startExecution(plan, {
      sources: new Map([['source', source]]),
      sinks: new Map([['sink', sink]]),
      operatorFns: new Map(),
      guarantee: ProcessingGuarantee.NONE,
      maxProcessorAccumulatedRecords: 1024,
    });

    // Wait for batch completion
    await executor.waitForCompletion('job-exec-1', 5000);

    expect(collected).toEqual([10, 20, 30]);
  });

  it('runs multiple concurrent jobs', async () => {
    const collected1: number[] = [];
    const collected2: string[] = [];

    const source1 = arraySource([1, 2, 3]);
    const sink1 = collectSink(collected1);
    const source2 = arraySource(['a', 'b', 'c']);
    const sink2 = collectSink(collected2);

    const pipeline1: PipelineDescriptor = {
      name: 'job-a',
      vertices: [vertex('source', 'source'), vertex('sink', 'sink')],
      edges: [edge('source', 'sink')],
      parallelism: 1,
    };
    const pipeline2: PipelineDescriptor = {
      name: 'job-b',
      vertices: [vertex('source', 'source'), vertex('sink', 'sink')],
      edges: [edge('source', 'sink')],
      parallelism: 1,
    };

    const plan1 = computeExecutionPlan('job-a', pipeline1, ['member-1'], authority);
    const plan2 = computeExecutionPlan('job-b', pipeline2, ['member-1'], authority);

    const executor = new BlitzJobExecutor('member-1');

    await executor.startExecution(plan1, {
      sources: new Map([['source', source1]]),
      sinks: new Map([['sink', sink1]]),
      operatorFns: new Map(),
      guarantee: ProcessingGuarantee.NONE,
      maxProcessorAccumulatedRecords: 1024,
    });

    await executor.startExecution(plan2, {
      sources: new Map([['source', source2]]),
      sinks: new Map([['sink', sink2]]),
      operatorFns: new Map(),
      guarantee: ProcessingGuarantee.NONE,
      maxProcessorAccumulatedRecords: 1024,
    });

    await Promise.all([
      executor.waitForCompletion('job-a', 5000),
      executor.waitForCompletion('job-b', 5000),
    ]);

    expect(collected1).toEqual([1, 2, 3]);
    expect(collected2).toEqual(['a', 'b', 'c']);
  });

  it('stops a running job execution', async () => {
    const collected: number[] = [];
    const infiniteSource: Source<number> = {
      name: 'infinite',
      codec: identityCodec as BlitzCodec<number>,
      messages(): AsyncIterable<SourceMessage<number>> {
        return (async function* () {
          let i = 0;
          while (true) {
            yield { value: i++, ack: () => {}, nak: () => {} };
            await new Promise(r => setTimeout(r, 10));
          }
        })();
      },
    };
    const sink = collectSink(collected);

    const pipeline: PipelineDescriptor = {
      name: 'stop-test',
      vertices: [vertex('source', 'source'), vertex('sink', 'sink')],
      edges: [edge('source', 'sink')],
      parallelism: 1,
    };
    const plan = computeExecutionPlan('job-stop', pipeline, ['member-1'], authority);

    const executor = new BlitzJobExecutor('member-1');

    await executor.startExecution(plan, {
      sources: new Map([['source', infiniteSource]]),
      sinks: new Map([['sink', sink]]),
      operatorFns: new Map(),
      guarantee: ProcessingGuarantee.NONE,
      maxProcessorAccumulatedRecords: 1024,
    });

    await new Promise(r => setTimeout(r, 100));
    await executor.stopExecution('job-stop', 'cancel');

    expect(collected.length).toBeGreaterThan(0);
    // Verify it's removed from active executions
    expect(executor.getLocalMetrics('job-stop')).toBeNull();
  });

  it('collects local metrics for a running job', async () => {
    const collected: number[] = [];
    const source = arraySource([1, 2, 3, 4, 5]);
    const sink = collectSink(collected);

    const pipeline: PipelineDescriptor = {
      name: 'metrics-test',
      vertices: [vertex('source', 'source'), vertex('sink', 'sink')],
      edges: [edge('source', 'sink')],
      parallelism: 1,
    };
    const plan = computeExecutionPlan('job-metrics', pipeline, ['member-1'], authority);

    const executor = new BlitzJobExecutor('member-1');

    await executor.startExecution(plan, {
      sources: new Map([['source', source]]),
      sinks: new Map([['sink', sink]]),
      operatorFns: new Map(),
      guarantee: ProcessingGuarantee.NONE,
      maxProcessorAccumulatedRecords: 1024,
    });

    await executor.waitForCompletion('job-metrics', 5000);

    const metrics = executor.getLocalMetrics('job-metrics');
    // After completion the execution is still tracked for metrics
    // (cleanup happens on stopExecution, not on natural completion)
    expect(metrics).not.toBeNull();
    if (metrics) {
      expect(metrics.length).toBeGreaterThan(0);
      expect(metrics[0]?.parallelism).toBe(1);
      expect(metrics[0]?.status).toBe('COMPLETED');
    }
  });

  it('exposes execution timestamps for tracked jobs', async () => {
    const collected: number[] = [];
    const source = arraySource([1, 2]);
    const sink = collectSink(collected);

    const pipeline: PipelineDescriptor = {
      name: 'timestamps-test',
      vertices: [vertex('source', 'source'), vertex('sink', 'sink')],
      edges: [edge('source', 'sink')],
      parallelism: 1,
    };
    const plan = computeExecutionPlan('job-timestamps', pipeline, ['member-1'], authority);

    const executor = new BlitzJobExecutor('member-1');

    await executor.startExecution(plan, {
      sources: new Map([['source', source]]),
      sinks: new Map([['sink', sink]]),
      operatorFns: new Map(),
      guarantee: ProcessingGuarantee.NONE,
      maxProcessorAccumulatedRecords: 1024,
    });

    await executor.waitForCompletion('job-timestamps', 5000);

    const timestamps = executor.getExecutionTimestamps('job-timestamps');
    expect(timestamps).not.toBeNull();
    expect(timestamps!.startTime).toBeGreaterThan(0);
    expect(timestamps!.completionTime).toBeGreaterThanOrEqual(timestamps!.startTime);
  });

  it('injects snapshot barrier into all source processors of a job', async () => {
    const collected: number[] = [];
    const source = arraySource([1, 2, 3]);
    const sink = collectSink(collected);

    const pipeline: PipelineDescriptor = {
      name: 'barrier-inject',
      vertices: [vertex('source', 'source'), vertex('sink', 'sink')],
      edges: [edge('source', 'sink')],
      parallelism: 1,
    };
    const plan = computeExecutionPlan('job-barrier', pipeline, ['member-1'], authority);

    const executor = new BlitzJobExecutor('member-1');

    await executor.startExecution(plan, {
      sources: new Map([['source', source]]),
      sinks: new Map([['sink', sink]]),
      operatorFns: new Map(),
      guarantee: ProcessingGuarantee.AT_LEAST_ONCE,
      maxProcessorAccumulatedRecords: 1024,
    });

    executor.injectSnapshotBarrier('job-barrier', 'snap-1');
    await executor.waitForCompletion('job-barrier', 5000);

    // All data items still arrive
    expect(collected).toEqual([1, 2, 3]);
  });

  it('returns null metrics for unknown job', () => {
    const executor = new BlitzJobExecutor('member-1');
    expect(executor.getLocalMetrics('nonexistent')).toBeNull();
  });

  it('handles stopExecution for already-completed job gracefully', async () => {
    const collected: number[] = [];
    const source = arraySource([1]);
    const sink = collectSink(collected);

    const pipeline: PipelineDescriptor = {
      name: 'already-done',
      vertices: [vertex('source', 'source'), vertex('sink', 'sink')],
      edges: [edge('source', 'sink')],
      parallelism: 1,
    };
    const plan = computeExecutionPlan('job-done', pipeline, ['member-1'], authority);

    const executor = new BlitzJobExecutor('member-1');

    await executor.startExecution(plan, {
      sources: new Map([['source', source]]),
      sinks: new Map([['sink', sink]]),
      operatorFns: new Map(),
      guarantee: ProcessingGuarantee.NONE,
      maxProcessorAccumulatedRecords: 1024,
    });

    await executor.waitForCompletion('job-done', 5000);
    // Should not throw
    await executor.stopExecution('job-done', 'cancel');
    expect(collected).toEqual([1]);
  });
});
