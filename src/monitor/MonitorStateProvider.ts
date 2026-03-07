/**
 * MonitorStateProvider — interface that the metrics sampler uses to pull
 * state from the Helios instance without a direct dependency on HeliosInstanceImpl.
 *
 * HeliosInstanceImpl implements this interface, allowing the monitor subsystem
 * to remain decoupled and independently testable.
 */

import type { TransportMetrics, ObjectInventory, MemberPartitionInfo, BlitzMetrics, ThreadPoolMetrics } from '@zenystx/helios-core/monitor/MetricsSample';

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
}
