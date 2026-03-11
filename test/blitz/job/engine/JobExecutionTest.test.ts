import { describe, expect, it } from 'bun:test';
import { JobExecution } from '@zenystx/helios-core/job/engine/JobExecution';
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

function vertex(name: string, type: VertexDescriptor['type'], fnSource: string | null = null): VertexDescriptor {
  return { name, type, fnSource, sourceConfig: null, sinkConfig: null };
}

function edge(from: string, to: string, edgeType: EdgeType = EdgeType.LOCAL): EdgeDescriptor {
  return { from, to, edgeType, subject: '', keyFnSource: null };
}

const authority = {
  fenceToken: 'fence-1',
  masterMemberId: 'master-1',
  memberListVersion: 1,
};

describe('JobExecution — full DAG wiring', () => {
  it('wires source → sink and processes all items', async () => {
    const collected: number[] = [];
    const source = arraySource([1, 2, 3]);
    const sink = collectSink(collected);

    const pipeline: PipelineDescriptor = {
      name: 'simple-pipeline',
      vertices: [vertex('source', 'source'), vertex('sink', 'sink')],
      edges: [edge('source', 'sink')],
      parallelism: 1,
    };
    const plan = computeExecutionPlan('job-1', pipeline, ['member-1'], authority);

    const exec = new JobExecution({
      jobId: 'job-1',
      plan,
      memberId: 'member-1',
      sources: new Map([['source', source]]),
      sinks: new Map([['sink', sink]]),
      operatorFns: new Map(),
      guarantee: ProcessingGuarantee.NONE,
      maxProcessorAccumulatedRecords: 1024,
    });

    await exec.start();
    await exec.waitForCompletion(5000);

    expect(collected).toEqual([1, 2, 3]);
  });

  it('wires source → map → filter → sink', async () => {
    const collected: number[] = [];
    const source = arraySource([1, 2, 3, 4, 5, 6]);
    const sink = collectSink(collected);

    const pipeline: PipelineDescriptor = {
      name: 'map-filter-pipeline',
      vertices: [
        vertex('source', 'source'),
        vertex('double', 'operator', '(x) => x * 2'),
        vertex('evens', 'operator', '(x) => x > 4 ? x : undefined'),
        vertex('sink', 'sink'),
      ],
      edges: [
        edge('source', 'double'),
        edge('double', 'evens'),
        edge('evens', 'sink'),
      ],
      parallelism: 1,
    };
    const plan = computeExecutionPlan('job-2', pipeline, ['member-1'], authority);

    const exec = new JobExecution({
      jobId: 'job-2',
      plan,
      memberId: 'member-1',
      sources: new Map([['source', source]]),
      sinks: new Map([['sink', sink]]),
      operatorFns: new Map([
        ['double', { fn: (x: unknown) => (x as number) * 2, mode: 'map' as const }],
        ['evens', { fn: (x: unknown) => (x as number) > 4 ? x : undefined, mode: 'filter' as const }],
      ]),
      guarantee: ProcessingGuarantee.NONE,
      maxProcessorAccumulatedRecords: 1024,
    });

    await exec.start();
    await exec.waitForCompletion(5000);

    // [1,2,3,4,5,6] → double → [2,4,6,8,10,12] → filter >4 → [6,8,10,12]
    expect(collected).toEqual([6, 8, 10, 12]);
  });

  it('stops all processors on abort', async () => {
    // Source that never ends
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
    const collected: number[] = [];
    const sink = collectSink(collected);

    const pipeline: PipelineDescriptor = {
      name: 'infinite-pipeline',
      vertices: [vertex('source', 'source'), vertex('sink', 'sink')],
      edges: [edge('source', 'sink')],
      parallelism: 1,
    };
    const plan = computeExecutionPlan('job-3', pipeline, ['member-1'], authority);

    const exec = new JobExecution({
      jobId: 'job-3',
      plan,
      memberId: 'member-1',
      sources: new Map([['source', infiniteSource]]),
      sinks: new Map([['sink', sink]]),
      operatorFns: new Map(),
      guarantee: ProcessingGuarantee.NONE,
      maxProcessorAccumulatedRecords: 1024,
    });

    await exec.start();
    // Let some items flow
    await new Promise(r => setTimeout(r, 100));
    await exec.stop();

    expect(collected.length).toBeGreaterThan(0);
    // Verify it actually stopped
    const countAfterStop = collected.length;
    await new Promise(r => setTimeout(r, 100));
    expect(collected.length).toBe(countAfterStop);
  });

  it('collects vertex metrics from running execution', async () => {
    const collected: number[] = [];
    const source = arraySource([1, 2, 3, 4, 5]);
    const sink = collectSink(collected);

    const pipeline: PipelineDescriptor = {
      name: 'metrics-pipeline',
      vertices: [vertex('source', 'source'), vertex('sink', 'sink')],
      edges: [edge('source', 'sink')],
      parallelism: 1,
    };
    const plan = computeExecutionPlan('job-4', pipeline, ['member-1'], authority);

    const exec = new JobExecution({
      jobId: 'job-4',
      plan,
      memberId: 'member-1',
      sources: new Map([['source', source]]),
      sinks: new Map([['sink', sink]]),
      operatorFns: new Map(),
      guarantee: ProcessingGuarantee.NONE,
      maxProcessorAccumulatedRecords: 1024,
    });

    await exec.start();
    await exec.waitForCompletion(5000);

    const metrics = exec.getMetrics();
    expect(metrics.length).toBeGreaterThan(0);
    // At least source and sink vertex metrics present
    const names = metrics.map(m => m.name);
    expect(names).toContain('source');
    expect(names).toContain('sink');
    expect(metrics.every((metric) => metric.parallelism === 1)).toBe(true);
    expect(metrics.every((metric) => metric.status === 'COMPLETED')).toBe(true);
  });

  it('injects snapshot barriers into source processors', async () => {
    const collected: unknown[] = [];
    const source = arraySource([1, 2, 3]);
    const sink = collectSink(collected);

    const pipeline: PipelineDescriptor = {
      name: 'barrier-pipeline',
      vertices: [vertex('source', 'source'), vertex('sink', 'sink')],
      edges: [edge('source', 'sink')],
      parallelism: 1,
    };
    const plan = computeExecutionPlan('job-5', pipeline, ['member-1'], authority);

    const exec = new JobExecution({
      jobId: 'job-5',
      plan,
      memberId: 'member-1',
      sources: new Map([['source', source]]),
      sinks: new Map([['sink', sink]]),
      operatorFns: new Map(),
      guarantee: ProcessingGuarantee.AT_LEAST_ONCE,
      maxProcessorAccumulatedRecords: 1024,
    });

    await exec.start();
    // Inject a barrier while the DAG is running
    exec.injectSnapshotBarrier('snap-1');
    await exec.waitForCompletion(5000);

    // All data items should still arrive at the sink
    expect(collected).toEqual([1, 2, 3]);
  });
});
