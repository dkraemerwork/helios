import type { IMap } from '../map/IMap.js';
import type { ITopic } from '../topic/ITopic.js';
import type { JobCommand } from './JobCommand.js';
import type { PipelineDescriptor } from './PipelineDescriptor.js';
import type { ResolvedJobConfig } from './JobConfig.js';
import type { BlitzJobExecutor } from './BlitzJobExecutor.js';
import type { Message } from '../topic/Message.js';
import { ProcessingGuarantee } from './JobConfig.js';
import { JobRecord } from './JobRecord.js';
import { JobStatus } from './JobStatus.js';
import { BlitzJob, type JobCoordinator } from './BlitzJob.js';
import { computeExecutionPlan } from './ExecutionPlan.js';
import { SnapshotCoordinator } from './snapshot/SnapshotCoordinator.js';

export interface AuthorityTuple {
  masterMemberId: string;
  memberListVersion: number;
  fenceToken: string;
}

interface PendingReadyWait {
  jobId: string;
  expectedMembers: Set<string>;
  readyMembers: Set<string>;
  resolve: () => void;
  reject: (err: Error) => void;
}

/**
 * BlitzJobCoordinator — master-side coordinator managing the full Jet-parity job lifecycle.
 *
 * Runs on the master with Helios fencing pattern (masterMemberId, memberListVersion, fenceToken).
 * Manages job submission, cancel, suspend, resume, restart, member loss/join, and split-brain.
 */
export class BlitzJobCoordinator {
  private _authority: AuthorityTuple | null;
  private _memberIds: string[];
  private readonly _totalMemberCount: number;
  private readonly _imap: IMap<string, JobRecord>;
  private readonly _topic: ITopic<JobCommand>;
  private readonly _executor: BlitzJobExecutor;
  private readonly _snapshotCoordinators = new Map<string, SnapshotCoordinator>();
  private readonly _jobs = new Map<string, BlitzJob>();
  private readonly _jobStatuses = new Map<string, JobStatus>();
  private readonly _pendingReady = new Map<string, PendingReadyWait>();
  private readonly _scaleUpTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly _topicListenerId: string | null = null;

  // Light jobs — local-only, no IMap
  private readonly _lightJobs = new Map<string, BlitzJob>();
  private readonly _lightJobStatuses = new Map<string, JobStatus>();

  constructor(
    imap: IMap<string, JobRecord>,
    topic: ITopic<JobCommand>,
    executor: BlitzJobExecutor,
    memberIds: string[],
    authority: AuthorityTuple,
    totalMemberCount?: number,
  ) {
    this._imap = imap;
    this._topic = topic;
    this._executor = executor;
    this._memberIds = [...memberIds];
    this._authority = authority;
    this._totalMemberCount = totalMemberCount ?? memberIds.length;

    this._topicListenerId = this._topic.addMessageListener(
      (msg: Message<JobCommand>) => this._handleMessage(msg),
    );
  }

  // ── Submit ──────────────────────────────────────────────

  async submitJob(pipeline: PipelineDescriptor, config: ResolvedJobConfig): Promise<BlitzJob> {
    this._assertAuthority();

    // Split-brain check
    if (config.splitBrainProtection) {
      const quorum = Math.ceil(this._totalMemberCount / 2);
      if (this._memberIds.length < quorum) {
        throw new Error(`Split-brain protection: need ${quorum} members, only ${this._memberIds.length} alive`);
      }
    }

    const jobId = crypto.randomUUID();
    const record = new JobRecord({
      id: jobId,
      name: config.name,
      status: JobStatus.NOT_RUNNING,
      config,
      pipelineDescriptor: pipeline,
      submittedAt: Date.now(),
      participatingMembers: [...this._memberIds],
      lastSnapshotId: null,
      failureReason: null,
      lightJob: false,
    });

    // Store in IMap
    await this._imap.set(jobId, record);

    // Transition to STARTING
    await this._updateStatus(jobId, record, JobStatus.STARTING);

    // Compute execution plan
    const plan = computeExecutionPlan(jobId, pipeline, this._memberIds, this._authority!);

    // Send START_EXECUTION to all members
    this._topic.publish({ type: 'START_EXECUTION', jobId, plan });

    // Wait for EXECUTION_READY from all members
    await this._waitForReady(jobId, new Set(this._memberIds));

    // Transition to RUNNING
    const runningRecord = (await this._imap.get(jobId))!;
    await this._updateStatus(jobId, runningRecord, JobStatus.RUNNING);

    // Start SnapshotCoordinator if guarantee != NONE
    if (config.processingGuarantee !== ProcessingGuarantee.NONE) {
      this._startSnapshotCoordinator(jobId, config);
    }

    // Create BlitzJob handle
    const coordinator = this._createJobCoordinator(jobId);
    const job = new BlitzJob(jobId, config.name, coordinator, record.submittedAt);
    this._jobs.set(jobId, job);

    return job;
  }

