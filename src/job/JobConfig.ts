export enum ProcessingGuarantee {
  NONE = 'NONE',
  AT_LEAST_ONCE = 'AT_LEAST_ONCE',
  EXACTLY_ONCE = 'EXACTLY_ONCE',
}

export interface JobConfig {
  readonly name?: string;
  readonly processingGuarantee?: ProcessingGuarantee;
  readonly snapshotIntervalMillis?: number;
  readonly autoScaling?: boolean;
  readonly suspendOnFailure?: boolean;
  readonly scaleUpDelayMillis?: number;
  readonly splitBrainProtection?: boolean;
  readonly maxProcessorAccumulatedRecords?: number;
  readonly initialSnapshotName?: string;
}

export interface ResolvedJobConfig {
  readonly name: string;
  readonly processingGuarantee: ProcessingGuarantee;
  readonly snapshotIntervalMillis: number;
  readonly autoScaling: boolean;
  readonly suspendOnFailure: boolean;
  readonly scaleUpDelayMillis: number;
  readonly splitBrainProtection: boolean;
  readonly maxProcessorAccumulatedRecords: number;
  readonly initialSnapshotName: string | undefined;
}

export function resolveJobConfig(config?: JobConfig, pipelineName?: string): ResolvedJobConfig {
  const snapshotIntervalMillis = config?.snapshotIntervalMillis ?? 10_000;
  if (snapshotIntervalMillis <= 0) {
    throw new Error(`snapshotIntervalMillis must be positive, got ${snapshotIntervalMillis}`);
  }

  const maxProcessorAccumulatedRecords = config?.maxProcessorAccumulatedRecords ?? 16_384;
  if (maxProcessorAccumulatedRecords <= 0) {
    throw new Error(`maxProcessorAccumulatedRecords must be positive, got ${maxProcessorAccumulatedRecords}`);
  }

  return {
    name: config?.name ?? pipelineName ?? crypto.randomUUID(),
    processingGuarantee: config?.processingGuarantee ?? ProcessingGuarantee.NONE,
    snapshotIntervalMillis,
    autoScaling: config?.autoScaling ?? true,
    suspendOnFailure: config?.suspendOnFailure ?? false,
    scaleUpDelayMillis: config?.scaleUpDelayMillis ?? 10_000,
    splitBrainProtection: config?.splitBrainProtection ?? false,
    maxProcessorAccumulatedRecords,
    initialSnapshotName: config?.initialSnapshotName,
  };
}
