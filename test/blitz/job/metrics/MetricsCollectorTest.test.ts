import { describe, expect, it, beforeEach } from 'bun:test';
import { MetricsCollector } from '../../../../src/job/metrics/MetricsCollector.js';
import type { VertexMetrics, BlitzJobMetrics, SnapshotMetrics } from '../../../../src/job/metrics/BlitzJobMetrics.js';
import { BlitzJobCoordinator, type AuthorityTuple } from '../../../../src/job/BlitzJobCoordinator.js';
import { resolveJobConfig, type ResolvedJobConfig } from '../../../../src/job/JobConfig.js';
import type { PipelineDescriptor } from '../../../../src/job/PipelineDescriptor.js';
import type { ITopic } from '../../../../src/topic/ITopic.js';
import type { IMap } from '../../../../src/map/IMap.js';
import type { JobCommand } from '../../../../src/job/JobCommand.js';
import type { BlitzJobExecutor } from '../../../../src/job/BlitzJobExecutor.js';
import type { Message } from '../../../../src/topic/Message.js';
import { JobRecord } from '../../../../src/job/JobRecord.js';
import { JobStatus } from '../../../../src/job/JobStatus.js';

// ── Helpers ──────────────────────────────────────────────────

function makeVertex(name: string, type: 'source' | 'operator' | 'sink', overrides?: Partial<VertexMetrics>): VertexMetrics {
  return {
    name,
    type,
    itemsIn: 0,
    itemsOut: 0,
    queueSize: 0,
    latencyP50Ms: 0,
    latencyP99Ms: 0,
    latencyMaxMs: 0,
    ...overrides,
  };
}

