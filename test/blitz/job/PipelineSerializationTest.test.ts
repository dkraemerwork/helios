import { describe, expect, it } from 'bun:test';
import { Pipeline } from '@zenystx/helios-blitz/Pipeline';
import { Vertex } from '@zenystx/helios-blitz/Vertex';
import { Edge } from '@zenystx/helios-blitz/Edge';
import { EdgeType } from '@zenystx/helios-core/job/PipelineDescriptor';
import type { Source, SourceMessage } from '@zenystx/helios-blitz/source/Source';
import type { Sink } from '@zenystx/helios-blitz/sink/Sink';
import type { BlitzCodec } from '@zenystx/helios-blitz/codec/BlitzCodec';

// --- helpers ---

function dummyCodec<T>(): BlitzCodec<T> {
  return {
    encode: (_v: T) => new Uint8Array(),
    decode: (_b: Uint8Array) => null as unknown as T,
  };
}

function dummySource<T>(name: string): Source<T> {
  return {
    name,
    codec: dummyCodec<T>(),
    async *messages(): AsyncIterable<SourceMessage<T>> {},
  };
}

function dummySink<T>(name: string): Sink<T> {
  return {
    name,
    async write(_v: T): Promise<void> {},
  };
}

// ═══════════════════════════════════════════════════════
// 1. Edge.edgeType defaults and fluent setters
// ═══════════════════════════════════════════════════════

describe('Edge edgeType', () => {
  it('defaults to LOCAL', () => {
    const a = new Vertex('a', 'source');
    const b = new Vertex('b', 'operator');
    const edge = new Edge(a, b, 'subj');
    expect(edge.edgeType).toBe(EdgeType.LOCAL);
  });

  it('.distributed() sets DISTRIBUTED_UNICAST', () => {
    const a = new Vertex('a', 'source');
    const b = new Vertex('b', 'operator');
    const edge = new Edge(a, b, 'subj').distributed();
    expect(edge.edgeType).toBe(EdgeType.DISTRIBUTED_UNICAST);
  });

  it('.partitioned(keyFn) sets DISTRIBUTED_PARTITIONED and stores keyFn', () => {
    const keyFn = (x: unknown) => String(x);
    const a = new Vertex('a', 'source');
    const b = new Vertex('b', 'operator');
    const edge = new Edge(a, b, 'subj').partitioned(keyFn);
    expect(edge.edgeType).toBe(EdgeType.DISTRIBUTED_PARTITIONED);
    expect(edge.keyFn).toBe(keyFn);
  });

  it('.broadcast() sets DISTRIBUTED_BROADCAST', () => {
    const a = new Vertex('a', 'source');
    const b = new Vertex('b', 'operator');
    const edge = new Edge(a, b, 'subj').broadcast();
    expect(edge.edgeType).toBe(EdgeType.DISTRIBUTED_BROADCAST);
  });

  it('.allToOne() sets ALL_TO_ONE', () => {
    const a = new Vertex('a', 'source');
    const b = new Vertex('b', 'operator');
    const edge = new Edge(a, b, 'subj').allToOne();
    expect(edge.edgeType).toBe(EdgeType.ALL_TO_ONE);
  });
});

// ═══════════════════════════════════════════════════════
// 2. Vertex sourceRef / sinkRef
// ═══════════════════════════════════════════════════════

