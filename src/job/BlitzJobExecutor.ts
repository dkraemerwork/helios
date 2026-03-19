import type { Sink } from '@zenystx/helios-blitz/sink/Sink.js';
import type { Source } from '@zenystx/helios-blitz/source/Source.js';
import type { ExecutionPlan } from './ExecutionPlan.js';
import type { ProcessingGuarantee } from './JobConfig.js';
import { JobExecution, type OperatorFnEntry } from './engine/JobExecution.js';
import type { JobExecutionTimestamps, VertexMetrics } from './metrics/BlitzJobMetrics.js';

export interface ExecutionResources {
  readonly sources: Map<string, Source<unknown>>;
  readonly sinks: Map<string, Sink<unknown>>;
  readonly operatorFns: Map<string, OperatorFnEntry>;
  readonly guarantee: ProcessingGuarantee;
  readonly maxProcessorAccumulatedRecords: number;
}

/**
 * BlitzJobExecutor — manages multiple JobExecutions per member.
 *
 * Handles START_EXECUTION/STOP_EXECUTION commands, collects local metrics,
 * and injects snapshot barriers. Runs on every member in the cluster.
 */
export class BlitzJobExecutor {
  private readonly _memberId: string;
  private readonly _executions = new Map<string, JobExecution>();
  private readonly _completedExecutionTimestamps = new Map<string, JobExecutionTimestamps>();

  constructor(memberId: string) {
    this._memberId = memberId;
  }

  get memberId(): string {
    return this._memberId;
  }

  /**
   * Start a new job execution on this member.
   */
  async startExecution(plan: ExecutionPlan, resources: ExecutionResources): Promise<void> {
    if (this._executions.has(plan.jobId)) {
      throw new Error(`Job '${plan.jobId}' is already executing on this member`);
    }

    const exec = new JobExecution({
      jobId: plan.jobId,
      plan,
      memberId: this._memberId,
      sources: resources.sources,
      sinks: resources.sinks,
      operatorFns: resources.operatorFns,
      guarantee: resources.guarantee,
      maxProcessorAccumulatedRecords: resources.maxProcessorAccumulatedRecords,
    });

    this._executions.set(plan.jobId, exec);
    await exec.start();
  }

  /**
   * Stop execution of a job on this member.
   */
  async stopExecution(jobId: string, _reason: 'cancel' | 'suspend' | 'restart'): Promise<void> {
    const exec = this._executions.get(jobId);
    if (!exec) return;

    await exec.stop();
    this._completedExecutionTimestamps.set(jobId, exec.getExecutionTimestamps());
    this._executions.delete(jobId);
  }

  /**
   * Wait for a job to complete naturally (batch mode).
   */
  async waitForCompletion(jobId: string, timeoutMs: number): Promise<void> {
    const exec = this._executions.get(jobId);
    if (!exec) return;

    await exec.waitForCompletion(timeoutMs);
  }

  /**
   * Get local vertex metrics for a running job.
   */
  getLocalMetrics(jobId: string): VertexMetrics[] | null {
    const exec = this._executions.get(jobId);
    if (!exec) return null;

    return exec.getMetrics();
  }

  getExecutionTimestamps(jobId: string): JobExecutionTimestamps | null {
    const exec = this._executions.get(jobId);
    if (exec) {
      return exec.getExecutionTimestamps();
    }

    return this._completedExecutionTimestamps.get(jobId) ?? null;
  }

  /**
   * Inject a snapshot barrier into all source processors for a job.
   */
  injectSnapshotBarrier(jobId: string, snapshotId: string): void {
    const exec = this._executions.get(jobId);
    if (!exec) return;

    exec.injectSnapshotBarrier(snapshotId);
  }
}
