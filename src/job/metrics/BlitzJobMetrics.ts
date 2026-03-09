export interface VertexMetrics {
  readonly name: string;
  readonly type: 'source' | 'operator' | 'sink';
  readonly itemsIn: number;
  readonly itemsOut: number;
  readonly queueSize: number;
  /** Capacity of the outbox channel. Enables utilization = queueSize / queueCapacity. */
  readonly queueCapacity: number;
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

  // T11: Watermark tracking fields
  /** Highest event-time watermark observed from any input edge. -1 when none seen. */
  readonly topObservedWm: number;
  /** Coalesced (min across all input edges) watermark. -1 until all edges have reported. */
  readonly coalescedWm: number;
  /** Most recent watermark forwarded downstream. -1 when none forwarded. */
  readonly lastForwardedWm: number;
  /** Wall-clock lag in ms: Date.now() - lastForwardedWm. -1 when no watermark forwarded. */
  readonly lastForwardedWmLatency: number;

  // T14: Tag-based metric system
  /** Tag map describing the metric origin (job, vertex, member, proc type, etc.). */
  readonly tags?: ReadonlyMap<string, string>;

  // T15: User-defined custom metrics
  /** Custom metrics registered by pipeline code via Metrics.metric(). */
  readonly userMetrics?: ReadonlyMap<string, number>;
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

  // T13: Per-execution timestamps
  /** Epoch ms when the job execution started (min across all members). */
  readonly executionStartTime: number;
  /**
   * Epoch ms when the job execution completed (max across all members).
   * -1 while the job is still running.
   */
  readonly executionCompletionTime: number;
}

/** Convert a VertexMetrics to a plain JSON-serializable object (Maps → plain objects). */
export function vertexMetricsToJSON(vm: VertexMetrics): Record<string, unknown> {
  return {
    name: vm.name,
    type: vm.type,
    itemsIn: vm.itemsIn,
    itemsOut: vm.itemsOut,
    queueSize: vm.queueSize,
    queueCapacity: vm.queueCapacity,
    latencyP50Ms: vm.latencyP50Ms,
    latencyP99Ms: vm.latencyP99Ms,
    latencyMaxMs: vm.latencyMaxMs,
    distributedItemsIn: vm.distributedItemsIn,
    distributedItemsOut: vm.distributedItemsOut,
    distributedBytesIn: vm.distributedBytesIn,
    distributedBytesOut: vm.distributedBytesOut,
    topObservedWm: vm.topObservedWm,
    coalescedWm: vm.coalescedWm,
    lastForwardedWm: vm.lastForwardedWm,
    lastForwardedWmLatency: vm.lastForwardedWmLatency,
    tags: vm.tags ? Object.fromEntries(vm.tags) : undefined,
    userMetrics: vm.userMetrics ? Object.fromEntries(vm.userMetrics) : undefined,
  };
}

/** Convert BlitzJobMetrics to a plain JSON-serializable object (Maps → plain objects). */
export function blitzJobMetricsToJSON(m: BlitzJobMetrics): Record<string, unknown> {
  return {
    totalIn: m.totalIn,
    totalOut: m.totalOut,
    totalDistributedItemsIn: m.totalDistributedItemsIn,
    totalDistributedItemsOut: m.totalDistributedItemsOut,
    totalDistributedBytesIn: m.totalDistributedBytesIn,
    totalDistributedBytesOut: m.totalDistributedBytesOut,
    vertices: Object.fromEntries(
      [...m.vertices].map(([k, v]) => [k, vertexMetricsToJSON(v)]),
    ),
    snapshots: { ...m.snapshots },
    collectedAt: m.collectedAt,
    executionStartTime: m.executionStartTime,
    executionCompletionTime: m.executionCompletionTime,
  };
}
