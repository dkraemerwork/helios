import { describe, expect, it } from 'bun:test';
import type {
  BlitzJobMetrics,
  VertexMetrics,
  SnapshotMetrics,
} from '@zenystx/helios-core/job/metrics/BlitzJobMetrics.js';

describe('BlitzJobMetrics', () => {
  it('can construct a complete metrics object', () => {
    const vertexMetrics: VertexMetrics = {
      name: 'source-1',
      type: 'source',
      itemsIn: 1000,
      itemsOut: 950,
      queueSize: 50,
      queueCapacity: 1024,
      latencyP50Ms: 1.2,
      latencyP99Ms: 5.8,
      latencyMaxMs: 12.0,
      distributedItemsIn: 0,
      distributedItemsOut: 0,
      distributedBytesIn: 0,
      distributedBytesOut: 0,
      topObservedWm: -1,
      coalescedWm: -1,
      lastForwardedWm: -1,
      lastForwardedWmLatency: -1,
    };

    const snapshotMetrics: SnapshotMetrics = {
      snapshotCount: 5,
      lastSnapshotDurationMs: 120,
      lastSnapshotBytes: 4096,
      lastSnapshotTimestamp: Date.now(),
    };

    const metrics: BlitzJobMetrics = {
      totalIn: 1000,
      totalOut: 950,
      totalDistributedItemsIn: 0,
      totalDistributedItemsOut: 0,
      totalDistributedBytesIn: 0,
      totalDistributedBytesOut: 0,
      vertices: new Map([['source-1', vertexMetrics]]),
      snapshots: snapshotMetrics,
      collectedAt: Date.now(),
      executionStartTime: Date.now(),
      executionCompletionTime: -1,
    };

    expect(metrics.totalIn).toBe(1000);
    expect(metrics.totalOut).toBe(950);
    expect(metrics.vertices.get('source-1')).toEqual(vertexMetrics);
    expect(metrics.snapshots.snapshotCount).toBe(5);
  });

  it('vertex metrics covers all three vertex types', () => {
    const types: VertexMetrics['type'][] = ['source', 'operator', 'sink'];
    for (const t of types) {
      const m: VertexMetrics = {
        name: `v-${t}`,
        type: t,
        itemsIn: 0,
        itemsOut: 0,
        queueSize: 0,
        queueCapacity: 0,
        latencyP50Ms: 0,
        latencyP99Ms: 0,
        latencyMaxMs: 0,
        distributedItemsIn: 0,
        distributedItemsOut: 0,
        distributedBytesIn: 0,
        distributedBytesOut: 0,
        topObservedWm: -1,
        coalescedWm: -1,
        lastForwardedWm: -1,
        lastForwardedWmLatency: -1,
      };
      expect(m.type).toBe(t);
    }
  });
});
