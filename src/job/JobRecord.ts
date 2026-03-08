import type { JobStatus } from './JobStatus.js';
import type { ResolvedJobConfig } from './JobConfig.js';
import type { PipelineDescriptor } from './PipelineDescriptor.js';

export interface JobRecordInit {
  readonly id: string;
  readonly name: string;
  readonly status: JobStatus;
  readonly config: ResolvedJobConfig;
  readonly pipelineDescriptor: PipelineDescriptor;
  readonly submittedAt: number;
  readonly participatingMembers: string[];
  readonly lastSnapshotId: string | null;
  readonly failureReason: string | null;
  readonly lightJob: boolean;
}

/**
 * IMap-stored job state record. Immutable — use `with*()` methods to produce updated copies.
 */
export class JobRecord {
  readonly id: string;
  readonly name: string;
  readonly status: JobStatus;
  readonly config: ResolvedJobConfig;
  readonly pipelineDescriptor: PipelineDescriptor;
  readonly submittedAt: number;
  readonly participatingMembers: readonly string[];
  readonly lastSnapshotId: string | null;
  readonly failureReason: string | null;
  readonly lightJob: boolean;

  constructor(init: JobRecordInit) {
    this.id = init.id;
    this.name = init.name;
    this.status = init.status;
    this.config = init.config;
    this.pipelineDescriptor = init.pipelineDescriptor;
    this.submittedAt = init.submittedAt;
    this.participatingMembers = [...init.participatingMembers];
    this.lastSnapshotId = init.lastSnapshotId;
    this.failureReason = init.failureReason;
    this.lightJob = init.lightJob;
  }

  withStatus(status: JobStatus): JobRecord {
    return new JobRecord({ ...this.toInit(), status });
  }

  withFailureReason(reason: string | null): JobRecord {
    return new JobRecord({ ...this.toInit(), failureReason: reason });
  }

  withLastSnapshotId(snapshotId: string | null): JobRecord {
    return new JobRecord({ ...this.toInit(), lastSnapshotId: snapshotId });
  }

  withParticipatingMembers(members: string[]): JobRecord {
    return new JobRecord({ ...this.toInit(), participatingMembers: members });
  }

  private toInit(): JobRecordInit {
    return {
      id: this.id,
      name: this.name,
      status: this.status,
      config: this.config,
      pipelineDescriptor: this.pipelineDescriptor,
      submittedAt: this.submittedAt,
      participatingMembers: [...this.participatingMembers],
      lastSnapshotId: this.lastSnapshotId,
      failureReason: this.failureReason,
      lightJob: this.lightJob,
    };
  }
}
