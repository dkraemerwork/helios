export interface VertexMetrics {
  readonly name: string;
  readonly type: 'source' | 'operator' | 'sink';
  readonly itemsIn: number;
  readonly itemsOut: number;
  readonly queueSize: number;
  readonly latencyP50Ms: number;
  readonly latencyP99Ms: number;
  readonly latencyMaxMs: number;
  /** Items received from other cluster members on distributed edges. */
  readonly distributedItemsIn: number;
  /** Items sent to other cluster members on distributed edges. */
  readonly distributedItemsOut: number;
  /** Bytes received from other cluster members on distributed edges. */
  readonly distributedBytesIn: number;
  /** Bytes sent to other cluster members on distributed edges. */
  readonly distributedBytesOut: number;
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
  /** Total items received from remote cluster members across all vertices. */
  readonly totalDistributedItemsIn: number;
  /** Total items sent to remote cluster members across all vertices. */
  readonly totalDistributedItemsOut: number;
  /** Total bytes received from remote cluster members across all vertices. */
  readonly totalDistributedBytesIn: number;
  /** Total bytes sent to remote cluster members across all vertices. */
  readonly totalDistributedBytesOut: number;
  readonly vertices: Map<string, VertexMetrics>;
  readonly snapshots: SnapshotMetrics;
  readonly collectedAt: number;
}
