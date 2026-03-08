import type { BlitzJobMetrics, SnapshotMetrics, VertexMetrics } from './BlitzJobMetrics.js';

/**
 * MetricsCollector — aggregates per-member VertexMetrics into BlitzJobMetrics.
 *
 * Follows Hazelcast Jet semantics: each member reports its local vertex metrics,
 * and the coordinator aggregates them into a single cross-member view.
 */
export class MetricsCollector {
  /**
   * Combine per-member VertexMetrics arrays into a single BlitzJobMetrics.
   *
   * - Sums itemsIn/Out and queueSize across members for each vertex
   * - Merges latency: p50 = average of member p50s, p99/max = max across members
   * - Passes through snapshot metrics from the coordinator
   * - totalIn = sum of all source itemsOut (data entering the DAG)
   * - totalOut = sum of all sink itemsIn (data leaving the DAG)
   */
  static aggregate(
    memberMetrics: Map<string, VertexMetrics[]>,
    snapshotMetrics: SnapshotMetrics,
  ): BlitzJobMetrics {
    const vertexAccumulators = new Map<string, {
      type: 'source' | 'operator' | 'sink';
      itemsIn: number;
      itemsOut: number;
      queueSize: number;
      latencyP50Sum: number;
      latencyP99Max: number;
      latencyMaxMax: number;
      memberCount: number;
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
            latencyP50Sum: 0,
            latencyP99Max: 0,
            latencyMaxMax: 0,
            memberCount: 0,
          };
          vertexAccumulators.set(vm.name, acc);
        }

        acc.itemsIn += vm.itemsIn;
        acc.itemsOut += vm.itemsOut;
        acc.queueSize += vm.queueSize;
        acc.latencyP50Sum += vm.latencyP50Ms;
        acc.latencyP99Max = Math.max(acc.latencyP99Max, vm.latencyP99Ms);
        acc.latencyMaxMax = Math.max(acc.latencyMaxMax, vm.latencyMaxMs);
        acc.memberCount++;
      }
    }

    const vertices = new Map<string, VertexMetrics>();
    let totalIn = 0;
    let totalOut = 0;

    for (const [name, acc] of vertexAccumulators) {
      const merged: VertexMetrics = {
        name,
        type: acc.type,
        itemsIn: acc.itemsIn,
        itemsOut: acc.itemsOut,
        queueSize: acc.queueSize,
        latencyP50Ms: acc.memberCount > 0 ? Math.round(acc.latencyP50Sum / acc.memberCount) : 0,
        latencyP99Ms: acc.latencyP99Max,
        latencyMaxMs: acc.latencyMaxMax,
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
    }

    return {
      totalIn,
      totalOut,
      vertices,
      snapshots: snapshotMetrics,
      collectedAt: Date.now(),
    };
  }
}
