import { describe, expect, it, beforeEach } from 'bun:test';
import { JobRecord } from '../../../src/job/JobRecord.js';
import { BlitzJob } from '../../../src/job/BlitzJob.js';
import { JobStatus } from '../../../src/job/JobStatus.js';
import { type ResolvedJobConfig, resolveJobConfig } from '../../../src/job/JobConfig.js';
import type { PipelineDescriptor } from '../../../src/job/PipelineDescriptor.js';
import type { JobStatusEvent } from '../../../src/job/BlitzJob.js';

// ── Helpers ──────────────────────────────────────────────────

function makeConfig(overrides?: Partial<ResolvedJobConfig>): ResolvedJobConfig {
  return {
    ...resolveJobConfig({ name: 'test-job' }, 'test-pipeline'),
    ...overrides,
  };
}

function makePipeline(): PipelineDescriptor {
  return {
    name: 'test-pipeline',
    vertices: [
      { name: 'src', type: 'source', fnSource: null, sourceConfig: { type: 'nats-subject', config: { subject: 'in' } }, sinkConfig: null },
      { name: 'sink', type: 'sink', fnSource: null, sourceConfig: null, sinkConfig: { type: 'log', config: {} } },
    ],
    edges: [{ from: 'src', to: 'sink', edgeType: 'LOCAL' as any, subject: '', keyFnSource: null }],
    parallelism: 1,
  };
}

/**
 * Minimal coordinator stub that records calls and allows controlling job state.
 * BlitzJob delegates cluster operations to this coordinator interface.
 */
interface MockCoordinator {
  status: JobStatus;
  cancelCalled: boolean;
  suspendCalled: boolean;
  resumeCalled: boolean;
  restartCalled: boolean;
  exportSnapshotCalled: boolean;
  metricsRequested: boolean;
  cancel(): Promise<void>;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  restart(): Promise<void>;
  exportSnapshot(name: string): Promise<void>;
  getMetrics(): Promise<import('../../../src/job/metrics/BlitzJobMetrics.js').VertexMetrics[]>;
  getStatus(): JobStatus;
}

function createMockCoordinator(initialStatus: JobStatus = JobStatus.RUNNING): MockCoordinator {
  const coordinator: MockCoordinator = {
    status: initialStatus,
    cancelCalled: false,
    suspendCalled: false,
    resumeCalled: false,
    restartCalled: false,
    exportSnapshotCalled: false,
    metricsRequested: false,
    async cancel() { coordinator.cancelCalled = true; coordinator.status = JobStatus.CANCELLED; },
    async suspend() { coordinator.suspendCalled = true; coordinator.status = JobStatus.SUSPENDED; },
    async resume() { coordinator.resumeCalled = true; coordinator.status = JobStatus.RUNNING; },
    async restart() { coordinator.restartCalled = true; coordinator.status = JobStatus.RESTARTING; },
    async exportSnapshot(_name: string) { coordinator.exportSnapshotCalled = true; },
    async getMetrics() { coordinator.metricsRequested = true; return []; },
    getStatus() { return coordinator.status; },
  };
  return coordinator;
}

// ── JobRecord Tests ──────────────────────────────────────────

describe('JobRecord', () => {
  it('should store all required fields', () => {
    const config = makeConfig();
    const pipeline = makePipeline();
    const now = Date.now();

    const record = new JobRecord({
      id: 'job-1',
      name: 'test-job',
      status: JobStatus.NOT_RUNNING,
      config,
      pipelineDescriptor: pipeline,
      submittedAt: now,
      participatingMembers: ['m1', 'm2'],
      lastSnapshotId: null,
      failureReason: null,
      lightJob: false,
    });

    expect(record.id).toBe('job-1');
    expect(record.name).toBe('test-job');
    expect(record.status).toBe(JobStatus.NOT_RUNNING);
    expect(record.config).toEqual(config);
    expect(record.pipelineDescriptor).toEqual(pipeline);
    expect(record.submittedAt).toBe(now);
    expect(record.participatingMembers).toEqual(['m1', 'm2']);
    expect(record.lastSnapshotId).toBeNull();
    expect(record.failureReason).toBeNull();
    expect(record.lightJob).toBe(false);
  });

  it('should support status updates via withStatus()', () => {
    const record = new JobRecord({
      id: 'job-2',
      name: 'test',
      status: JobStatus.NOT_RUNNING,
      config: makeConfig(),
      pipelineDescriptor: makePipeline(),
      submittedAt: Date.now(),
      participatingMembers: [],
      lastSnapshotId: null,
      failureReason: null,
      lightJob: false,
    });

    const updated = record.withStatus(JobStatus.RUNNING);
    expect(updated.status).toBe(JobStatus.RUNNING);
    expect(updated.id).toBe('job-2');
    // Original unchanged (immutable copy)
    expect(record.status).toBe(JobStatus.NOT_RUNNING);
  });

  it('should support failure reason updates', () => {
    const record = new JobRecord({
      id: 'job-3',
      name: 'fail-test',
      status: JobStatus.RUNNING,
      config: makeConfig(),
      pipelineDescriptor: makePipeline(),
      submittedAt: Date.now(),
      participatingMembers: ['m1'],
      lastSnapshotId: null,
      failureReason: null,
      lightJob: false,
    });

    const failed = record.withStatus(JobStatus.FAILED).withFailureReason('OOM');
    expect(failed.status).toBe(JobStatus.FAILED);
    expect(failed.failureReason).toBe('OOM');
  });

  it('should support snapshot id updates', () => {
    const record = new JobRecord({
      id: 'job-4',
      name: 'snap-test',
      status: JobStatus.RUNNING,
      config: makeConfig(),
      pipelineDescriptor: makePipeline(),
      submittedAt: Date.now(),
      participatingMembers: ['m1'],
      lastSnapshotId: null,
      failureReason: null,
      lightJob: false,
    });

    const updated = record.withLastSnapshotId('snap-42');
    expect(updated.lastSnapshotId).toBe('snap-42');
  });
});