function makeSnapshotMetrics(overrides?: Partial<SnapshotMetrics>): SnapshotMetrics {
  return {
    snapshotCount: 0,
    lastSnapshotDurationMs: 0,
    lastSnapshotBytes: 0,
    lastSnapshotTimestamp: 0,
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<ResolvedJobConfig>): ResolvedJobConfig {
  return {
    ...resolveJobConfig({ name: 'test-job' }, 'test-pipeline'),
    ...overrides,
  };
}

function makePipeline(name = 'test-pipeline'): PipelineDescriptor {
  return {
    name,
    vertices: [
      { name: 'src', type: 'source', fnSource: null, sourceConfig: { type: 'nats-subject', config: { subject: 'in' } }, sinkConfig: null },
      { name: 'sink', type: 'sink', fnSource: null, sourceConfig: null, sinkConfig: { type: 'log', config: {} } },
    ],
    edges: [{ from: 'src', to: 'sink', edgeType: 'LOCAL' as any, subject: '', keyFnSource: null }],
    parallelism: 1,
  };
}

function makeAuthority(overrides?: Partial<AuthorityTuple>): AuthorityTuple {
  return {
    masterMemberId: 'master-1',
    memberListVersion: 1,
    fenceToken: 'fence-001',
    ...overrides,
  };
}

function createMockIMap<K, V>(): IMap<K, V> {
  const store = new Map<K, V>();
  return {
    getName: () => '__blitz.jobs',
    put: async (k: K, v: V) => { const old = store.get(k) ?? null; store.set(k, v); return old; },
    set: async (k: K, v: V) => { store.set(k, v); },
    get: async (k: K) => store.get(k) ?? null,
    remove: async (k: K) => { const v = store.get(k) ?? null; store.delete(k); return v; },
    delete: async (k: K) => { store.delete(k); },
    containsKey: (k: K) => store.has(k),
    containsValue: (v: V) => [...store.values()].includes(v),
    size: () => store.size,
    isEmpty: () => store.size === 0,
    clear: async () => { store.clear(); },
    putIfAbsent: async (k: K, v: V) => { if (store.has(k)) return store.get(k)!; store.set(k, v); return null; },
    putAll: async (entries: Iterable<[K, V]>) => { for (const [k, v] of entries) store.set(k, v); },
    getAll: async (keys: K[]) => { const m = new Map<K, V | null>(); for (const k of keys) m.set(k, store.get(k) ?? null); return m; },
    replace: async (k: K, v: V) => { if (!store.has(k)) return null; const old = store.get(k)!; store.set(k, v); return old; },
    replaceIfSame: async () => false,
    addIndex: () => {},
    values: (() => [...store.values()]) as any,
    keys: (() => [...store.keys()]) as any,
    keySet: () => new Set(store.keys()),
    entrySet: () => new Set([...store.entries()].map(([k, v]) => ({ key: k, value: v }))),
    addEntryListener: () => '',
    removeEntryListener: () => true,
    addPartitionLostListener: () => '',
    removePartitionLostListener: () => true,
    aggregate: async () => null as any,
    destroy: () => {},
    getLocalMapStats: () => ({} as any),
    forceUnlock: () => {},
    isLocked: () => false,
    lock: async () => {},
    tryLock: async () => true,
    unlock: async () => {},
    evict: async () => true,
    evictAll: async () => {},
    loadAll: async () => {},
    executeOnKey: async () => null as any,
    executeOnKeys: async () => new Map() as any,
    executeOnEntries: async () => new Map() as any,
  } as unknown as IMap<K, V>;
}

function createMockTopic(): ITopic<JobCommand> & {
  published: JobCommand[];
  listeners: Map<string, (msg: Message<JobCommand>) => void>;
  injectMessage: (cmd: JobCommand) => void;
} {
  let listenerId = 0;
  const published: JobCommand[] = [];
  const listeners = new Map<string, (msg: Message<JobCommand>) => void>();

  return {
    published,
    listeners,
    getName: () => '__blitz.job-commands',
    publish: (msg: JobCommand) => { published.push(msg); },
    publishAsync: async (msg: JobCommand) => { published.push(msg); },
    publishAll: (msgs: Iterable<JobCommand | null>) => { for (const m of msgs) if (m) published.push(m); },
    publishAllAsync: async (msgs: Iterable<JobCommand | null>) => { for (const m of msgs) if (m) published.push(m); },
    addMessageListener: (listener: (msg: Message<JobCommand>) => void) => {
      const id = `listener-${++listenerId}`;
      listeners.set(id, listener);
      return id;
    },
    removeMessageListener: (id: string) => listeners.delete(id),
    getLocalTopicStats: () => ({} as any),
    destroy: () => { listeners.clear(); },
    injectMessage: (cmd: JobCommand) => {
      const msg = { getMessageObject: () => cmd } as Message<JobCommand>;
      for (const listener of listeners.values()) {
        listener(msg);
      }
    },
  };
}

function createMockExecutor(memberId = 'master-1'): BlitzJobExecutor & {
  startedJobs: string[];
  stoppedJobs: Array<{ jobId: string; reason: string }>;
  localMetrics: Map<string, VertexMetrics[]>;
  snapshotMetricsMap: Map<string, SnapshotMetrics>;
} {
  const startedJobs: string[] = [];
  const stoppedJobs: Array<{ jobId: string; reason: string }> = [];
  const localMetrics = new Map<string, VertexMetrics[]>();
  const snapshotMetricsMap = new Map<string, SnapshotMetrics>();

  return {
    memberId,
    startedJobs,
    stoppedJobs,
    localMetrics,
    snapshotMetricsMap,
    startExecution: async (plan: any) => { startedJobs.push(plan.jobId); },
    stopExecution: async (jobId: string, reason: string) => { stoppedJobs.push({ jobId, reason }); },
    waitForCompletion: async () => {},
    getLocalMetrics: (jobId: string) => localMetrics.get(jobId) ?? null,
    getLocalSnapshotMetrics: (jobId: string) => snapshotMetricsMap.get(jobId) ?? null,
    injectSnapshotBarrier: () => {},
  } as any;
}

// ── MetricsCollector.aggregate() Tests ────────────────────────

describe('MetricsCollector', () => {
  describe('aggregate()', () => {
    it('aggregates single-member metrics into BlitzJobMetrics', () => {
      const memberMetrics = new Map<string, VertexMetrics[]>();
      memberMetrics.set('member-a', [
        makeVertex('src', 'source', { itemsIn: 0, itemsOut: 100 }),
        makeVertex('sink', 'sink', { itemsIn: 100, itemsOut: 0 }),
      ]);

      const snapshots = makeSnapshotMetrics({ snapshotCount: 2, lastSnapshotDurationMs: 50 });
      const result = MetricsCollector.aggregate(memberMetrics, snapshots);

      expect(result.totalIn).toBe(100);
      expect(result.totalOut).toBe(100);
      expect(result.vertices.size).toBe(2);
      expect(result.vertices.get('src')!.itemsOut).toBe(100);
      expect(result.vertices.get('sink')!.itemsIn).toBe(100);
      expect(result.snapshots.snapshotCount).toBe(2);
      expect(result.collectedAt).toBeGreaterThan(0);
    });

    it('sums itemsIn/Out across multiple members for the same vertex', () => {
      const memberMetrics = new Map<string, VertexMetrics[]>();
      memberMetrics.set('member-a', [
        makeVertex('src', 'source', { itemsIn: 0, itemsOut: 50 }),
        makeVertex('op', 'operator', { itemsIn: 50, itemsOut: 40 }),
        makeVertex('sink', 'sink', { itemsIn: 40, itemsOut: 0 }),
      ]);
      memberMetrics.set('member-b', [
        makeVertex('src', 'source', { itemsIn: 0, itemsOut: 70 }),
        makeVertex('op', 'operator', { itemsIn: 70, itemsOut: 60 }),
        makeVertex('sink', 'sink', { itemsIn: 60, itemsOut: 0 }),
      ]);

      const result = MetricsCollector.aggregate(memberMetrics, makeSnapshotMetrics());

      expect(result.totalIn).toBe(120);  // source itemsOut
      expect(result.totalOut).toBe(100); // sink itemsIn
      expect(result.vertices.get('src')!.itemsOut).toBe(120);
      expect(result.vertices.get('op')!.itemsIn).toBe(120);
      expect(result.vertices.get('op')!.itemsOut).toBe(100);
      expect(result.vertices.get('sink')!.itemsIn).toBe(100);
    });

    it('merges latency distributions across members (max of maxes, weighted percentiles)', () => {
      const memberMetrics = new Map<string, VertexMetrics[]>();
      memberMetrics.set('member-a', [
        makeVertex('op', 'operator', { latencyP50Ms: 10, latencyP99Ms: 50, latencyMaxMs: 80 }),
      ]);
      memberMetrics.set('member-b', [
        makeVertex('op', 'operator', { latencyP50Ms: 20, latencyP99Ms: 60, latencyMaxMs: 120 }),
      ]);

      const result = MetricsCollector.aggregate(memberMetrics, makeSnapshotMetrics());

      const opMetrics = result.vertices.get('op')!;
      // Max of maxes
      expect(opMetrics.latencyMaxMs).toBe(120);
      // Merged p50 should be average of both members' p50
      expect(opMetrics.latencyP50Ms).toBe(15);
      // Merged p99 should be max of both members' p99
      expect(opMetrics.latencyP99Ms).toBe(60);
    });

    it('sums queueSize across members', () => {
      const memberMetrics = new Map<string, VertexMetrics[]>();
      memberMetrics.set('member-a', [
        makeVertex('op', 'operator', { queueSize: 10 }),
      ]);
      memberMetrics.set('member-b', [
        makeVertex('op', 'operator', { queueSize: 25 }),
      ]);

      const result = MetricsCollector.aggregate(memberMetrics, makeSnapshotMetrics());
      expect(result.vertices.get('op')!.queueSize).toBe(35);
    });

    it('handles empty member metrics map', () => {
      const result = MetricsCollector.aggregate(new Map(), makeSnapshotMetrics());

      expect(result.totalIn).toBe(0);
      expect(result.totalOut).toBe(0);
      expect(result.vertices.size).toBe(0);
    });

    it('passes through snapshot metrics', () => {
      const snapshots = makeSnapshotMetrics({
        snapshotCount: 5,
        lastSnapshotDurationMs: 120,
        lastSnapshotBytes: 4096,
        lastSnapshotTimestamp: 1700000000000,
      });

      const result = MetricsCollector.aggregate(new Map(), snapshots);

      expect(result.snapshots.snapshotCount).toBe(5);
      expect(result.snapshots.lastSnapshotDurationMs).toBe(120);
      expect(result.snapshots.lastSnapshotBytes).toBe(4096);
      expect(result.snapshots.lastSnapshotTimestamp).toBe(1700000000000);
    });

    it('three-member aggregation produces correct totals', () => {
      const memberMetrics = new Map<string, VertexMetrics[]>();
      memberMetrics.set('m1', [makeVertex('src', 'source', { itemsOut: 100 })]);
      memberMetrics.set('m2', [makeVertex('src', 'source', { itemsOut: 200 })]);
      memberMetrics.set('m3', [makeVertex('src', 'source', { itemsOut: 300 })]);

      const result = MetricsCollector.aggregate(memberMetrics, makeSnapshotMetrics());
      expect(result.vertices.get('src')!.itemsOut).toBe(600);
      expect(result.totalIn).toBe(600); // sources produce totalIn
    });
  });
});

// ── COLLECT_METRICS / METRICS_RESPONSE Protocol Tests ─────────

describe('MetricsCollector — ITopic Protocol', () => {
  let coordinator: BlitzJobCoordinator;
  let imap: IMap<string, JobRecord>;
  let topic: ReturnType<typeof createMockTopic>;
  let executor: ReturnType<typeof createMockExecutor>;

  beforeEach(() => {
    imap = createMockIMap<string, JobRecord>();
    topic = createMockTopic();
    executor = createMockExecutor();
    coordinator = new BlitzJobCoordinator(
      imap, topic, executor,
      ['member-a', 'member-b'],
      makeAuthority(),
      undefined,
      100,
    );
  });

  async function submitAndGetJob() {
    const config = makeConfig();
    const pipeline = makePipeline();
    const submitPromise = coordinator.submitJob(pipeline, config);

    // Wait for START_EXECUTION to be published
    await new Promise(r => setTimeout(r, 10));

    const startCmd = topic.published.find(c => c.type === 'START_EXECUTION')!;
    const jobId = (startCmd as any).jobId;

    // Simulate both members ready
    topic.injectMessage({ type: 'EXECUTION_READY', jobId, memberId: 'member-a' });
    topic.injectMessage({ type: 'EXECUTION_READY', jobId, memberId: 'member-b' });

    const job = await submitPromise;
    return { job, jobId };
  }

  it('getMetrics() publishes COLLECT_METRICS and aggregates METRICS_RESPONSE from all members', async () => {
    const { job, jobId } = await submitAndGetJob();

    // Set up local metrics for master
    executor.localMetrics.set(jobId, [
      makeVertex('src', 'source', { itemsOut: 50 }),
    ]);

    const metricsPromise = job.getMetrics();

    // Wait for COLLECT_METRICS to be published
    await new Promise(r => setTimeout(r, 10));

    const collectCmd = topic.published.find(c => c.type === 'COLLECT_METRICS');
    expect(collectCmd).toBeDefined();
    expect((collectCmd as any).jobId).toBe(jobId);

    const requestId = (collectCmd as any).requestId;

    // Simulate METRICS_RESPONSE from both members
    topic.injectMessage({
      type: 'METRICS_RESPONSE',
      jobId,
      requestId,
      memberId: 'member-a',
      metrics: [
        makeVertex('src', 'source', { itemsOut: 50 }),
        makeVertex('sink', 'sink', { itemsIn: 50 }),
      ],
    });
    topic.injectMessage({
      type: 'METRICS_RESPONSE',
      jobId,
      requestId,
      memberId: 'member-b',
      metrics: [
        makeVertex('src', 'source', { itemsOut: 70 }),
        makeVertex('sink', 'sink', { itemsIn: 70 }),
      ],
    });

    const result = await metricsPromise;

    // Result should be aggregated BlitzJobMetrics
    expect(result).toBeDefined();
    expect((result as any).totalIn).toBe(120);
    expect((result as any).totalOut).toBe(120);
  });

  it('handles partial response with timeout — returns available data', async () => {
    const { job, jobId } = await submitAndGetJob();

    executor.localMetrics.set(jobId, [
      makeVertex('src', 'source', { itemsOut: 50 }),
    ]);

    const metricsPromise = job.getMetrics();

    await new Promise(r => setTimeout(r, 10));

    const collectCmd = topic.published.find(c => c.type === 'COLLECT_METRICS')!;
    const requestId = (collectCmd as any).requestId;

    // Only member-a responds; member-b times out
    topic.injectMessage({
      type: 'METRICS_RESPONSE',
      jobId,
      requestId,
      memberId: 'member-a',
      metrics: [makeVertex('src', 'source', { itemsOut: 50 })],
    });

    // Wait for timeout (coordinator uses short timeout in tests)
    const result = await metricsPromise;

    // Should return partial aggregation from available responses
    expect(result).toBeDefined();
    expect((result as any).totalIn).toBe(50);
  });

  it('light job getMetrics returns local-only metrics without COLLECT_METRICS', async () => {
    const config = makeConfig();
    const pipeline = makePipeline();

    executor.localMetrics.set('any', [
      makeVertex('src', 'source', { itemsOut: 42 }),
    ]);

    const lightJob = await coordinator.submitLightJob(pipeline, config);

    // Override the executor mock to return metrics for the light job ID
    executor.localMetrics.set(lightJob.id, [
      makeVertex('src', 'source', { itemsOut: 42 }),
    ]);

    const result = await lightJob.getMetrics();

    // Light job should NOT publish COLLECT_METRICS
    const collectCmds = topic.published.filter(c => c.type === 'COLLECT_METRICS');
    expect(collectCmds.length).toBe(0);

    // Should return local vertex metrics (not aggregated BlitzJobMetrics)
    expect(Array.isArray(result)).toBe(true);
  });

  it('METRICS_RESPONSE for wrong requestId is ignored', async () => {
    const { job, jobId } = await submitAndGetJob();

    executor.localMetrics.set(jobId, []);

    const metricsPromise = job.getMetrics();
    await new Promise(r => setTimeout(r, 10));

    const collectCmd = topic.published.find(c => c.type === 'COLLECT_METRICS')!;
    const requestId = (collectCmd as any).requestId;

    // Send response with wrong requestId
    topic.injectMessage({
      type: 'METRICS_RESPONSE',
      jobId,
      requestId: 'wrong-id',
      memberId: 'member-a',
      metrics: [makeVertex('src', 'source', { itemsOut: 999 })],
    });

    // Send correct responses
    topic.injectMessage({
      type: 'METRICS_RESPONSE',
      jobId,
      requestId,
      memberId: 'member-a',
      metrics: [makeVertex('src', 'source', { itemsOut: 10 })],
    });
    topic.injectMessage({
      type: 'METRICS_RESPONSE',
      jobId,
      requestId,
      memberId: 'member-b',
      metrics: [makeVertex('src', 'source', { itemsOut: 20 })],
    });

    const result = await metricsPromise;
    expect((result as any).totalIn).toBe(30);
  });

  it('duplicate METRICS_RESPONSE from same member is idempotent', async () => {
    const { job, jobId } = await submitAndGetJob();

    executor.localMetrics.set(jobId, []);

    const metricsPromise = job.getMetrics();
    await new Promise(r => setTimeout(r, 10));

    const collectCmd = topic.published.find(c => c.type === 'COLLECT_METRICS')!;
    const requestId = (collectCmd as any).requestId;

    // Duplicate from member-a
    topic.injectMessage({
      type: 'METRICS_RESPONSE', jobId, requestId,
      memberId: 'member-a',
      metrics: [makeVertex('src', 'source', { itemsOut: 50 })],
    });
    topic.injectMessage({
      type: 'METRICS_RESPONSE', jobId, requestId,
      memberId: 'member-a',
      metrics: [makeVertex('src', 'source', { itemsOut: 999 })],
    });
    topic.injectMessage({
      type: 'METRICS_RESPONSE', jobId, requestId,
      memberId: 'member-b',
      metrics: [makeVertex('src', 'source', { itemsOut: 30 })],
    });

    const result = await metricsPromise;
    // Should use first response from member-a (50), not duplicate (999)
    expect((result as any).totalIn).toBe(80);
  });
});
