import type { ITopic } from '../../topic/ITopic.js';
import type { JobCommand } from '../JobCommand.js';
import type { SnapshotMetrics } from '../metrics/BlitzJobMetrics.js';
import { Message } from '../../topic/Message.js';

export interface SnapshotCoordinatorConfig {
  readonly jobId: string;
  readonly snapshotIntervalMillis: number;
  readonly participatingMembers: string[];
  readonly snapshotTimeoutMillis: number;
  readonly maxRetries: number;
}

interface PendingSnapshot {
  readonly snapshotId: string;
  readonly startTime: number;
  readonly completedMembers: Map<string, number>; // memberId → sizeBytes
  readonly resolve: () => void;
  readonly reject: (err: Error) => void;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  retriesRemaining: number;
}

/**
 * SnapshotCoordinator — master-side periodic snapshot orchestrator.
 *
 * Drives Chandy-Lamport cycles by publishing INJECT_BARRIER commands
 * via ITopic and waiting for BARRIER_COMPLETE from all participating members.
 * Supports periodic timer-driven and on-demand (export) snapshots.
 * Snapshots are serialized — only one in-flight at a time, with queuing.
 */
export class SnapshotCoordinator {
  private readonly _jobId: string;
  private readonly _snapshotIntervalMillis: number;
  private readonly _snapshotTimeoutMillis: number;
  private readonly _maxRetries: number;
  private _participatingMembers: string[];
  private readonly _topic: ITopic<JobCommand>;
  private readonly _onSnapshotCommitted: (snapshotId: string) => Promise<void>;

  private _periodicTimer: ReturnType<typeof setInterval> | null = null;
  private _listenerRegistrationId: string | null = null;
  private _currentSnapshot: PendingSnapshot | null = null;
  private _snapshotQueue: Array<{ snapshotId?: string; resolve: () => void; reject: (err: Error) => void }> = [];
  private _snapshotCounter = 0;
  private _stopped = false;

  // Metrics
  private _snapshotCount = 0;
  private _lastSnapshotDurationMs = 0;
  private _lastSnapshotBytes = 0;
  private _lastSnapshotTimestamp = 0;

  constructor(
    config: SnapshotCoordinatorConfig,
    topic: ITopic<JobCommand>,
    onSnapshotCommitted: (snapshotId: string) => Promise<void>,
  ) {
    this._jobId = config.jobId;
    this._snapshotIntervalMillis = config.snapshotIntervalMillis;
    this._snapshotTimeoutMillis = config.snapshotTimeoutMillis;
    this._maxRetries = config.maxRetries;
    this._participatingMembers = [...config.participatingMembers];
    this._topic = topic;
    this._onSnapshotCommitted = onSnapshotCommitted;

    // Listen for BARRIER_COMPLETE responses
    this._listenerRegistrationId = this._topic.addMessageListener(
      (msg: Message<JobCommand>) => this._handleMessage(msg),
    );
  }

  /** Start the periodic snapshot timer. */
  start(): void {
    if (this._stopped) return;
    this._periodicTimer = setInterval(() => {
      if (this._stopped) return;
      this._enqueuePeriodicSnapshot();
    }, this._snapshotIntervalMillis);
  }

  /** Stop the coordinator: cancel timer, reject pending snapshots. */
  async stop(): Promise<void> {
    this._stopped = true;

    if (this._periodicTimer !== null) {
      clearInterval(this._periodicTimer);
      this._periodicTimer = null;
    }

    if (this._listenerRegistrationId !== null) {
      this._topic.removeMessageListener(this._listenerRegistrationId);
      this._listenerRegistrationId = null;
    }

    // Reject current snapshot
    if (this._currentSnapshot) {
      if (this._currentSnapshot.timeoutTimer) clearTimeout(this._currentSnapshot.timeoutTimer);
      this._currentSnapshot.reject(new Error('SnapshotCoordinator stopped'));
      this._currentSnapshot = null;
    }

    // Reject queued snapshots
    for (const queued of this._snapshotQueue) {
      queued.reject(new Error('SnapshotCoordinator stopped'));
    }
    this._snapshotQueue = [];
  }

  /**
   * Initiate an on-demand snapshot. If a snapshot is already in progress,
   * this one is queued and will execute after the current one completes.
   */
  initiateSnapshot(snapshotId?: string): Promise<void> {
    if (this._participatingMembers.length === 0) {
      return Promise.reject(new Error('No participating members for snapshot'));
    }

    return new Promise<void>((resolve, reject) => {
      if (this._currentSnapshot === null) {
        this._startSnapshot(snapshotId, resolve, reject);
      } else {
        this._snapshotQueue.push({ snapshotId, resolve, reject });
      }
    });
  }