  // ── Cancel ──────────────────────────────────────────────

  async cancelJob(jobId: string): Promise<void> {
    this._assertAuthority();

    const record = await this._imap.get(jobId);
    if (!record) throw new Error(`Job '${jobId}' not found`);

    // Stop snapshot coordinator
    await this._stopSnapshotCoordinator(jobId);

    // Send stop to all members
    this._topic.publish({ type: 'STOP_EXECUTION', jobId, reason: 'cancel' });

    // Transition to CANCELLED
    await this._updateStatus(jobId, record, JobStatus.CANCELLED);

    // Notify job handle
    this._notifyJob(jobId, record.status, JobStatus.CANCELLED);
  }

  // ── Suspend ─────────────────────────────────────────────

  async suspendJob(jobId: string): Promise<void> {
    this._assertAuthority();

    const record = await this._imap.get(jobId);
    if (!record) throw new Error(`Job '${jobId}' not found`);

    // Transition to SUSPENDED_EXPORTING_SNAPSHOT
    await this._updateStatus(jobId, record, JobStatus.SUSPENDED_EXPORTING_SNAPSHOT);

    // Final snapshot if snapshots are enabled
    const sc = this._snapshotCoordinators.get(jobId);
    if (sc) {
      try {
        await sc.initiateSnapshot();
      } catch {
        // Snapshot failure during suspend is non-fatal
      }
    }

    // Stop snapshot coordinator
    await this._stopSnapshotCoordinator(jobId);

    // Send stop to all members
    this._topic.publish({ type: 'STOP_EXECUTION', jobId, reason: 'suspend' });

    // Transition to SUSPENDED
    const updated = (await this._imap.get(jobId))!;
    await this._updateStatus(jobId, updated, JobStatus.SUSPENDED);

    // Notify job handle
    this._notifyJob(jobId, JobStatus.SUSPENDED_EXPORTING_SNAPSHOT, JobStatus.SUSPENDED);
  }

  // ── Resume ──────────────────────────────────────────────

  async resumeJob(jobId: string): Promise<void> {
    this._assertAuthority();

    const record = await this._imap.get(jobId);
    if (!record) throw new Error(`Job '${jobId}' not found`);
    if (record.status !== JobStatus.SUSPENDED) {
      throw new Error(`Cannot resume job '${jobId}' in status '${record.status}'`);
    }

    await this._startJobExecution(jobId, record);
  }

  // ── Restart ─────────────────────────────────────────────

  async restartJob(jobId: string): Promise<void> {
    this._assertAuthority();

    const record = await this._imap.get(jobId);
    if (!record) throw new Error(`Job '${jobId}' not found`);

    // Stop existing execution
    await this._stopSnapshotCoordinator(jobId);
    this._topic.publish({ type: 'STOP_EXECUTION', jobId, reason: 'restart' });

    // Transition to RESTARTING
    await this._updateStatus(jobId, record, JobStatus.RESTARTING);

    await this._startJobExecution(jobId, (await this._imap.get(jobId))!);
  }

  // ── Member Events ───────────────────────────────────────

