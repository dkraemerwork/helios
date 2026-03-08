export interface VertexMetrics {
  readonly name: string;
  readonly type: 'source' | 'operator' | 'sink';
  readonly itemsIn: number;
  readonly itemsOut: number;
  readonly queueSize: number;
  readonly latencyP50Ms: number;
  readonly latencyP99Ms: number;
  readonly latencyMaxMs: number;
}

export interface SnapshotMetrics {
  readonly snapshotCount: number;
  readonly lastSnapshotDurationMs: number;
  readonly lastSnapshotBytes: number;
  readonly lastSnapshotTimestamp: number;
}

export interface BlitzJobMetrics {
  readonly totalIn: number;
  readonly totalOut: number;
  readonly vertices: Map<string, VertexMetrics>;
  readonly snapshots: SnapshotMetrics;
  readonly collectedAt: number;
}
