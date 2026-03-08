import type { BlitzJobMetrics, SnapshotMetrics, VertexMetrics } from './BlitzJobMetrics.js';
import { MetricUnit } from './MetricUnit.js';

/**
 * MetricsCollector — aggregates per-member VertexMetrics into BlitzJobMetrics.
 *
 * Follows Hazelcast Jet semantics: each member reports its local vertex metrics,
 * and the coordinator aggregates them into a single cross-member view.
 *
 * Aggregation rules:
 *   - itemsIn/Out, queueSize, queueCapacity, distributedXxx: summed across members
 *   - latencyP50: average of member p50s; latencyP99/Max: max across members
 *   - topObservedWm, coalescedWm, lastForwardedWm: max across members
 *   - lastForwardedWmLatency: max across members (worst lag wins)
 *   - tags: taken from first member that reports them (identical across members)
 *   - userMetrics: COUNT/BYTES → sum; MS → max; PERCENT → average
 *   - executionStartTime: min across members (earliest start)
 *   - executionCompletionTime: max across members (latest finish)
 */
export class MetricsCollector {
  /**
   * Combine per-member VertexMetrics arrays into a single BlitzJobMetrics.
   */
  static aggregate(
    memberMetrics: Map<string, VertexMetrics[]>,
    snapshotMetrics: SnapshotMetrics,
    executionTimestamps?: { startTime: number; completionTime: number }[],
  ): BlitzJobMetrics {
    const vertexAccumulators = new Map<string, {
      type: 'source' | 'operator' | 'sink';
      itemsIn: number;
      itemsOut: number;
      queueSize: number;
      queueCapacity: number;
      latencyP50Sum: number;
      latencyP99Max: number;
      latencyMaxMax: number;
      memberCount: number;
      distributedItemsIn: number;
      distributedItemsOut: number;
      distributedBytesIn: number;
      distributedBytesOut: number;
      // T11: watermarks
      topObservedWmMax: number;
      coalescedWmMax: number;
      lastForwardedWmMax: number;
      lastForwardedWmLatencyMax: number;
      // T14: tags (taken from first member)
      tags: ReadonlyMap<string, string> | undefined;
      // T15: user metrics accumulators
      userMetricSums: Map<string, number>;
      userMetricMaxes: Map<string, number>;
      userMetricPercentSums: Map<string, number>;
      userMetricPercentCount: Map<string, number>;
    }>();

    for (const metrics of memberMetrics.values()) {
      for (const vm of metrics) {
        let acc = vertexAccumulators.get(vm.name);
        if (!acc) {
          acc = {
            type: vm.type,
            itemsIn: 0,
            itemsOut: 0,
            queueSize: 0,
            queueCapacity: 0,
            latencyP50Sum: 0,
            latencyP99Max: 0,
            latencyMaxMax: 0,
            memberCount: 0,
            distributedItemsIn: 0,
            distributedItemsOut: 0,
            distributedBytesIn: 0,
            distributedBytesOut: 0,
            topObservedWmMax: -1,
            coalescedWmMax: -1,
            lastForwardedWmMax: -1,
            lastForwardedWmLatencyMax: -1,
            tags: undefined,
            userMetricSums: new Map(),
            userMetricMaxes: new Map(),
            userMetricPercentSums: new Map(),
            userMetricPercentCount: new Map(),
          };
          vertexAccumulators.set(vm.name, acc);
        }

        acc.itemsIn += vm.itemsIn;
        acc.itemsOut += vm.itemsOut;
        acc.queueSize += vm.queueSize;
        acc.queueCapacity += vm.queueCapacity;
        acc.latencyP50Sum += vm.latencyP50Ms;
        acc.latencyP99Max = Math.max(acc.latencyP99Max, vm.latencyP99Ms);
        acc.latencyMaxMax = Math.max(acc.latencyMaxMax, vm.latencyMaxMs);
        acc.memberCount++;
        acc.distributedItemsIn += vm.distributedItemsIn;
        acc.distributedItemsOut += vm.distributedItemsOut;
        acc.distributedBytesIn += vm.distributedBytesIn;
        acc.distributedBytesOut += vm.distributedBytesOut;

        // T11: watermarks — max across members
        if (vm.topObservedWm > acc.topObservedWmMax) acc.topObservedWmMax = vm.topObservedWm;
        if (vm.coalescedWm > acc.coalescedWmMax) acc.coalescedWmMax = vm.coalescedWm;
        if (vm.lastForwardedWm > acc.lastForwardedWmMax) acc.lastForwardedWmMax = vm.lastForwardedWm;
        if (vm.lastForwardedWmLatency > acc.lastForwardedWmLatencyMax) {
          acc.lastForwardedWmLatencyMax = vm.lastForwardedWmLatency;
        }

        // T14: tags — take from first member reporting them
        if (!acc.tags && vm.tags) {
          acc.tags = vm.tags;
        }

        // T15: user metrics — merge with unit-appropriate aggregation
        if (vm.userMetrics) {
          for (const [name, value] of vm.userMetrics) {
            // Determine aggregation strategy from the metric name suffix convention:
            // names ending with "_pct" → PERCENT (average); "_ms" → MS (max); else COUNT/BYTES (sum)
            if (name.endsWith('_pct') || name.endsWith('_percent')) {
              acc.userMetricPercentSums.set(name, (acc.userMetricPercentSums.get(name) ?? 0) + value);
              acc.userMetricPercentCount.set(name, (acc.userMetricPercentCount.get(name) ?? 0) + 1);
            } else if (name.endsWith('_ms') || name.endsWith('_latency')) {
              acc.userMetricMaxes.set(name, Math.max(acc.userMetricMaxes.get(name) ?? 0, value));
            } else {
              acc.userMetricSums.set(name, (acc.userMetricSums.get(name) ?? 0) + value);
            }
          }
        }
      }
    }

    const vertices = new Map<string, VertexMetrics>();
    let totalIn = 0;
    let totalOut = 0;
    let totalDistributedItemsIn = 0;
    let totalDistributedItemsOut = 0;
    let totalDistributedBytesIn = 0;
    let totalDistributedBytesOut = 0;

    for (const [name, acc] of vertexAccumulators) {
      // T15: merge all user metric accumulators into one map
      const mergedUserMetrics = new Map<string, number>();
      for (const [mName, sum] of acc.userMetricSums) mergedUserMetrics.set(mName, sum);
      for (const [mName, max] of acc.userMetricMaxes) mergedUserMetrics.set(mName, max);
      for (const [mName, pctSum] of acc.userMetricPercentSums) {
        const count = acc.userMetricPercentCount.get(mName) ?? 1;
        mergedUserMetrics.set(mName, count > 0 ? pctSum / count : 0);
      }

      const merged: VertexMetrics = {
        name,
        type: acc.type,
        itemsIn: acc.itemsIn,
        itemsOut: acc.itemsOut,
        queueSize: acc.queueSize,
        queueCapacity: acc.queueCapacity,
        latencyP50Ms: acc.memberCount > 0 ? Math.round(acc.latencyP50Sum / acc.memberCount) : 0,
        latencyP99Ms: acc.latencyP99Max,
        latencyMaxMs: acc.latencyMaxMax,
        distributedItemsIn: acc.distributedItemsIn,
        distributedItemsOut: acc.distributedItemsOut,
        distributedBytesIn: acc.distributedBytesIn,
        distributedBytesOut: acc.distributedBytesOut,
        topObservedWm: acc.topObservedWmMax,
        coalescedWm: acc.coalescedWmMax,
        lastForwardedWm: acc.lastForwardedWmMax,
        lastForwardedWmLatency: acc.lastForwardedWmLatencyMax,
        tags: acc.tags,
        ...(mergedUserMetrics.size > 0 ? { userMetrics: mergedUserMetrics } : {}),
      };
      vertices.set(name, merged);

      // Sources produce data into the DAG
      if (acc.type === 'source') {
        totalIn += acc.itemsOut;
      }
      // Sinks consume data from the DAG
      if (acc.type === 'sink') {
        totalOut += acc.itemsIn;
      }

      totalDistributedItemsIn += acc.distributedItemsIn;
      totalDistributedItemsOut += acc.distributedItemsOut;
      totalDistributedBytesIn += acc.distributedBytesIn;
      totalDistributedBytesOut += acc.distributedBytesOut;
    }

    // T13: aggregate execution timestamps across members
    let executionStartTime = Date.now();
    let executionCompletionTime = -1;
    if (executionTimestamps && executionTimestamps.length > 0) {
      executionStartTime = Math.min(...executionTimestamps.map(t => t.startTime));
      const completionTimes = executionTimestamps.map(t => t.completionTime).filter(t => t >= 0);
      executionCompletionTime = completionTimes.length > 0 ? Math.max(...completionTimes) : -1;
    }

    return {
      totalIn,
      totalOut,
      totalDistributedItemsIn,
      totalDistributedItemsOut,
      totalDistributedBytesIn,
      totalDistributedBytesOut,
      vertices,
      snapshots: snapshotMetrics,
      collectedAt: Date.now(),
      executionStartTime,
      executionCompletionTime,
    };
  }
}