  async onMemberLost(memberId: string): Promise<void> {
    this._memberIds = this._memberIds.filter(m => m !== memberId);

    // For each running job where the lost member was participating
    const records = await this._getAllJobRecords();
    for (const record of records) {
      if (record.status !== JobStatus.RUNNING) continue;
      if (!record.participatingMembers.includes(memberId)) continue;

      if (record.config.autoScaling) {
        // RESTARTING + restart with remaining members
        await this._updateStatus(record.id, record, JobStatus.RESTARTING);
        await this._stopSnapshotCoordinator(record.id);
        this._topic.publish({ type: 'STOP_EXECUTION', jobId: record.id, reason: 'restart' });

        const updated = (await this._imap.get(record.id))!
          .withParticipatingMembers(this._memberIds);
        await this._imap.set(record.id, updated);

        await this._startJobExecution(record.id, updated);
      } else if (record.config.suspendOnFailure) {
        await this._stopSnapshotCoordinator(record.id);
        this._topic.publish({ type: 'STOP_EXECUTION', jobId: record.id, reason: 'suspend' });
        await this._updateStatus(record.id, record, JobStatus.SUSPENDED);
        this._notifyJob(record.id, JobStatus.RUNNING, JobStatus.SUSPENDED);
      } else {
        await this._stopSnapshotCoordinator(record.id);
        this._topic.publish({ type: 'STOP_EXECUTION', jobId: record.id, reason: 'cancel' });
        await this._updateStatus(record.id, record, JobStatus.FAILED);
        const failed = (await this._imap.get(record.id))!.withFailureReason(`Member '${memberId}' lost`);
        await this._imap.set(record.id, failed);
        this._notifyJob(record.id, JobStatus.RUNNING, JobStatus.FAILED);
      }
    }
  }

  onMemberJoined(memberId: string): void {
    if (!this._memberIds.includes(memberId)) {
      this._memberIds.push(memberId);
    }

    // For each running job with autoScaling, debounce restart
    this._scheduleScaleUp(memberId);
  }

  // ── Job Lookups ─────────────────────────────────────────

  async getJob(jobId: string): Promise<BlitzJob | null> {
    const record = await this._imap.get(jobId);
    if (!record) return null;

    // Return cached handle if available
    if (this._jobs.has(jobId)) return this._jobs.get(jobId)!;

    // Create handle from record
    const coordinator = this._createJobCoordinator(jobId);
    const job = new BlitzJob(jobId, record.name, coordinator, record.submittedAt);
    this._jobs.set(jobId, job);
    return job;
  }

  async getJobByName(name: string): Promise<BlitzJob | null> {
    const records = await this._getAllJobRecords();
    const record = records.find(r => r.name === name);
    if (!record) return null;
    return this.getJob(record.id);
  }

  async getJobs(): Promise<BlitzJob[]> {
    const records = await this._getAllJobRecords();
    const jobs: BlitzJob[] = [];
    for (const record of records) {
      const job = await this.getJob(record.id);
      if (job) jobs.push(job);
    }
    return jobs;
  }

  // ── Demotion / Promotion ────────────────────────────────

  onDemotion(): void {
    this._authority = null;

    // Stop all snapshot coordinators
    for (const [, sc] of this._snapshotCoordinators) {
      sc.stop();
    }
    this._snapshotCoordinators.clear();

    // Clear scale-up timers
    for (const timer of this._scaleUpTimers.values()) {
      clearTimeout(timer);
    }
    this._scaleUpTimers.clear();

    // Clear pending ready waits
    for (const pending of this._pendingReady.values()) {
      pending.reject(new Error('Demoted'));
    }
    this._pendingReady.clear();
  }

  async onPromotion(authority: AuthorityTuple, aliveMembers: string[]): Promise<void> {
    this._authority = authority;
    this._memberIds = [...aliveMembers];

    // Read all job records from IMap
    const records = await this._getAllJobRecords();

    for (const record of records) {
      if (record.status === JobStatus.RUNNING) {
        // Check if all participating members are still alive
        const deadMembers = record.participatingMembers.filter(m => !aliveMembers.includes(m));

        if (deadMembers.length === 0) {
          // All alive — resume snapshot coordinator
          if (record.config.processingGuarantee !== ProcessingGuarantee.NONE) {
            this._startSnapshotCoordinator(record.id, record.config);
          }

          // Cache job handle
          const coordinator = this._createJobCoordinator(record.id);
          const job = new BlitzJob(record.id, record.name, coordinator, record.submittedAt);
          this._jobs.set(record.id, job);
        } else {
          // Some members lost — treat as member loss
          const updated = record.withParticipatingMembers(
            record.participatingMembers.filter(m => aliveMembers.includes(m)),
          );
          await this._imap.set(record.id, updated);

          if (record.config.autoScaling) {
            await this._updateStatus(record.id, record, JobStatus.RESTARTING);
            this._topic.publish({ type: 'STOP_EXECUTION', jobId: record.id, reason: 'restart' });
            await this._startJobExecution(record.id, (await this._imap.get(record.id))!);
          }
        }
      } else if (record.status === JobStatus.STARTING || record.status === JobStatus.RESTARTING) {
        // Restart from NOT_RUNNING
        await this._updateStatus(record.id, record, JobStatus.NOT_RUNNING);
        const updated = (await this._imap.get(record.id))!;
        await this._startJobExecution(record.id, updated);
      }
      // SUSPENDED jobs — no action, wait for user resume
    }
  }

