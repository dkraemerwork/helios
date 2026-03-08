/**
 * MonitorStateProvider — interface that the metrics sampler uses to pull
 * state from the Helios instance without a direct dependency on HeliosInstanceImpl.
 *
 * HeliosInstanceImpl implements this interface, allowing the monitor subsystem
 * to remain decoupled and independently testable.
 */

import type { LocalMapStats } from '@zenystx/helios-core/internal/monitor/impl/LocalMapStatsImpl';
import type { LocalQueueStats } from '@zenystx/helios-core/collection/LocalQueueStats';
import type { LocalTopicStats } from '@zenystx/helios-core/topic/LocalTopicStats';
import type { StoreLatencyMetrics } from '@zenystx/helios-core/diagnostics/StoreLatencyTracker';
import type { SystemEvent } from '@zenystx/helios-core/diagnostics/SystemEventLog';
import type { BlitzMetrics, InvocationMetrics, JobCounterMetrics, MemberPartitionInfo, MigrationMetrics, ObjectInventory, OperationMetrics, ThreadPoolMetrics, TransportMetrics } from '@zenystx/helios-core/monitor/MetricsSample';

export interface MonitorStateProvider {
    /** Instance name. */
    getInstanceName(): string;

    /** Node state (STARTING, ACTIVE, SHUTTING_DOWN, etc.). */
    getNodeState(): string;

    /** Cluster state string. */
    getClusterState(): string;

    /** Whether the cluster is safe. */
    isClusterSafe(): boolean;

    /** Number of members in the cluster. */
    getClusterSize(): number;

    /** Member version string. */
    getMemberVersion(): string;

    /** Total partition count. */
    getPartitionCount(): number;

    /** Transport byte and channel counters. */
    getTransportMetrics(): TransportMetrics;

    /** Distributed object inventory snapshot. */
    getObjectInventory(): ObjectInventory;

    /** Per-member partition ownership info. */
    getMemberPartitionInfo(): MemberPartitionInfo[];

    /** Thread pool state. */
    getThreadPoolMetrics(): ThreadPoolMetrics;

    /**
     * Blitz metrics, or null if Blitz is not configured/active.
     * Implementations should check for Blitz runtime presence dynamically.
     */
    getBlitzMetrics(): BlitzMetrics | null;

    /**
     * Cluster-wide job lifecycle counters, or null if no Blitz job coordinator is active.
     * Mirrors Hazelcast Jet MetricNames.JOBS_SUBMITTED / COMPLETED_SUCCESSFULLY / COMPLETED_WITH_FAILURE.
     */
    getJobCounterMetrics(): JobCounterMetrics | null;

    /**
     * Partition migration queue metrics — live snapshot from MigrationManager.
     * Always returns a valid object; queue size is 0 when clustering is disabled.
     */
    getMigrationMetrics(): MigrationMetrics;

    /**
     * Operation execution metrics — live snapshot from OperationService.
     * Mirrors Hazelcast's operation.queueSize / runningCount / completedCount.
     * Always returns a valid object; all counters are 0 when no operations have run.
     */
    getOperationMetrics(): OperationMetrics;

    /**
     * Invocation metrics — live snapshot from InvocationMonitor.
     * Mirrors Hazelcast HealthMonitor's pending invocation checks.
     * Always returns a valid object; counts are 0 when no remote invocations are active.
     */
    getInvocationMetrics(): InvocationMetrics;

    /**
     * Per-map operation counters and memory stats — snapshot from MapContainerService.
     * Returns an empty map when no maps have been accessed yet.
     */
    getMapStats(): Map<string, LocalMapStats>;

    /**
     * MapStore/MapLoader call latency breakdown — snapshot from StoreLatencyTracker.
     * Returns null when monitoring or MapStore is not active.
     */
    getStoreLatencyMetrics(): StoreLatencyMetrics | null;

    /**
     * Per-queue operation counters — aggregated from all IQueue instances.
     * Returns an empty map when no queues have been created.
     */
    getQueueStats(): Map<string, LocalQueueStats>;

    /**
     * Per-topic operation counters — aggregated from all ITopic instances.
     * Returns an empty map when no topics have been created.
     */
    getTopicStats(): Map<string, LocalTopicStats>;

    /**
     * Recent system events from the SystemEventLog ring buffer.
     * Returns an empty array when the log has not been initialized.
     */
    getSystemEvents(): SystemEvent[];
}
