/**
 * Block 10.1 — Pipeline / DAG builder API
 *
 * Tests the fluent pipeline builder, Vertex/Edge structure, DAG validation,
 * Stage / StageContext types, and BlitzService.submit/cancel lifecycle.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Pipeline } from '../src/Pipeline.ts';
import { Vertex } from '../src/Vertex.ts';
import { Edge } from '../src/Edge.ts';
import { Stage } from '../src/Stage.ts';
import type { StageContext } from '../src/StageContext.ts';
import type { Source } from '../src/source/Source.ts';
import type { Sink } from '../src/sink/Sink.ts';
import { PipelineError } from '../src/errors/PipelineError.ts';
import { BlitzService } from '../src/BlitzService.ts';

// ---------------------------------------------------------------------------
// Helpers — minimal stub source / sink for structural tests (no NATS needed)
// ---------------------------------------------------------------------------

function makeSource<T>(name: string): Source<T> {
  return { name };
}

function makeSink<T>(name: string): Sink<T> {
  return { name };
}

// ---------------------------------------------------------------------------
// Unit tests — Pipeline builder structure (no NATS required)
// ---------------------------------------------------------------------------

describe('Pipeline — creation and naming', () => {
  test('Pipeline can be instantiated with a name', () => {
    const p = new Pipeline('orders');
    expect(p.name).toBe('orders');
  });

  test('withParallelism() sets parallelism and returns Pipeline', () => {
    const p = new Pipeline('p');
    const result = p.withParallelism(4);
    expect(result).toBe(p); // fluent — same instance
    expect(p.parallelism).toBe(4);
  });

  test('default parallelism is 1', () => {
    const p = new Pipeline('p');
    expect(p.parallelism).toBe(1);
  });
});

describe('Pipeline — fluent builder', () => {
  test('readFrom() returns a GeneralStage (not the Pipeline)', () => {
    const p = new Pipeline('test');
    const stage = p.readFrom(makeSource('src'));
    expect(stage).not.toBe(p);
    expect(typeof stage.map).toBe('function');
    expect(typeof stage.filter).toBe('function');
    expect(typeof stage.writeTo).toBe('function');
  });

  test('map() returns a new GeneralStage', () => {
    const p = new Pipeline('test');
    const s1 = p.readFrom(makeSource<number>('src'));
    const s2 = s1.map(v => v * 2);
    expect(s2).not.toBe(s1);
    expect(typeof s2.map).toBe('function');
  });

  test('filter() returns a new GeneralStage', () => {
    const p = new Pipeline('test');
    const s1 = p.readFrom(makeSource<number>('src'));
    const s2 = s1.filter(v => v > 0);
    expect(s2).not.toBe(s1);
    expect(typeof s2.map).toBe('function');
  });

  test('writeTo() returns the Pipeline', () => {
    const p = new Pipeline('test');
    const result = p.readFrom(makeSource('src')).writeTo(makeSink('sink'));
    expect(result).toBe(p);
  });

  test('linear pipeline has 3 vertices (source + operator + sink) and 2 edges', () => {
    const p = new Pipeline('linear');
    p.readFrom(makeSource<number>('src'))
      .map(v => v * 2)
      .writeTo(makeSink('out'));
    expect(p.vertices.length).toBe(3);
    expect(p.edges.length).toBe(2);
  });

  test('pipeline with no operators has 2 vertices and 1 edge', () => {
    const p = new Pipeline('direct');
    p.readFrom(makeSource('src')).writeTo(makeSink('out'));
    expect(p.vertices.length).toBe(2);
    expect(p.edges.length).toBe(1);
  });

  test('each map() and filter() adds a vertex and an edge', () => {
    const p = new Pipeline('chain');
    p.readFrom(makeSource<number>('src'))
      .map(v => v + 1)
      .map(v => v * 2)
      .filter(v => v > 5)
      .writeTo(makeSink('out'));
    // source + map1 + map2 + filter + sink = 5 vertices
    expect(p.vertices.length).toBe(5);
    expect(p.edges.length).toBe(4);
  });
});

describe('Pipeline — DAG validation', () => {
  test('validate() throws PipelineError when there is no source', () => {
    const p = new Pipeline('nosrc');
    // Force adding a sink-only vertex manually to simulate invalid DAG
    expect(() => p.validate()).toThrow(PipelineError);
  });

  test('validate() throws PipelineError when there is no sink', () => {
    const p = new Pipeline('nosink');
    p.readFrom(makeSource<number>('src')).map(v => v);
    // Stage chain not terminated with writeTo — no sink
    expect(() => p.validate()).toThrow(PipelineError);
  });

  test('validate() passes for a valid linear pipeline', () => {
    const p = new Pipeline('valid');
    p.readFrom(makeSource('src')).writeTo(makeSink('out'));
    expect(() => p.validate()).not.toThrow();
  });

  test('validate() throws PipelineError on cycle', () => {
    const p = new Pipeline('cycle');
    // Build a valid linear pipeline first
    p.readFrom(makeSource('src')).writeTo(makeSink('out'));
    // Manually inject a cycle by adding a back-edge
    const vSrc = p.vertices[0]!;
    const vSink = p.vertices[p.vertices.length - 1]!;
    // Add edge from sink back to source
    p.edges.push(new Edge(vSink, vSrc, `blitz.cycle.${vSink.name}→${vSrc.name}`));
    expect(() => p.validate()).toThrow(PipelineError);
  });

  test('validate() throws PipelineError on disconnected subgraph', () => {
    const p = new Pipeline('disconnected');
    // Add a fully disconnected vertex (manually)
    p.readFrom(makeSource('src')).writeTo(makeSink('out'));
    const orphan = new Vertex('orphan', 'operator');
    p.vertices.push(orphan);
    expect(() => p.validate()).toThrow(PipelineError);
  });
});

describe('Vertex', () => {
  test('Vertex has name and type', () => {
    const v = new Vertex('myVertex', 'source');
    expect(v.name).toBe('myVertex');
    expect(v.type).toBe('source');
  });

  test('Vertex types: source, operator, sink', () => {
    expect(new Vertex('a', 'source').type).toBe('source');
    expect(new Vertex('b', 'operator').type).toBe('operator');
    expect(new Vertex('c', 'sink').type).toBe('sink');
  });
});

describe('Edge', () => {
  test('Edge has from, to, and subject', () => {
    const v1 = new Vertex('a', 'source');
    const v2 = new Vertex('b', 'sink');
    const e = new Edge(v1, v2, 'blitz.test.a→b');
    expect(e.from).toBe(v1);
    expect(e.to).toBe(v2);
    expect(e.subject).toBe('blitz.test.a→b');
  });
});

describe('Stage — at-least-once delivery contract', () => {
  test('Stage can be subclassed and process() called', async () => {
    class DoubleStage extends Stage<number, number> {
      async process(value: number, _ctx: StageContext): Promise<number> {
        return value * 2;
      }
    }
    const stage = new DoubleStage();
    const mockCtx: StageContext = {
      messageId: 'msg-1',
      deliveryCount: 1,
      nak: (_delay?: number) => {},
    };
    const result = await stage.process(5, mockCtx);
    expect(result).toBe(10);
  });

  test('StageContext has messageId, deliveryCount, and nak()', () => {
    const ctx: StageContext = {
      messageId: 'abc-123',
      deliveryCount: 2,
      nak: (_delay?: number) => {},
    };
    expect(ctx.messageId).toBe('abc-123');
    expect(ctx.deliveryCount).toBe(2);
    expect(typeof ctx.nak).toBe('function');
  });

  test('Stage.process can return array of values', async () => {
    class FlattenStage extends Stage<number[], number> {
      async process(values: number[], _ctx: StageContext): Promise<number[]> {
        return values;
      }
    }
    const stage = new FlattenStage();
    const ctx: StageContext = { messageId: 'x', deliveryCount: 1, nak: () => {} };
    const result = await stage.process([1, 2, 3], ctx);
    expect(result).toEqual([1, 2, 3]);
  });

  test('Stage.process can return void', async () => {
    class SideEffectStage extends Stage<string, void> {
      async process(_value: string, _ctx: StageContext): Promise<void> {
        // side effect only
      }
    }
    const stage = new SideEffectStage();
    const ctx: StageContext = { messageId: 'y', deliveryCount: 1, nak: () => {} };
    const result = await stage.process('hello', ctx);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Integration tests — BlitzService.submit / cancel (requires NATS)
// ---------------------------------------------------------------------------

const NATS_AVAILABLE = !!process.env.NATS_URL || !!process.env.CI;

describe.skipIf(!NATS_AVAILABLE)('BlitzService — submit/cancel lifecycle (requires NATS)', () => {
  let natsServer: ReturnType<typeof Bun.spawn>;
  let blitz: BlitzService;

  beforeAll(async () => {
    natsServer = Bun.spawn(
      [require.resolve('nats-server/bin/nats-server'), '-js', '-p', '4333'],
      { stdout: 'ignore', stderr: 'ignore' },
    );
    // Health poll — wait until NATS accepts connections (up to 3s)
    const { connect } = await import('@nats-io/transport-node');
    for (let i = 0; i < 30; i++) {
      try {
        const nc = await connect({ servers: 'nats://localhost:4333' });
        await nc.close();
        break;
      } catch {
        await Bun.sleep(100);
      }
    }
    blitz = await BlitzService.connect({ servers: 'nats://localhost:4333' });
  });

  afterAll(async () => {
    await blitz.shutdown();
    natsServer.kill();
  });

  test('pipeline() creates a Pipeline registered with BlitzService', () => {
    const p = blitz.pipeline('lifecycle-test');
    expect(p).toBeInstanceOf(Pipeline);
    expect(p.name).toBe('lifecycle-test');
  });

  test('submit() validates DAG and registers pipeline as running', async () => {
    const p = blitz.pipeline('submit-test');
    p.readFrom(makeSource('src')).writeTo(makeSink('out'));
    await blitz.submit(p);
    expect(blitz.isRunning('submit-test')).toBe(true);
    await blitz.cancel('submit-test');
  });

  test('cancel() removes pipeline from running set', async () => {
    const p = blitz.pipeline('cancel-test');
    p.readFrom(makeSource('src')).writeTo(makeSink('out'));
    await blitz.submit(p);
    await blitz.cancel('cancel-test');
    expect(blitz.isRunning('cancel-test')).toBe(false);
  });

  test('cancel() on non-existent pipeline does not throw', async () => {
    await expect(blitz.cancel('no-such-pipeline')).resolves.toBeUndefined();
  });

  test('submit() throws PipelineError when DAG is invalid', async () => {
    const p = blitz.pipeline('invalid-pipeline');
    // No source — invalid
    await expect(blitz.submit(p)).rejects.toThrow(PipelineError);
  });
});
