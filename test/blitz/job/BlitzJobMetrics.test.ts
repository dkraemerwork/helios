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
      latencyP50Ms: 1.2,
      latencyP99Ms: 5.8,
      latencyMaxMs: 12.0,
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
      vertices: new Map([['source-1', vertexMetrics]]),
      snapshots: snapshotMetrics,
      collectedAt: Date.now(),
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
        latencyP50Ms: 0,
        latencyP99Ms: 0,
        latencyMaxMs: 0,
      };
      expect(m.type).toBe(t);
    }
  });
});
