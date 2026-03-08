import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { SnapshotCoordinator, type SnapshotCoordinatorConfig } from '@zenystx/helios-core/job/snapshot/SnapshotCoordinator';
import type { JobCommand } from '@zenystx/helios-core/job/JobCommand';
import type { ITopic } from '@zenystx/helios-core/topic/ITopic';
import type { MessageListener } from '@zenystx/helios-core/topic/MessageListener';
import { LocalTopicStatsImpl } from '@zenystx/helios-core/topic/LocalTopicStats';
import { Message } from '@zenystx/helios-core/topic/Message';

// ─── Mock ITopic ────────────────────────────────────────────────────────────

class MockTopic implements ITopic<JobCommand> {
  readonly published: JobCommand[] = [];
  private readonly _listeners = new Map<string, MessageListener<JobCommand>>();
  private _nextId = 0;
  private readonly _stats = new LocalTopicStatsImpl();

  getName(): string {
    return 'test-command-topic';
  }

  publish(message: JobCommand): void {
    this.published.push(message);
    this._stats.incrementPublish();
    for (const listener of this._listeners.values()) {
      listener(new Message('test-command-topic', message, Date.now(), 'master-1'));
      this._stats.incrementReceive();
    }
  }

  publishAsync(message: JobCommand): Promise<void> {
    this.publish(message);
    return Promise.resolve();
  }

  publishAll(messages: Iterable<JobCommand | null>): void {
    for (const m of messages) {
      if (m !== null) this.publish(m);
    }
  }

  publishAllAsync(messages: Iterable<JobCommand | null>): Promise<void> {
    this.publishAll(messages);
    return Promise.resolve();
  }

  addMessageListener(listener: MessageListener<JobCommand>): string {
    const id = `listener-${this._nextId++}`;
    this._listeners.set(id, listener);
    return id;
  }

  removeMessageListener(registrationId: string): boolean {
    return this._listeners.delete(registrationId);
  }

  getLocalTopicStats(): LocalTopicStatsImpl {
    return this._stats;
  }

  destroy(): void {
    this._listeners.clear();
  }

  /** Simulate a member sending BARRIER_COMPLETE */
  simulateBarrierComplete(jobId: string, snapshotId: string, memberId: string, sizeBytes = 1024): void {
    const cmd: JobCommand = { type: 'BARRIER_COMPLETE', jobId, snapshotId, memberId, sizeBytes };
    for (const listener of this._listeners.values()) {
      listener(new Message('test-command-topic', cmd, Date.now(), memberId));
    }
  }
}

// ─── Mock JobRecord updater ─────────────────────────────────────────────────

function createRecordUpdater(): { lastSnapshotIds: string[]; updater: (snapshotId: string) => Promise<void> } {
  const lastSnapshotIds: string[] = [];
  return {
    lastSnapshotIds,
    updater: async (snapshotId: string) => { lastSnapshotIds.push(snapshotId); },
  };
}

// ─── Test Helpers ───────────────────────────────────────────────────────────

