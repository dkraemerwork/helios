import type { ExecutionPlan } from './ExecutionPlan.js';
import type { VertexMetrics } from './metrics/BlitzJobMetrics.js';

export type JobCommand =
  | { type: 'START_EXECUTION'; jobId: string; plan: ExecutionPlan }
  | { type: 'STOP_EXECUTION'; jobId: string; reason: 'cancel' | 'suspend' | 'restart' }
  | { type: 'INJECT_BARRIER'; jobId: string; snapshotId: string }
  | { type: 'BARRIER_COMPLETE'; jobId: string; snapshotId: string; memberId: string; sizeBytes: number }
  | { type: 'EXECUTION_READY'; jobId: string; memberId: string }
  | { type: 'EXECUTION_FAILED'; jobId: string; memberId: string; error: string }
  | { type: 'EXECUTION_COMPLETED'; jobId: string; memberId: string }
  | { type: 'COLLECT_METRICS'; jobId: string; requestId: string }
  | { type: 'METRICS_RESPONSE'; jobId: string; requestId: string; memberId: string; metrics: VertexMetrics[] };