// ── BlitzJob Tests ───────────────────────────────────────────

describe('BlitzJob', () => {
  let coordinator: MockCoordinator;
  let job: BlitzJob;

  beforeEach(() => {
    coordinator = createMockCoordinator(JobStatus.RUNNING);
    job = new BlitzJob('job-100', 'my-job', coordinator, Date.now());
  });

  it('getStatus returns current state from coordinator', () => {
    expect(job.getStatus()).toBe(JobStatus.RUNNING);
    coordinator.status = JobStatus.SUSPENDED;
    expect(job.getStatus()).toBe(JobStatus.SUSPENDED);
  });

  it('getSubmissionTime returns submission time', () => {
    const now = Date.now();
    const j = new BlitzJob('j1', 'j', coordinator, now);
    expect(j.getSubmissionTime()).toBe(now);
  });

  it('cancel delegates to coordinator', async () => {
    await job.cancel();
    expect(coordinator.cancelCalled).toBe(true);
  });

  it('suspend delegates to coordinator', async () => {
    await job.suspend();
    expect(coordinator.suspendCalled).toBe(true);
  });

  it('resume delegates to coordinator', async () => {
    await job.resume();
    expect(coordinator.resumeCalled).toBe(true);
  });

  it('restart delegates to coordinator', async () => {
    await job.restart();
    expect(coordinator.restartCalled).toBe(true);
  });

  it('exportSnapshot delegates to coordinator', async () => {
    await job.exportSnapshot('snap-1');
    expect(coordinator.exportSnapshotCalled).toBe(true);
  });

  it('getMetrics delegates to coordinator', async () => {
    const metrics = await job.getMetrics();
    expect(coordinator.metricsRequested).toBe(true);
    expect(metrics).toEqual([]);
  });

  // ── Status Listener Tests ──────────────────────────────────

  describe('status listeners', () => {
    it('status transitions fire listeners', () => {
      const events: JobStatusEvent[] = [];
      job.addStatusListener((event) => events.push(event));

      job.notifyStatusChange(JobStatus.RUNNING, JobStatus.SUSPENDED);

      expect(events).toHaveLength(1);
      expect(events[0].previousStatus).toBe(JobStatus.RUNNING);
      expect(events[0].newStatus).toBe(JobStatus.SUSPENDED);
      expect(events[0].jobId).toBe('job-100');
    });

    it('multiple listeners all receive events', () => {
      let count1 = 0;
      let count2 = 0;
      job.addStatusListener(() => { count1++; });
      job.addStatusListener(() => { count2++; });

      job.notifyStatusChange(JobStatus.RUNNING, JobStatus.COMPLETING);

      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });

    it('addStatusListener returns unsubscribe function', () => {
      const events: JobStatusEvent[] = [];
      const unsub = job.addStatusListener((event) => events.push(event));

      job.notifyStatusChange(JobStatus.NOT_RUNNING, JobStatus.STARTING);
      expect(events).toHaveLength(1);

      unsub();

      job.notifyStatusChange(JobStatus.STARTING, JobStatus.RUNNING);
      expect(events).toHaveLength(1); // no new event after unsubscribe
    });

    it('listeners auto-removed after terminal event', () => {
      const events: JobStatusEvent[] = [];
      job.addStatusListener((event) => events.push(event));

      job.notifyStatusChange(JobStatus.RUNNING, JobStatus.COMPLETED);
      expect(events).toHaveLength(1);

      // Firing again after terminal should not reach listener
      job.notifyStatusChange(JobStatus.COMPLETED, JobStatus.COMPLETED);
      expect(events).toHaveLength(1);
    });
  });

  // ── join() Tests ───────────────────────────────────────────

  describe('join()', () => {
    it('join resolves on completion', async () => {
      const promise = job.join();

      // Simulate terminal transition
      coordinator.status = JobStatus.COMPLETED;
      job.notifyStatusChange(JobStatus.RUNNING, JobStatus.COMPLETED);

      await expect(promise).resolves.toBeUndefined();
    });

    it('join resolves on failure', async () => {
      const promise = job.join();

      coordinator.status = JobStatus.FAILED;
      job.notifyStatusChange(JobStatus.RUNNING, JobStatus.FAILED);

      await expect(promise).resolves.toBeUndefined();
    });

    it('join resolves on cancel', async () => {
      const promise = job.join();

      coordinator.status = JobStatus.CANCELLED;
      job.notifyStatusChange(JobStatus.RUNNING, JobStatus.CANCELLED);

      await expect(promise).resolves.toBeUndefined();
    });

    it('join resolves immediately if already in terminal state', async () => {
      coordinator.status = JobStatus.COMPLETED;
      const terminalJob = new BlitzJob('j-done', 'done', coordinator, Date.now());

      await expect(terminalJob.join()).resolves.toBeUndefined();
    });
  });
});
