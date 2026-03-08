/**
 * MetricsSample — a single point-in-time metrics snapshot.
 *
 * Collected by {@link MetricsSampler} at the configured interval
 * and stored in the {@link MetricsRegistry} ring buffer.
 */

/** Event loop latency percentiles (nanoseconds). */
export interface EventLoopMetrics {
    /** Mean event loop delay (ms). */
    meanMs: number;
    /** P50 event loop delay (ms). */
    p50Ms: number;
    /** P99 event loop delay (ms). */
    p99Ms: number;
    /** Max event loop delay (ms). */
    maxMs: number;
    /** Minimum event loop delay (ms). */
    minMs: number;
}

/** Process memory metrics. */
export interface MemoryMetrics {
    /** Heap used (bytes). */
    heapUsed: number;
    /** Heap total (bytes). */
    heapTotal: number;
    /** RSS — resident set size (bytes). */
    rss: number;
    /** External memory (bytes, e.g. ArrayBuffers). */
    external: number;
    /** Array buffers (bytes). */
    arrayBuffers: number;
}

/** CPU usage metrics (microseconds since process start, delta per sample). */
export interface CpuMetrics {
    /** User CPU time delta (microseconds). */
    userUs: number;
    /** System CPU time delta (microseconds). */
    systemUs: number;
    /** CPU utilization percentage (0-100+, can exceed 100 on multi-core). */
    percentUsed: number;
}

/** GC / V8 heap statistics. */
export interface GcMetrics {
    /** Total heap size (bytes). */
    totalHeapSize: number;
    /** Total heap size executable (bytes). */
    totalHeapSizeExecutable: number;
    /** Used heap size (bytes). */
    usedHeapSize: number;
    /** Heap size limit (bytes). */
    heapSizeLimit: number;
    /** Total physical size (bytes). */
    totalPhysicalSize: number;
    /** Total available size (bytes). */
    totalAvailableSize: number;
    /** Malloced memory (bytes). */
    mallocedMemory: number;
    /** Number of native contexts. */
    numberOfNativeContexts: number;
    /** Number of detached contexts. */
    numberOfDetachedContexts: number;
}

/** Helios transport counters. */
export interface TransportMetrics {
    bytesRead: number;
    bytesWritten: number;
    openChannels: number;
    peerCount: number;
}

/** Per-member partition ownership. */
export interface MemberPartitionInfo {
    uuid: string;
    address: string;
    isMaster: boolean;
    isLocal: boolean;
    primaryPartitions: number;
    backupPartitions: number;
}

/** Distributed object inventory snapshot. */
export interface ObjectInventory {
    maps: string[];
    queues: string[];
    topics: string[];
    executors: string[];
}

/** Thread pool info. */
export interface ThreadPoolMetrics {
    /** Number of active scatter pool workers. */
    scatterPoolActive: number;
    /** Total configured scatter pool size. */
    scatterPoolSize: number;
}

/** Partition migration metrics. */
export interface MigrationMetrics {
    /** Number of pending migrations waiting in the queue. */
    migrationQueueSize: number;
    /** Number of migrations currently executing (0 or 1 in single-threaded runtime). */
    activeMigrations: number;
    /** Total migrations completed since the instance started. */
    completedMigrations: number;
}

/** Operation execution metrics — mirrors Hazelcast's operation.queueSize / runningCount / completedCount. */
export interface OperationMetrics {
    /** Number of operations currently pending in the invocation registry (queued + running). */
    queueSize: number;
    /** Number of operations actively executing (local run() in flight). */
    runningCount: number;
    /** Total operations completed since the instance started. */
    completedCount: number;
}

/**
 * Invocation metrics — mirrors Hazelcast HealthMonitor's pending invocation tracking.
 *
 * Hazelcast alerts when pendingCount > 1000 or usedPercentage > 70%.
 * Helios replicates this parity check in MetricsSampler.
 */
export interface InvocationMetrics {
    /** Number of active (pending) invocations waiting for a response. */
    pendingCount: number;
    /** Configured maximum concurrent invocations capacity. */
    maxConcurrent: number;
    /** Percentage of capacity currently consumed (pendingCount / maxConcurrent × 100). */
    usedPercentage: number;
    /** Cumulative timeout failures since the instance started. */
    timeoutFailures: number;
    /** Cumulative member-left failures since the instance started. */
    memberLeftFailures: number;
}

/** Cluster-wide monotonic job lifecycle counters (Hazelcast Jet MetricNames parity). */
export interface JobCounterMetrics {
    /** Total jobs submitted since coordinator creation. Mirrors MetricNames.JOBS_SUBMITTED. */
    submitted: number;
    /** Total jobs that completed successfully. Mirrors MetricNames.JOBS_COMPLETED_SUCCESSFULLY. */
    completedSuccessfully: number;
    /** Total jobs that failed. Mirrors MetricNames.JOBS_COMPLETED_WITH_FAILURE. */
    completedWithFailure: number;
    /** Total times a job execution started (each RUNNING transition). */
    executionStarted: number;
}

/** Blitz (NATS) metrics — present only when Blitz is active. */
export interface BlitzMetrics {
    /** Number of NATS cluster nodes. */
    clusterSize: number;
    /** Whether the Blitz service is ready. */
    isReady: boolean;
    /** Blitz readiness state string. */
    readinessState: string;
    /** Number of running pipelines. */
    runningPipelines: number;
    /** Whether JetStream is available. */
    jetStreamReady: boolean;
    /** Cluster-wide job lifecycle counters. Null when no job coordinator is active. */
    jobCounters: JobCounterMetrics | null;
}

/** A single point-in-time metrics snapshot. */
export interface MetricsSample {
    /** Unix timestamp (ms) when this sample was taken. */
    timestamp: number;

    /** Event loop latency. */
    eventLoop: EventLoopMetrics;

    /** Process memory. */
    memory: MemoryMetrics;

    /** CPU usage (delta since last sample). */
    cpu: CpuMetrics;

    /** GC / V8 heap stats (null if GC collection is disabled). */
    gc: GcMetrics | null;

    /** Helios transport counters. */
    transport: TransportMetrics;

    /** Thread pool info. */
    threads: ThreadPoolMetrics;

    /** Partition migration metrics. */
    migration: MigrationMetrics;

    /** Operation queue metrics. */
    operation: OperationMetrics;

    /** Blitz metrics (null if Blitz is not active). */
    blitz: BlitzMetrics | null;

    /** Invocation (pending remote call) metrics. */
    invocation: InvocationMetrics;
}

/** Full monitor payload sent to the dashboard. */
export interface MonitorPayload {
    /** Instance name. */
    instanceName: string;

    /** Node state (STARTING, ACTIVE, etc.). */
    nodeState: string;

    /** Cluster state (ACTIVE, etc.). */
    clusterState: string;

    /** Cluster size (member count). */
    clusterSize: number;

    /** Whether the cluster is safe. */
    clusterSafe: boolean;

    /** Member version. */
    memberVersion: string;

    /** Current partition count. */
    partitionCount: number;

    /** Per-member partition info. */
    members: MemberPartitionInfo[];

    /** Distributed object inventory. */
    objects: ObjectInventory;

    /** Time-series samples (ring buffer snapshot). */
    samples: MetricsSample[];

    /** Latest sample (convenience). */
    latest: MetricsSample | null;

    /** Current migration queue size (live, for K8s readiness and health checks). */
    migrationQueueSize: number;

    /** Current operation queue size (live snapshot from OperationService). */
    operationQueueSize: number;
}