function defaultConfig(overrides?: Partial<SnapshotCoordinatorConfig>): SnapshotCoordinatorConfig {
  return {
    jobId: 'job-1',
    snapshotIntervalMillis: 100,
    participatingMembers: ['member-1', 'member-2'],
    snapshotTimeoutMillis: 2000,
    maxRetries: 2,
    ...overrides,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('SnapshotCoordinator — periodic snapshot orchestration', () => {
  let topic: MockTopic;
  let coordinator: SnapshotCoordinator;

  beforeEach(() => {
    topic = new MockTopic();
  });

  afterEach(async () => {
    if (coordinator) {
      await coordinator.stop();
    }
  });

  it('periodic timer fires and injects barriers', async () => {
    const { updater } = createRecordUpdater();
    coordinator = new SnapshotCoordinator(defaultConfig({ snapshotIntervalMillis: 50 }), topic, updater);
    coordinator.start();

    // Wait for at least one timer fire
    await sleep(120);

    const barriers = topic.published.filter(c => c.type === 'INJECT_BARRIER');
    expect(barriers.length).toBeGreaterThanOrEqual(1);
    expect(barriers[0].type).toBe('INJECT_BARRIER');
    if (barriers[0].type === 'INJECT_BARRIER') {
      expect(barriers[0].jobId).toBe('job-1');
      expect(barriers[0].snapshotId).toBeTruthy();
    }
  });

  it('barrier injection reaches all members via topic publish', async () => {
    const { updater } = createRecordUpdater();
    coordinator = new SnapshotCoordinator(defaultConfig(), topic, updater);

    const snapshotPromise = coordinator.initiateSnapshot();

    const barriers = topic.published.filter(c => c.type === 'INJECT_BARRIER');
    expect(barriers.length).toBe(1);

    if (barriers[0].type === 'INJECT_BARRIER') {
      topic.simulateBarrierComplete('job-1', barriers[0].snapshotId, 'member-1', 512);
      topic.simulateBarrierComplete('job-1', barriers[0].snapshotId, 'member-2', 768);
    }

    await snapshotPromise;
  });

  it('snapshot completes when all members report BARRIER_COMPLETE', async () => {
    const { lastSnapshotIds, updater } = createRecordUpdater();
    coordinator = new SnapshotCoordinator(defaultConfig(), topic, updater);

    const snapshotPromise = coordinator.initiateSnapshot();

    const barriers = topic.published.filter(c => c.type === 'INJECT_BARRIER');
    const snapshotId = (barriers[0] as { type: 'INJECT_BARRIER'; snapshotId: string }).snapshotId;

    // Only member-1 reports — snapshot should not be complete yet
    topic.simulateBarrierComplete('job-1', snapshotId, 'member-1', 512);

    await sleep(10);
    expect(lastSnapshotIds.length).toBe(0);

    // member-2 reports — snapshot should complete
    topic.simulateBarrierComplete('job-1', snapshotId, 'member-2', 768);
    await snapshotPromise;

    expect(lastSnapshotIds.length).toBe(1);
    expect(lastSnapshotIds[0]).toBe(snapshotId);
  });

  it('partial member failure handled with timeout', async () => {
    const { updater } = createRecordUpdater();
    coordinator = new SnapshotCoordinator(
      defaultConfig({ snapshotTimeoutMillis: 100, maxRetries: 1 }),
      topic,
      updater,
    );

    const snapshotPromise = coordinator.initiateSnapshot();

    const barriers = topic.published.filter(c => c.type === 'INJECT_BARRIER');
    const snapshotId = (barriers[0] as { type: 'INJECT_BARRIER'; snapshotId: string }).snapshotId;

    // Only member-1 reports — member-2 never responds
    topic.simulateBarrierComplete('job-1', snapshotId, 'member-1', 512);

    await expect(snapshotPromise).rejects.toThrow();
  });

  it('on-demand snapshot works via initiateSnapshot()', async () => {
    const { lastSnapshotIds, updater } = createRecordUpdater();
    coordinator = new SnapshotCoordinator(defaultConfig(), topic, updater);

    const p = coordinator.initiateSnapshot('export-snap-1');

    const barriers = topic.published.filter(c => c.type === 'INJECT_BARRIER');
    expect(barriers.length).toBe(1);
    const snapshotId = (barriers[0] as { type: 'INJECT_BARRIER'; snapshotId: string }).snapshotId;
    expect(snapshotId).toBe('export-snap-1');

    topic.simulateBarrierComplete('job-1', snapshotId, 'member-1', 256);
    topic.simulateBarrierComplete('job-1', snapshotId, 'member-2', 256);

    await p;
    expect(lastSnapshotIds[0]).toBe('export-snap-1');
  });

  it('metrics are tracked: count, duration, size', async () => {
    const { updater } = createRecordUpdater();
    coordinator = new SnapshotCoordinator(defaultConfig(), topic, updater);

    const p = coordinator.initiateSnapshot();

    const barriers = topic.published.filter(c => c.type === 'INJECT_BARRIER');
    const snapshotId = (barriers[0] as { type: 'INJECT_BARRIER'; snapshotId: string }).snapshotId;

    topic.simulateBarrierComplete('job-1', snapshotId, 'member-1', 512);
    topic.simulateBarrierComplete('job-1', snapshotId, 'member-2', 768);
    await p;

    const metrics = coordinator.getSnapshotMetrics();
    expect(metrics.snapshotCount).toBe(1);
    expect(metrics.lastSnapshotDurationMs).toBeGreaterThanOrEqual(0);
    expect(metrics.lastSnapshotBytes).toBe(1280); // 512 + 768
    expect(metrics.lastSnapshotTimestamp).toBeGreaterThan(0);
  });

  it('generates unique snapshot IDs for each cycle', async () => {
    const { updater } = createRecordUpdater();
    coordinator = new SnapshotCoordinator(defaultConfig(), topic, updater);

    const p1 = coordinator.initiateSnapshot();
    const barriers1 = topic.published.filter(c => c.type === 'INJECT_BARRIER');
    const sid1 = (barriers1[0] as { type: 'INJECT_BARRIER'; snapshotId: string }).snapshotId;
    topic.simulateBarrierComplete('job-1', sid1, 'member-1');
    topic.simulateBarrierComplete('job-1', sid1, 'member-2');
    await p1;

    const p2 = coordinator.initiateSnapshot();
    const barriers2 = topic.published.filter(c => c.type === 'INJECT_BARRIER');
    const sid2 = (barriers2[barriers2.length - 1] as { type: 'INJECT_BARRIER'; snapshotId: string }).snapshotId;
    topic.simulateBarrierComplete('job-1', sid2, 'member-1');
    topic.simulateBarrierComplete('job-1', sid2, 'member-2');
    await p2;

    expect(sid1).not.toBe(sid2);
  });

  it('concurrent snapshots are serialized (no overlapping)', async () => {
    const { lastSnapshotIds, updater } = createRecordUpdater();
    coordinator = new SnapshotCoordinator(defaultConfig(), topic, updater);

    const p1 = coordinator.initiateSnapshot();
    const p2 = coordinator.initiateSnapshot();

    // Only one INJECT_BARRIER should be published so far
    const barriers = topic.published.filter(c => c.type === 'INJECT_BARRIER');
    expect(barriers.length).toBe(1);

    const sid1 = (barriers[0] as { type: 'INJECT_BARRIER'; snapshotId: string }).snapshotId;
    topic.simulateBarrierComplete('job-1', sid1, 'member-1');
    topic.simulateBarrierComplete('job-1', sid1, 'member-2');
    await p1;

    // Second should now be in-flight
    await sleep(10);
    const barriers2 = topic.published.filter(c => c.type === 'INJECT_BARRIER');
    expect(barriers2.length).toBe(2);
    const sid2 = (barriers2[1] as { type: 'INJECT_BARRIER'; snapshotId: string }).snapshotId;
    topic.simulateBarrierComplete('job-1', sid2, 'member-1');
    topic.simulateBarrierComplete('job-1', sid2, 'member-2');
    await p2;

    expect(lastSnapshotIds.length).toBe(2);
  });

  it('stop() cancels periodic timer and pending snapshots', async () => {
    const { updater } = createRecordUpdater();
    coordinator = new SnapshotCoordinator(defaultConfig({ snapshotIntervalMillis: 50 }), topic, updater);
    coordinator.start();

    await sleep(30);
    await coordinator.stop();

    const countBefore = topic.published.length;
    await sleep(100);
    const countAfter = topic.published.length;

    expect(countAfter).toBe(countBefore);
  });

  it('member-loss during snapshot triggers failure', async () => {
    const { updater } = createRecordUpdater();
    coordinator = new SnapshotCoordinator(
      defaultConfig({ snapshotTimeoutMillis: 100 }),
      topic,
      updater,
    );

    const p = coordinator.initiateSnapshot();
    const barriers = topic.published.filter(c => c.type === 'INJECT_BARRIER');
    const snapshotId = (barriers[0] as { type: 'INJECT_BARRIER'; snapshotId: string }).snapshotId;

    topic.simulateBarrierComplete('job-1', snapshotId, 'member-1', 512);
    coordinator.onMemberLost('member-2');

    await expect(p).rejects.toThrow();
  });

  it('ignores BARRIER_COMPLETE for wrong snapshotId', async () => {
    const { lastSnapshotIds, updater } = createRecordUpdater();
    coordinator = new SnapshotCoordinator(defaultConfig(), topic, updater);

    const p = coordinator.initiateSnapshot();
    const barriers = topic.published.filter(c => c.type === 'INJECT_BARRIER');
    const snapshotId = (barriers[0] as { type: 'INJECT_BARRIER'; snapshotId: string }).snapshotId;

    topic.simulateBarrierComplete('job-1', 'wrong-id', 'member-1');
    topic.simulateBarrierComplete('job-1', 'wrong-id', 'member-2');

    await sleep(50);
    expect(lastSnapshotIds.length).toBe(0);

    topic.simulateBarrierComplete('job-1', snapshotId, 'member-1');
    topic.simulateBarrierComplete('job-1', snapshotId, 'member-2');
    await p;

    expect(lastSnapshotIds.length).toBe(1);
  });

  it('ignores BARRIER_COMPLETE for wrong jobId', async () => {
    const { lastSnapshotIds, updater } = createRecordUpdater();
    coordinator = new SnapshotCoordinator(defaultConfig(), topic, updater);

    const p = coordinator.initiateSnapshot();
    const barriers = topic.published.filter(c => c.type === 'INJECT_BARRIER');
    const snapshotId = (barriers[0] as { type: 'INJECT_BARRIER'; snapshotId: string }).snapshotId;

    topic.simulateBarrierComplete('wrong-job', snapshotId, 'member-1');
    topic.simulateBarrierComplete('wrong-job', snapshotId, 'member-2');

    await sleep(50);
    expect(lastSnapshotIds.length).toBe(0);

    topic.simulateBarrierComplete('job-1', snapshotId, 'member-1');
    topic.simulateBarrierComplete('job-1', snapshotId, 'member-2');
    await p;
  });

  it('duplicate BARRIER_COMPLETE from same member is idempotent', async () => {
    const { lastSnapshotIds, updater } = createRecordUpdater();
    coordinator = new SnapshotCoordinator(defaultConfig(), topic, updater);

    const p = coordinator.initiateSnapshot();
    const barriers = topic.published.filter(c => c.type === 'INJECT_BARRIER');
    const snapshotId = (barriers[0] as { type: 'INJECT_BARRIER'; snapshotId: string }).snapshotId;

    topic.simulateBarrierComplete('job-1', snapshotId, 'member-1', 512);
    topic.simulateBarrierComplete('job-1', snapshotId, 'member-1', 512); // duplicate
    topic.simulateBarrierComplete('job-1', snapshotId, 'member-2', 768);
    await p;

    expect(lastSnapshotIds.length).toBe(1);
    expect(coordinator.getSnapshotMetrics().lastSnapshotBytes).toBe(1280);
  });

  it('metrics count increments across multiple snapshots', async () => {
    const { updater } = createRecordUpdater();
    coordinator = new SnapshotCoordinator(defaultConfig(), topic, updater);

    for (let i = 0; i < 3; i++) {
      const p = coordinator.initiateSnapshot();
      const barriers = topic.published.filter(c => c.type === 'INJECT_BARRIER');
      const sid = (barriers[barriers.length - 1] as { type: 'INJECT_BARRIER'; snapshotId: string }).snapshotId;
      topic.simulateBarrierComplete('job-1', sid, 'member-1', 100);
      topic.simulateBarrierComplete('job-1', sid, 'member-2', 100);
      await p;
    }

    expect(coordinator.getSnapshotMetrics().snapshotCount).toBe(3);
  });

  it('updateParticipatingMembers changes expected completions', async () => {
    const { lastSnapshotIds, updater } = createRecordUpdater();
    coordinator = new SnapshotCoordinator(defaultConfig(), topic, updater);

    coordinator.updateParticipatingMembers(['member-1']);

    const p = coordinator.initiateSnapshot();
    const barriers = topic.published.filter(c => c.type === 'INJECT_BARRIER');
    const snapshotId = (barriers[0] as { type: 'INJECT_BARRIER'; snapshotId: string }).snapshotId;

    topic.simulateBarrierComplete('job-1', snapshotId, 'member-1', 512);
    await p;

    expect(lastSnapshotIds.length).toBe(1);
  });

  it('snapshot not initiated when no participating members', async () => {
    const { updater } = createRecordUpdater();
    coordinator = new SnapshotCoordinator(
      defaultConfig({ participatingMembers: [] }),
      topic,
      updater,
    );

    await expect(coordinator.initiateSnapshot()).rejects.toThrow();
    expect(topic.published.filter(c => c.type === 'INJECT_BARRIER').length).toBe(0);
  });

  it('retry on timeout before final failure', async () => {
    const { updater } = createRecordUpdater();
    coordinator = new SnapshotCoordinator(
      defaultConfig({ snapshotTimeoutMillis: 50, maxRetries: 2 }),
      topic,
      updater,
    );

    const p = coordinator.initiateSnapshot();

    await expect(p).rejects.toThrow();

    const barriers = topic.published.filter(c => c.type === 'INJECT_BARRIER');
    expect(barriers.length).toBeGreaterThanOrEqual(2);
  });
});