describe('Vertex sourceRef / sinkRef', () => {
  it('stores sourceRef on source vertex', () => {
    const src = dummySource<number>('my-source');
    const v = new Vertex('my-source', 'source');
    v.sourceRef = src;
    expect(v.sourceRef).toBe(src);
  });

  it('stores sinkRef on sink vertex', () => {
    const sink = dummySink<number>('my-sink');
    const v = new Vertex('my-sink', 'sink');
    v.sinkRef = sink;
    expect(v.sinkRef).toBe(sink);
  });

  it('sourceRef and sinkRef default to undefined', () => {
    const v = new Vertex('op', 'operator');
    expect(v.sourceRef).toBeUndefined();
    expect(v.sinkRef).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════
// 3. Pipeline.toDescriptor() serialization
// ═══════════════════════════════════════════════════════

describe('Pipeline.toDescriptor()', () => {
  it('serializes a simple source→map→sink DAG', () => {
    const p = new Pipeline('test-pipe');
    const src = dummySource<number>('src-1');
    const sink = dummySink<number>('sink-1');
    p.readFrom(src)
      .map((x: number) => x * 2)
      .writeTo(sink);

    const desc = p.toDescriptor();
    expect(desc.name).toBe('test-pipe');
    expect(desc.parallelism).toBe(1);
    expect(desc.vertices).toHaveLength(3);
    expect(desc.edges).toHaveLength(2);

    expect(desc.vertices[0]!.type).toBe('source');
    expect(desc.vertices[1]!.type).toBe('operator');
    expect(desc.vertices[2]!.type).toBe('sink');

    expect(desc.edges[0]!.from).toBe(desc.vertices[0]!.name);
    expect(desc.edges[0]!.to).toBe(desc.vertices[1]!.name);
    expect(desc.edges[1]!.from).toBe(desc.vertices[1]!.name);
    expect(desc.edges[1]!.to).toBe(desc.vertices[2]!.name);
  });

  it('preserves operator fnSource', () => {
    const p = new Pipeline('fn-pipe');
    const src = dummySource<number>('src');
    const sink = dummySink<boolean>('sink');
    const mapFn = (x: number) => x > 10;
    p.readFrom(src)
      .map(mapFn)
      .writeTo(sink);

    const desc = p.toDescriptor();
    const opVertex = desc.vertices.find(v => v.type === 'operator')!;
    expect(opVertex.fnSource).toBe(mapFn.toString());
  });

  it('round-trips through JSON losslessly', () => {
    const p = new Pipeline('roundtrip');
    p.withParallelism(4);
    const src = dummySource<string>('src');
    const sink = dummySink<string>('sink');
    p.readFrom(src)
      .filter((x: string) => x.length > 0)
      .map((x: string) => x.toUpperCase())
      .writeTo(sink);

    const desc = p.toDescriptor();
    const json = JSON.stringify(desc);
    const restored = JSON.parse(json);

    expect(restored).toEqual(desc);
  });

  it('preserves edge types in descriptor', () => {
    const p = new Pipeline('edge-types');
    const src = dummySource<number>('src');
    const sink = dummySink<number>('sink');
    p.readFrom(src)
      .map((x: number) => x * 2)
      .writeTo(sink);

    const desc = p.toDescriptor();
    for (const edge of desc.edges) {
      expect(edge.edgeType).toBe(EdgeType.LOCAL);
    }
  });

  it('preserves parallelism', () => {
    const p = new Pipeline('par');
    p.withParallelism(8);
    const src = dummySource<number>('src');
    const sink = dummySink<number>('sink');
    p.readFrom(src).writeTo(sink);

    const desc = p.toDescriptor();
    expect(desc.parallelism).toBe(8);
  });

  it('source/sink references survive pipeline construction', () => {
    const p = new Pipeline('refs');
    const src = dummySource<number>('src');
    const sink = dummySink<number>('sink');
    p.readFrom(src).writeTo(sink);

    const srcVertex = p.vertices.find(v => v.type === 'source')!;
    expect(srcVertex.sourceRef).toBe(src);

    const sinkVertex = p.vertices.find(v => v.type === 'sink')!;
    expect(sinkVertex.sinkRef).toBe(sink);
  });
});

// ═══════════════════════════════════════════════════════
// 4. GeneralStage fluent edge type API
// ═══════════════════════════════════════════════════════

describe('GeneralStage fluent edge type API', () => {
  it('.distributed() on stage sets last edge to DISTRIBUTED_UNICAST', () => {
    const p = new Pipeline('dist');
    const src = dummySource<number>('src');
    const sink = dummySink<number>('sink');
    p.readFrom(src)
      .map((x: number) => x)
      .distributed()
      .writeTo(sink);

    const mapEdge = p.edges.find(e => e.to.type === 'operator')!;
    expect(mapEdge.edgeType).toBe(EdgeType.DISTRIBUTED_UNICAST);
  });

  it('.partitioned(keyFn) on stage sets last edge', () => {
    const keyFn = (x: number) => String(x % 4);
    const p = new Pipeline('part');
    const src = dummySource<number>('src');
    const sink = dummySink<number>('sink');
    p.readFrom(src)
      .map((x: number) => x)
      .partitioned(keyFn)
      .writeTo(sink);

    const mapEdge = p.edges.find(e => e.to.type === 'operator')!;
    expect(mapEdge.edgeType).toBe(EdgeType.DISTRIBUTED_PARTITIONED);
    expect(mapEdge.keyFn).toBe(keyFn);
  });

  it('.broadcast() on stage sets last edge', () => {
    const p = new Pipeline('bcast');
    const src = dummySource<number>('src');
    const sink = dummySink<number>('sink');
    p.readFrom(src)
      .map((x: number) => x)
      .broadcast()
      .writeTo(sink);

    const mapEdge = p.edges.find(e => e.to.type === 'operator')!;
    expect(mapEdge.edgeType).toBe(EdgeType.DISTRIBUTED_BROADCAST);
  });

  it('.allToOne() on stage sets last edge', () => {
    const p = new Pipeline('a2o');
    const src = dummySource<number>('src');
    const sink = dummySink<number>('sink');
    p.readFrom(src)
      .map((x: number) => x)
      .allToOne()
      .writeTo(sink);

    const mapEdge = p.edges.find(e => e.to.type === 'operator')!;
    expect(mapEdge.edgeType).toBe(EdgeType.ALL_TO_ONE);
  });
});

// ═══════════════════════════════════════════════════════
// 5. Existing Pipeline validation still works
// ═══════════════════════════════════════════════════════

describe('Pipeline validation still works with new features', () => {
  it('validates source→sink pipeline with edge types', () => {
    const p = new Pipeline('valid');
    const src = dummySource<number>('src');
    const sink = dummySink<number>('sink');
    p.readFrom(src).writeTo(sink);
    expect(() => p.validate()).not.toThrow();
  });
});
