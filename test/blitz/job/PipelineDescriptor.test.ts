import { describe, expect, it } from 'bun:test';
import {
  EdgeType,
  type PipelineDescriptor,
  type VertexDescriptor,
  type EdgeDescriptor,
  type SourceDescriptor,
  type SinkDescriptor,
} from '@zenystx/helios-core/job/PipelineDescriptor.js';

describe('EdgeType', () => {
  it('has all 6 edge types', () => {
    expect(Object.values(EdgeType)).toHaveLength(6);
    expect(String(EdgeType.LOCAL)).toBe('LOCAL');
    expect(String(EdgeType.LOCAL_PARTITIONED)).toBe('LOCAL_PARTITIONED');
    expect(String(EdgeType.DISTRIBUTED_UNICAST)).toBe('DISTRIBUTED_UNICAST');
    expect(String(EdgeType.DISTRIBUTED_PARTITIONED)).toBe('DISTRIBUTED_PARTITIONED');
    expect(String(EdgeType.DISTRIBUTED_BROADCAST)).toBe('DISTRIBUTED_BROADCAST');
    expect(String(EdgeType.ALL_TO_ONE)).toBe('ALL_TO_ONE');
  });
});

describe('PipelineDescriptor serialization round-trip', () => {
  it('round-trips through JSON without data loss', () => {
    const source: SourceDescriptor = {
      type: 'nats-stream',
      config: { stream: 'orders', consumer: 'processor-1' },
    };
    const sink: SinkDescriptor = {
      type: 'helios-map',
      config: { mapName: 'results' },
    };
    const vertices: VertexDescriptor[] = [
      { name: 'source-1', type: 'source', fnSource: null, sourceConfig: source, sinkConfig: null },
      { name: 'map-1', type: 'operator', fnSource: '(x) => x * 2', sourceConfig: null, sinkConfig: null },
      { name: 'sink-1', type: 'sink', fnSource: null, sourceConfig: null, sinkConfig: sink },
    ];
    const edges: EdgeDescriptor[] = [
      { from: 'source-1', to: 'map-1', edgeType: EdgeType.LOCAL, subject: '', keyFnSource: null },
      { from: 'map-1', to: 'sink-1', edgeType: EdgeType.DISTRIBUTED_PARTITIONED, subject: 'blitz.edge.1', keyFnSource: '(x) => x.id' },
    ];
    const descriptor: PipelineDescriptor = {
      name: 'test-pipeline',
      vertices,
      edges,
      parallelism: 4,
    };

    const json = JSON.stringify(descriptor);
    const restored: PipelineDescriptor = JSON.parse(json);

    expect(restored.name).toBe(descriptor.name);
    expect(restored.vertices).toEqual(descriptor.vertices);
    expect(restored.edges).toEqual(descriptor.edges);
    expect(restored.parallelism).toBe(descriptor.parallelism);
  });

  it('preserves all source descriptor types', () => {
    const types: SourceDescriptor['type'][] = [
      'nats-subject', 'nats-stream', 'helios-map', 'helios-topic', 'file', 'http-webhook',
    ];
    for (const t of types) {
      const sd: SourceDescriptor = { type: t, config: {} };
      expect(JSON.parse(JSON.stringify(sd)).type).toBe(t);
    }
  });

  it('preserves all sink descriptor types', () => {
    const types: SinkDescriptor['type'][] = [
      'nats-subject', 'nats-stream', 'helios-map', 'helios-topic', 'file', 'log',
    ];
    for (const t of types) {
      const sd: SinkDescriptor = { type: t, config: {} };
      expect(JSON.parse(JSON.stringify(sd)).type).toBe(t);
    }
  });
});