  // ── Light Job ───────────────────────────────────────────

  async submitLightJob(pipeline: PipelineDescriptor, config: ResolvedJobConfig): Promise<BlitzJob> {
    const jobId = crypto.randomUUID();
    const status = JobStatus.RUNNING;

    this._lightJobStatuses.set(jobId, status);

    // Start execution locally on this member only
    const plan = computeExecutionPlan(jobId, pipeline, [this._executor.memberId], {
      fenceToken: 'light',
      masterMemberId: this._executor.memberId,
      memberListVersion: 0,
    });

    await this._executor.startExecution(plan, {
      sources: new Map(),
      sinks: new Map(),
      operatorFns: new Map(),
      guarantee: config.processingGuarantee,
      maxProcessorAccumulatedRecords: config.maxProcessorAccumulatedRecords,
    });

    const coordinator: JobCoordinator = {
      getStatus: () => this._lightJobStatuses.get(jobId) ?? JobStatus.CANCELLED,
      cancel: async () => {
        await this._executor.stopExecution(jobId, 'cancel');
        this._lightJobStatuses.set(jobId, JobStatus.CANCELLED);
        lightJob.notifyStatusChange(JobStatus.RUNNING, JobStatus.CANCELLED);
      },
      suspend: async () => { throw new Error('Light jobs cannot be suspended'); },
      resume: async () => { throw new Error('Light jobs cannot be resumed'); },
      restart: async () => { throw new Error('Light jobs cannot be restarted'); },
      exportSnapshot: async () => { throw new Error('Light jobs do not support snapshots'); },
      getMetrics: async () => this._executor.getLocalMetrics(jobId) ?? [],
    };

    const lightJob = new BlitzJob(jobId, config.name, coordinator, Date.now());
    this._lightJobs.set(jobId, lightJob);

    return lightJob;
  }

  // ── Private ─────────────────────────────────────────────

  private _assertAuthority(): void {
    if (!this._authority) {
      throw new Error('Not the master — no authority to perform this operation');
    }
  }

  private async _updateStatus(jobId: string, record: JobRecord, newStatus: JobStatus): Promise<void> {
    const updated = record.withStatus(newStatus);
    await this._imap.set(jobId, updated);
    this._jobStatuses.set(jobId, newStatus);
  }

  private async _startJobExecution(jobId: string, record: JobRecord): Promise<void> {
    // Transition to NOT_RUNNING then STARTING
    if (record.status !== JobStatus.NOT_RUNNING && record.status !== JobStatus.STARTING) {
      await this._updateStatus(jobId, record, JobStatus.NOT_RUNNING);
      record = (await this._imap.get(jobId))!;
    }
    await this._updateStatus(jobId, record, JobStatus.STARTING);

    // Update participating members to current alive set
    const updated = (await this._imap.get(jobId))!.withParticipatingMembers([...this._memberIds]);
    await this._imap.set(jobId, updated);

    // Compute new execution plan
    const plan = computeExecutionPlan(jobId, updated.pipelineDescriptor, this._memberIds, this._authority!);

    // Send START_EXECUTION
    this._topic.publish({ type: 'START_EXECUTION', jobId, plan });

    // Wait for ready
    await this._waitForReady(jobId, new Set(this._memberIds));

    // Transition to RUNNING
    const finalRecord = (await this._imap.get(jobId))!;
    await this._updateStatus(jobId, finalRecord, JobStatus.RUNNING);

    // Start snapshot coordinator if needed
    if (updated.config.processingGuarantee !== ProcessingGuarantee.NONE) {
      this._startSnapshotCoordinator(jobId, updated.config);
    }
  }

