import { type JobStatus, isTerminalStatus } from './JobStatus.js';
import type { VertexMetrics, BlitzJobMetrics } from './metrics/BlitzJobMetrics.js';

export interface JobStatusEvent {
  readonly jobId: string;
  readonly previousStatus: JobStatus;
  readonly newStatus: JobStatus;
}

export type JobStatusListener = (event: JobStatusEvent) => void;

/**
 * Coordinator interface that BlitzJob delegates cluster operations to.
 * The real coordinator is implemented in Block 23.10.
 */
export interface JobCoordinator {
  cancel(): Promise<void>;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  restart(): Promise<void>;
  exportSnapshot(name: string): Promise<void>;
  getMetrics(): Promise<BlitzJobMetrics | VertexMetrics[]>;
  getStatus(): JobStatus;
}

/**
 * User-facing job handle. Delegates cluster operations to a coordinator
 * and manages local status listeners and join() promises.
 */
export class BlitzJob {
  private readonly _id: string;
  private readonly _name: string;
  private readonly _coordinator: JobCoordinator;
  private readonly _submissionTime: number;
  private readonly _listeners = new Set<JobStatusListener>();
  private readonly _joinResolvers = new Set<() => void>();
  private _terminated = false;

  constructor(id: string, name: string, coordinator: JobCoordinator, submissionTime: number) {
    this._id = id;
    this._name = name;
    this._coordinator = coordinator;
    this._submissionTime = submissionTime;
  }

  get id(): string { return this._id; }
  get name(): string { return this._name; }

  getStatus(): JobStatus {
    return this._coordinator.getStatus();
  }

  getSubmissionTime(): number {
    return this._submissionTime;
  }

  async cancel(): Promise<void> {
    return this._coordinator.cancel();
  }

  async suspend(): Promise<void> {
    return this._coordinator.suspend();
  }

  async resume(): Promise<void> {
    return this._coordinator.resume();
  }

  async restart(): Promise<void> {
    return this._coordinator.restart();
  }

  async exportSnapshot(name: string): Promise<void> {
    return this._coordinator.exportSnapshot(name);
  }

  async getMetrics(): Promise<BlitzJobMetrics | VertexMetrics[]> {
    return this._coordinator.getMetrics();
  }

  /**
   * Register a status listener. Returns an unsubscribe function.
   * Listeners are auto-removed after a terminal status event.
   */
  addStatusListener(listener: JobStatusListener): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  /**
   * Returns a Promise that resolves when the job reaches a terminal status
   * (COMPLETED, FAILED, or CANCELLED). Resolves immediately if already terminal.
   */
  join(): Promise<void> {
    if (isTerminalStatus(this._coordinator.getStatus())) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this._joinResolvers.add(resolve);
    });
  }

  /**
   * Called by the coordinator/runtime when a status transition occurs.
   * Fires all registered listeners and resolves join() promises on terminal states.
   */
  notifyStatusChange(previousStatus: JobStatus, newStatus: JobStatus): void {
    if (this._terminated) {
      return;
    }

    const event: JobStatusEvent = {
      jobId: this._id,
      previousStatus,
      newStatus,
    };

    for (const listener of this._listeners) {
      listener(event);
    }

    if (isTerminalStatus(newStatus)) {
      this._terminated = true;
      this._listeners.clear();

      for (const resolve of this._joinResolvers) {
        resolve();
      }
      this._joinResolvers.clear();
    }
  }
}
