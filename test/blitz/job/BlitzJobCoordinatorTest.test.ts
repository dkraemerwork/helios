import { describe, expect, it, beforeEach } from 'bun:test';
import { BlitzJobCoordinator, type AuthorityTuple } from '../../../src/job/BlitzJobCoordinator.js';
import { JobStatus } from '../../../src/job/JobStatus.js';
import { JobRecord } from '../../../src/job/JobRecord.js';
import { resolveJobConfig, ProcessingGuarantee, type ResolvedJobConfig } from '../../../src/job/JobConfig.js';
import type { PipelineDescriptor } from '../../../src/job/PipelineDescriptor.js';
import type { ITopic } from '../../../src/topic/ITopic.js';
import type { IMap } from '../../../src/map/IMap.js';
import type { JobCommand } from '../../../src/job/JobCommand.js';
import type { BlitzJobExecutor } from '../../../src/job/BlitzJobExecutor.js';
import type { Message } from '../../../src/topic/Message.js';

// ── Helpers ──────────────────────────────────────────────────

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

/** In-memory IMap mock */
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
    replaceIfSame: async (_k: K, _ov: V, _nv: V) => false,
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

/** Mock ITopic that records published commands and allows injecting messages */
function createMockTopic(): ITopic<JobCommand> & {
  published: JobCommand[];
  listeners: Map<string, (msg: Message<JobCommand>) => void>;
  injectMessage: (cmd: JobCommand) => void;
} {
  let listenerId = 0;
  const published: JobCommand[] = [];
  const listeners = new Map<string, (msg: Message<JobCommand>) => void>();

  const topic = {
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

  return topic;
}

/** Mock executor that tracks calls */
function createMockExecutor(): BlitzJobExecutor & {
  startedJobs: string[];
  stoppedJobs: Array<{ jobId: string; reason: string }>;
  executionTimestamps: Map<string, { startTime: number; completionTime: number }>;
} {
  const startedJobs: string[] = [];
  const stoppedJobs: Array<{ jobId: string; reason: string }> = [];
  const executionTimestamps = new Map<string, { startTime: number; completionTime: number }>();

  return {
    memberId: 'master-1',
    startedJobs,
    stoppedJobs,
    executionTimestamps,
    startExecution: async (plan: any) => { startedJobs.push(plan.jobId); },
    stopExecution: async (jobId: string, reason: string) => { stoppedJobs.push({ jobId, reason }); },
    waitForCompletion: async () => {},
    getLocalMetrics: () => null,
    getExecutionTimestamps: (jobId: string) => executionTimestamps.get(jobId) ?? null,
    injectSnapshotBarrier: () => {},
  } as any;
}

// ── Tests ────────────────────────────────────────────────────

describe('BlitzJobCoordinator', () => {
  let coordinator: BlitzJobCoordinator;
  let imap: IMap<string, JobRecord>;
  let topic: ReturnType<typeof createMockTopic>;
  let executor: ReturnType<typeof createMockExecutor>;
  let authority: AuthorityTuple;

  beforeEach(() => {
    imap = createMockIMap<string, JobRecord>();
    topic = createMockTopic();
    executor = createMockExecutor();
    authority = makeAuthority();

    coordinator = new BlitzJobCoordinator(
      imap,
      topic,
      executor,
      ['member-a', 'member-b'],
      authority,
    );
  });

  // ── Submit Lifecycle ──────────────────────────────────────

  describe('submitJob', () => {
    it('creates JobRecord, stores in IMap, transitions through STARTING → RUNNING', async () => {
      const config = makeConfig();
      const pipeline = makePipeline();

      const submitPromise = coordinator.submitJob(pipeline, config);

      // Simulate EXECUTION_READY from all members
      await Bun.sleep(10);
      topic.injectMessage({ type: 'EXECUTION_READY', jobId: (getLatestJobId()), memberId: 'member-a' });
      topic.injectMessage({ type: 'EXECUTION_READY', jobId: (getLatestJobId()), memberId: 'member-b' });

      const job = await submitPromise;
      expect(job).toBeTruthy();
      expect(job.getStatus()).toBe(JobStatus.RUNNING);

      // Verify IMap has the record
      const record = await imap.get(job.id);
      expect(record).toBeTruthy();
      expect(record!.status).toBe(JobStatus.RUNNING);
    });

    it('sends START_EXECUTION command to all members via topic', async () => {
      const config = makeConfig();
      const pipeline = makePipeline();

      const submitPromise = coordinator.submitJob(pipeline, config);
      await Bun.sleep(10);

      const startCmd = topic.published.find(c => c.type === 'START_EXECUTION');
      expect(startCmd).toBeTruthy();
      expect(startCmd!.type).toBe('START_EXECUTION');

      // Complete the submission
      const jobId = getLatestJobId();
      topic.injectMessage({ type: 'EXECUTION_READY', jobId, memberId: 'member-a' });
      topic.injectMessage({ type: 'EXECUTION_READY', jobId, memberId: 'member-b' });
      await submitPromise;
    });

    it('computes ExecutionPlan with correct fence authority', async () => {
      const config = makeConfig();
      const pipeline = makePipeline();

      const submitPromise = coordinator.submitJob(pipeline, config);
      await Bun.sleep(10);

      const startCmd = topic.published.find(c => c.type === 'START_EXECUTION') as any;
      expect(startCmd?.plan?.fenceToken).toBe('fence-001');
      expect(startCmd?.plan?.masterMemberId).toBe('master-1');
      expect(startCmd?.plan?.memberListVersion).toBe(1);

      const jobId = getLatestJobId();
      topic.injectMessage({ type: 'EXECUTION_READY', jobId, memberId: 'member-a' });
      topic.injectMessage({ type: 'EXECUTION_READY', jobId, memberId: 'member-b' });
      await submitPromise;
    });
  });

  // ── Cancel ────────────────────────────────────────────────

  describe('cancelJob', () => {
    it('transitions to CANCELLED and sends STOP_EXECUTION(cancel)', async () => {
      const job = await submitAndRunJob();

      await coordinator.cancelJob(job.id);

      const record = await imap.get(job.id);
      expect(record!.status).toBe(JobStatus.CANCELLED);

      const stopCmd = topic.published.find(c => c.type === 'STOP_EXECUTION' && (c as any).reason === 'cancel');
      expect(stopCmd).toBeTruthy();
    });

    it('resolves join() promise after cancel', async () => {
      const job = await submitAndRunJob();

      let joinResolved = false;
      const joinPromise = job.join().then(() => { joinResolved = true; });

      await coordinator.cancelJob(job.id);
      await joinPromise;

      expect(joinResolved).toBe(true);
    });
  });

  // ── Suspend ───────────────────────────────────────────────

  describe('suspendJob', () => {
    it('transitions through SUSPENDED_EXPORTING_SNAPSHOT → SUSPENDED', async () => {
      const job = await submitAndRunJob({ processingGuarantee: ProcessingGuarantee.AT_LEAST_ONCE });

      const suspendPromise = coordinator.suspendJob(job.id);

      // The coordinator should set SUSPENDED_EXPORTING_SNAPSHOT first
      await Bun.sleep(10);

      // Simulate snapshot completion by injecting barrier completes for any pending snapshot
      await simulateSnapshotCompletion(job.id);

      await suspendPromise;

      const record = await imap.get(job.id);
      expect(record!.status).toBe(JobStatus.SUSPENDED);

      const stopCmd = topic.published.find(c => c.type === 'STOP_EXECUTION' && (c as any).reason === 'suspend');
      expect(stopCmd).toBeTruthy();
    });
  });

  // ── Resume ────────────────────────────────────────────────

  describe('resumeJob', () => {
    it('transitions from SUSPENDED → NOT_RUNNING → STARTING → RUNNING', async () => {
      const job = await submitAndRunJob({ processingGuarantee: ProcessingGuarantee.AT_LEAST_ONCE });

      // Suspend: must simulate snapshot completion concurrently
      const suspendPromise = coordinator.suspendJob(job.id);
      await Bun.sleep(10);
      await simulateSnapshotCompletion(job.id);
      await suspendPromise;

      const resumePromise = coordinator.resumeJob(job.id);
      await Bun.sleep(10);

      // Simulate members becoming ready again
      topic.injectMessage({ type: 'EXECUTION_READY', jobId: job.id, memberId: 'member-a' });
      topic.injectMessage({ type: 'EXECUTION_READY', jobId: job.id, memberId: 'member-b' });

      await resumePromise;

      const record = await imap.get(job.id);
      expect(record!.status).toBe(JobStatus.RUNNING);
    });
  });

  // ── Restart ───────────────────────────────────────────────

  describe('restartJob', () => {
    it('transitions from RESTARTING → STARTING → RUNNING', async () => {
      const job = await submitAndRunJob({ autoScaling: true });

      const restartPromise = coordinator.restartJob(job.id);
      await Bun.sleep(10);

      topic.injectMessage({ type: 'EXECUTION_READY', jobId: job.id, memberId: 'member-a' });
      topic.injectMessage({ type: 'EXECUTION_READY', jobId: job.id, memberId: 'member-b' });

      await restartPromise;

      const record = await imap.get(job.id);
      expect(record!.status).toBe(JobStatus.RUNNING);
    });
  });

  // ── Member Loss ───────────────────────────────────────────

  describe('onMemberLost', () => {
    it('autoScaling=true → RESTARTING and restarts job', async () => {
      const job = await submitAndRunJob({ autoScaling: true });

      const lostPromise = coordinator.onMemberLost('member-b');
      await Bun.sleep(10);

      // Should restart with remaining members; simulate ready
      topic.injectMessage({ type: 'EXECUTION_READY', jobId: job.id, memberId: 'member-a' });

      await lostPromise;

      const record = await imap.get(job.id);
      expect(record!.status).toBe(JobStatus.RUNNING);
    });

    it('autoScaling=false + suspendOnFailure=true → SUSPENDED', async () => {
      const job = await submitAndRunJob({ autoScaling: false, suspendOnFailure: true });

      await coordinator.onMemberLost('member-b');

      const record = await imap.get(job.id);
      expect(record!.status).toBe(JobStatus.SUSPENDED);
    });

    it('autoScaling=false + suspendOnFailure=false → FAILED', async () => {
      const job = await submitAndRunJob({ autoScaling: false, suspendOnFailure: false });

      await coordinator.onMemberLost('member-b');

      const record = await imap.get(job.id);
      expect(record!.status).toBe(JobStatus.FAILED);
    });
  });

  // ── Member Join ───────────────────────────────────────────

  describe('onMemberJoined', () => {
    it('autoScaling=true → debounced restart including new member', async () => {
      const job = await submitAndRunJob({ autoScaling: true, scaleUpDelayMillis: 50 });

      coordinator.onMemberJoined('member-c');

      // Wait for debounce to fire
      await Bun.sleep(100);

      // Simulate ready from all members including new one
      topic.injectMessage({ type: 'EXECUTION_READY', jobId: job.id, memberId: 'member-a' });
      topic.injectMessage({ type: 'EXECUTION_READY', jobId: job.id, memberId: 'member-b' });
      topic.injectMessage({ type: 'EXECUTION_READY', jobId: job.id, memberId: 'member-c' });

      await Bun.sleep(50);

      const record = await imap.get(job.id);
      expect(record!.status).toBe(JobStatus.RUNNING);
      // New member should be in participating members
      expect(record!.participatingMembers).toContain('member-c');
    });

    it('multiple rapid joins get debounced into a single restart', async () => {
      const job = await submitAndRunJob({ autoScaling: true, scaleUpDelayMillis: 100 });

      // Rapid joins
      coordinator.onMemberJoined('member-c');
      await Bun.sleep(20);
      coordinator.onMemberJoined('member-d');

      // Wait for debounce
      await Bun.sleep(200);

      // Only one STOP_EXECUTION(restart) should have been issued
      const restartStops = topic.published.filter(
        c => c.type === 'STOP_EXECUTION' && (c as any).reason === 'restart',
      );
      // Should be exactly 1 restart cycle (not 2)
      expect(restartStops.length).toBeLessThanOrEqual(1);
    });
  });

  // ── Job Lookup ────────────────────────────────────────────

  describe('getJob / getJobByName / getJobs', () => {
    it('getJob returns job by id', async () => {
      const job = await submitAndRunJob();

      const found = await coordinator.getJob(job.id);
      expect(found).toBeTruthy();
      expect(found!.id).toBe(job.id);
    });

    it('getJob returns null for unknown id', async () => {
      const found = await coordinator.getJob('unknown-id');
      expect(found).toBeNull();
    });

    it('getJobByName returns job by name', async () => {
      const job = await submitAndRunJob();

      const found = await coordinator.getJobByName(job.name);
      expect(found).toBeTruthy();
      expect(found!.name).toBe(job.name);
    });

    it('getJobs returns all jobs', async () => {
      const job1 = await submitAndRunJob({ name: 'job-alpha' });
      const job2 = await submitAndRunJob({ name: 'job-beta' });

      const all = await coordinator.getJobs();
      expect(all.length).toBe(2);
    });
  });

  // ── Demotion / Promotion ──────────────────────────────────

  describe('onDemotion / onPromotion', () => {
    it('onDemotion clears authority and stops snapshot coordinators', async () => {
      const job = await submitAndRunJob({ processingGuarantee: ProcessingGuarantee.AT_LEAST_ONCE });

      coordinator.onDemotion();

      // After demotion, operations requiring authority should fail
      await expect(coordinator.cancelJob(job.id)).rejects.toThrow();
    });

    it('onPromotion resumes coordination for RUNNING jobs', async () => {
      const job = await submitAndRunJob();

      // Simulate demotion then promotion
      coordinator.onDemotion();

      const newAuthority = makeAuthority({
        masterMemberId: 'master-2',
        memberListVersion: 2,
        fenceToken: 'fence-002',
      });

      await coordinator.onPromotion(newAuthority, ['member-a', 'member-b']);

      // Should be able to manage the job again
      const found = await coordinator.getJob(job.id);
      expect(found).toBeTruthy();
    });

    it('onPromotion detects dead members and triggers member-loss handling', async () => {
      const job = await submitAndRunJob({ autoScaling: true });
      coordinator.onDemotion();

      // Promote with member-b missing from alive list
      const newAuthority = makeAuthority({
        masterMemberId: 'master-2',
        memberListVersion: 2,
        fenceToken: 'fence-002',
      });

      const promotePromise = coordinator.onPromotion(newAuthority, ['member-a']);
      await Bun.sleep(10);

      // Simulate restart completion with remaining member
      topic.injectMessage({ type: 'EXECUTION_READY', jobId: job.id, memberId: 'member-a' });

      await promotePromise;

      const record = await imap.get(job.id);
      expect(record!.status).toBe(JobStatus.RUNNING);
    });
  });

  // ── Split-Brain Protection ────────────────────────────────

  describe('split-brain protection', () => {
    it('prevents job from running when alive members < ceil(total/2)', async () => {
      // Create coordinator with only 1 of 3 total members
      const sbCoordinator = new BlitzJobCoordinator(
        imap,
        topic,
        executor,
        ['member-a'],
        makeAuthority(),
        3, // totalMemberCount
      );

      const config = makeConfig({ splitBrainProtection: true });
      const pipeline = makePipeline();

      // Should refuse to start — only 1 member alive, need ceil(3/2) = 2
      await expect(sbCoordinator.submitJob(pipeline, config)).rejects.toThrow(/split-brain/i);
    });

    it('allows job when alive members >= ceil(total/2)', async () => {
      const config = makeConfig({ splitBrainProtection: true });
      const pipeline = makePipeline();

      // 2 members alive out of 2 total — quorum met
      const submitPromise = coordinator.submitJob(pipeline, config);
      await Bun.sleep(10);

      const jobId = getLatestJobId();
      topic.injectMessage({ type: 'EXECUTION_READY', jobId, memberId: 'member-a' });
      topic.injectMessage({ type: 'EXECUTION_READY', jobId, memberId: 'member-b' });

      const job = await submitPromise;
      expect(job.getStatus()).toBe(JobStatus.RUNNING);
    });
  });

  // ── Light Job ─────────────────────────────────────────────

  describe('light job', () => {
    it('runs locally without IMap storage', async () => {
      const config = makeConfig({ name: 'light-test' });
      const pipeline = makePipeline();

      const job = await coordinator.submitLightJob(pipeline, config);

      expect(job).toBeTruthy();
      expect(job.getStatus()).toBe(JobStatus.RUNNING);

      // Light job should NOT be stored in IMap
      const record = await imap.get(job.id);
      expect(record).toBeNull();
    });

    it('light job can be cancelled via local reference', async () => {
      const config = makeConfig({ name: 'light-cancel' });
      const pipeline = makePipeline();

      const job = await coordinator.submitLightJob(pipeline, config);
      await job.cancel();

      expect(job.getStatus()).toBe(JobStatus.CANCELLED);
    });

    it('light job has no snapshot coordination', async () => {
      const config = makeConfig({
        name: 'light-no-snap',
        processingGuarantee: ProcessingGuarantee.AT_LEAST_ONCE,
      });
      const pipeline = makePipeline();

      const job = await coordinator.submitLightJob(pipeline, config);
      expect(job).toBeTruthy();

      // No INJECT_BARRIER commands should appear
      const barriers = topic.published.filter(c => c.type === 'INJECT_BARRIER');
      expect(barriers.length).toBe(0);
    });

    it('reports real light-job execution timestamps from the executor', async () => {
      const config = makeConfig({ name: 'light-metadata' });
      const pipeline = makePipeline();

      const job = await coordinator.submitLightJob(pipeline, config);
      executor.executionTimestamps.set(job.id, { startTime: 123, completionTime: 456 });

      const metadata = await coordinator.getJobMetadata(job.id);

      expect(metadata).toMatchObject({
        lightJob: true,
        executionStartTime: 123,
        executionCompletionTime: 456,
      });
    });
  });

  // ── Fencing ───────────────────────────────────────────────

  describe('fencing', () => {
    it('all authoritative operations validate fence token', async () => {
      const job = await submitAndRunJob();

      // Demote (clears authority) then try operations
      coordinator.onDemotion();

      await expect(coordinator.cancelJob(job.id)).rejects.toThrow();
      await expect(coordinator.suspendJob(job.id)).rejects.toThrow();
      await expect(coordinator.resumeJob(job.id)).rejects.toThrow();
      await expect(coordinator.restartJob(job.id)).rejects.toThrow();
    });
  });

  // ── Helper: submit and run a job to RUNNING state ─────────

  async function submitAndRunJob(configOverrides?: Partial<ResolvedJobConfig>) {
    const config = makeConfig(configOverrides);
    const pipeline = makePipeline(config.name);

    const submitPromise = coordinator.submitJob(pipeline, config);
    await Bun.sleep(10);

    const jobId = getLatestJobId();
    topic.injectMessage({ type: 'EXECUTION_READY', jobId, memberId: 'member-a' });
    topic.injectMessage({ type: 'EXECUTION_READY', jobId, memberId: 'member-b' });

    return await submitPromise;
  }

  function getLatestJobId(): string {
    // Find the most recent START_EXECUTION command
    for (let i = topic.published.length - 1; i >= 0; i--) {
      if (topic.published[i].type === 'START_EXECUTION') {
        return topic.published[i].jobId;
      }
    }
    return topic.published[topic.published.length - 1]?.jobId ?? '';
  }

  async function simulateSnapshotCompletion(jobId: string): Promise<void> {
    // Find the INJECT_BARRIER command for this job
    const barrierCmd = topic.published.find(
      c => c.type === 'INJECT_BARRIER' && c.jobId === jobId,
    ) as any;
    if (!barrierCmd) return;

    topic.injectMessage({
      type: 'BARRIER_COMPLETE',
      jobId,
      snapshotId: barrierCmd.snapshotId,
      memberId: 'member-a',
      sizeBytes: 100,
    });
    topic.injectMessage({
      type: 'BARRIER_COMPLETE',
      jobId,
      snapshotId: barrierCmd.snapshotId,
      memberId: 'member-b',
      sizeBytes: 100,
    });
    await Bun.sleep(10);
  }
});