  private _waitForReady(jobId: string, expectedMembers: Set<string>): Promise<void> {
    if (expectedMembers.size === 0) return Promise.resolve();

    // Check if any readies already arrived
    const existing = this._pendingReady.get(jobId);
    if (existing) {
      // Clear stale pending
      existing.reject(new Error('Superseded'));
    }

    return new Promise<void>((resolve, reject) => {
      this._pendingReady.set(jobId, {
        jobId,
        expectedMembers,
        readyMembers: new Set(),
        resolve,
        reject,
      });
    });
  }

  private _handleMessage(msg: Message<JobCommand>): void {
    const cmd = msg.getMessageObject();

    if (cmd.type === 'EXECUTION_READY') {
      const pending = this._pendingReady.get(cmd.jobId);
      if (!pending) return;

      pending.readyMembers.add(cmd.memberId);

      const allReady = [...pending.expectedMembers].every(m => pending.readyMembers.has(m));
      if (allReady) {
        this._pendingReady.delete(cmd.jobId);
        pending.resolve();
      }
    }
  }

  private _startSnapshotCoordinator(jobId: string, config: ResolvedJobConfig): void {
    if (this._snapshotCoordinators.has(jobId)) return;

    const sc = new SnapshotCoordinator(
      {
        jobId,
        snapshotIntervalMillis: config.snapshotIntervalMillis,
        participatingMembers: [...this._memberIds],
        snapshotTimeoutMillis: config.snapshotIntervalMillis * 2,
        maxRetries: 2,
      },
      this._topic,
      async (snapshotId: string) => {
        const record = await this._imap.get(jobId);
        if (record) {
          await this._imap.set(jobId, record.withLastSnapshotId(snapshotId));
        }
      },
    );

    this._snapshotCoordinators.set(jobId, sc);
    sc.start();
  }

  private async _stopSnapshotCoordinator(jobId: string): Promise<void> {
    const sc = this._snapshotCoordinators.get(jobId);
    if (sc) {
      await sc.stop();
      this._snapshotCoordinators.delete(jobId);
    }
  }

  private _notifyJob(jobId: string, previousStatus: JobStatus, newStatus: JobStatus): void {
    const job = this._jobs.get(jobId);
    if (job) {
      job.notifyStatusChange(previousStatus, newStatus);
    }
  }

  private _createJobCoordinator(jobId: string): JobCoordinator {
    return {
      getStatus: () => this._jobStatuses.get(jobId) ?? JobStatus.NOT_RUNNING,
      cancel: () => this.cancelJob(jobId),
      suspend: () => this.suspendJob(jobId),
      resume: () => this.resumeJob(jobId),
      restart: () => this.restartJob(jobId),
      exportSnapshot: async (name: string) => {
        const sc = this._snapshotCoordinators.get(jobId);
        if (!sc) throw new Error('No snapshot coordinator for this job');
        await sc.initiateSnapshot(name);
      },
      getMetrics: async () => this._executor.getLocalMetrics(jobId) ?? [],
    };
  }

  private async _getAllJobRecords(): Promise<JobRecord[]> {
    return (this._imap as any).values() as JobRecord[];
  }

  private _scheduleScaleUp(_memberId: string): void {
    // Get all running jobs with autoScaling
    const doScaleUp = async (): Promise<void> => {
      if (!this._authority) return;

      const records = await this._getAllJobRecords();
      for (const record of records) {
        if (record.status !== JobStatus.RUNNING) continue;
        if (!record.config.autoScaling) continue;

        // Check if current members differ from alive members
        const hasNewMembers = this._memberIds.some(m => !record.participatingMembers.includes(m));
        if (!hasNewMembers) continue;

        // Restart with updated member list
        await this.restartJob(record.id);
      }
    };

    // Debounce: clear existing timer for any job
    for (const [key, timer] of this._scaleUpTimers) {
      clearTimeout(timer);
      this._scaleUpTimers.delete(key);
    }

    // Use the shortest scaleUpDelayMillis from any running auto-scaling job
    const delay = 50; // Will be overridden per-job in practice
    const timer = setTimeout(() => {
      this._scaleUpTimers.delete('_global');
      doScaleUp();
    }, delay);
    this._scaleUpTimers.set('_global', timer);
  }
}