  /** Notify coordinator that a member has been lost. Fails any in-flight snapshot waiting for that member. */
  onMemberLost(memberId: string): void {
    if (!this._currentSnapshot) return;

    const expected = this._participatingMembers;
    if (!expected.includes(memberId)) return;

    // Member was expected but lost — fail the snapshot immediately
    if (this._currentSnapshot.timeoutTimer) clearTimeout(this._currentSnapshot.timeoutTimer);
    this._currentSnapshot.reject(new Error(`Member '${memberId}' lost during snapshot '${this._currentSnapshot.snapshotId}'`));
    this._currentSnapshot = null;
    this._drainQueue();
  }

  /** Update the set of participating members for future snapshots. */
  updateParticipatingMembers(members: string[]): void {
    this._participatingMembers = [...members];
  }

  /** Return current snapshot metrics. */
  getSnapshotMetrics(): SnapshotMetrics {
    return {
      snapshotCount: this._snapshotCount,
      lastSnapshotDurationMs: this._lastSnapshotDurationMs,
      lastSnapshotBytes: this._lastSnapshotBytes,
      lastSnapshotTimestamp: this._lastSnapshotTimestamp,
    };
  }

  private _generateSnapshotId(): string {
    return `snap-${this._jobId}-${++this._snapshotCounter}-${Date.now()}`;
  }

  private _enqueuePeriodicSnapshot(): void {
    if (this._participatingMembers.length === 0) return;

    if (this._currentSnapshot === null) {
      this._startSnapshot(undefined, () => {}, () => {});
    }
    // If snapshot in progress, skip this periodic tick (don't queue periodic ones)
  }

  private _startSnapshot(
    explicitId: string | undefined,
    resolve: () => void,
    reject: (err: Error) => void,
  ): void {
    const snapshotId = explicitId ?? this._generateSnapshotId();

    const pending: PendingSnapshot = {
      snapshotId,
      startTime: Date.now(),
      completedMembers: new Map(),
      resolve,
      reject,
      timeoutTimer: null,
      retriesRemaining: this._maxRetries,
    };

    this._currentSnapshot = pending;
    this._injectBarrier(pending);
  }

  private _injectBarrier(pending: PendingSnapshot): void {
    // Publish INJECT_BARRIER to all members via topic
    const cmd: JobCommand = {
      type: 'INJECT_BARRIER',
      jobId: this._jobId,
      snapshotId: pending.snapshotId,
    };
    this._topic.publish(cmd);

    // Start timeout
    pending.timeoutTimer = setTimeout(() => {
      this._handleTimeout(pending);
    }, this._snapshotTimeoutMillis);
  }

  private _handleTimeout(pending: PendingSnapshot): void {
    if (this._currentSnapshot !== pending) return;

    if (pending.retriesRemaining > 0) {
      pending.retriesRemaining--;
      pending.completedMembers.clear();
      this._injectBarrier(pending);
    } else {
      this._currentSnapshot = null;
      pending.reject(new Error(
        `Snapshot '${pending.snapshotId}' timed out: missing responses from ${this._getMissingMembers(pending).join(', ')}`,
      ));
      this._drainQueue();
    }
  }

  private _getMissingMembers(pending: PendingSnapshot): string[] {
    return this._participatingMembers.filter(m => !pending.completedMembers.has(m));
  }

  private _handleMessage(msg: Message<JobCommand>): void {
    const cmd = msg.getMessageObject();
    if (cmd.type !== 'BARRIER_COMPLETE') return;
    if (cmd.jobId !== this._jobId) return;

    const pending = this._currentSnapshot;
    if (!pending) return;
    if (cmd.snapshotId !== pending.snapshotId) return;

    // Idempotent — ignore duplicate from same member
    if (pending.completedMembers.has(cmd.memberId)) return;

    pending.completedMembers.set(cmd.memberId, cmd.sizeBytes);

    // Check if all participating members have reported
    const allComplete = this._participatingMembers.every(m => pending.completedMembers.has(m));
    if (!allComplete) return;

    // Snapshot complete
    if (pending.timeoutTimer) clearTimeout(pending.timeoutTimer);

    const durationMs = Date.now() - pending.startTime;
    let totalBytes = 0;
    for (const bytes of pending.completedMembers.values()) {
      totalBytes += bytes;
    }

    // Update metrics
    this._snapshotCount++;
    this._lastSnapshotDurationMs = durationMs;
    this._lastSnapshotBytes = totalBytes;
    this._lastSnapshotTimestamp = Date.now();

    this._currentSnapshot = null;

    // Commit callback then resolve
    this._onSnapshotCommitted(pending.snapshotId).then(
      () => {
        pending.resolve();
        this._drainQueue();
      },
      (err) => {
        pending.reject(err);
        this._drainQueue();
      },
    );
  }

  private _drainQueue(): void {
    if (this._stopped) return;
    if (this._currentSnapshot !== null) return;
    if (this._snapshotQueue.length === 0) return;

    const next = this._snapshotQueue.shift()!;
    this._startSnapshot(next.snapshotId, next.resolve, next.reject);
  }
}
