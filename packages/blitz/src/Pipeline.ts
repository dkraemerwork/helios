import { Edge } from './Edge.js';
import { PipelineError } from './errors/PipelineError.js';
import type { Sink } from './sink/Sink.js';
import type { Source } from './source/Source.js';
import { Vertex } from './Vertex.js';

/**
 * Fluent stage handle returned by {@link Pipeline.readFrom} and each chaining call.
 *
 * Mirrors Hazelcast Jet's `GeneralStage<T>` — all chaining methods return a new
 * `GeneralStage` typed to the output, terminating with `writeTo()` which closes
 * the chain and returns the `Pipeline`.
 */
export class GeneralStage<T> {
  constructor(
    private readonly _pipeline: Pipeline,
    private readonly _vertex: Vertex,
  ) {}

  /**
   * Append a map (transform) operator to the pipeline.
   *
   * @param fn - synchronous or asynchronous transform function T → R
   */
  map<R>(fn: (value: T) => R | Promise<R>): GeneralStage<R> {
    const name = `map-${this._pipeline.vertices.length}`;
    const vertex = new Vertex(name, 'operator', fn);
    const edge = new Edge(
      this._vertex,
      vertex,
      `blitz.${this._pipeline.name}.${this._vertex.name}→${name}`,
    );
    this._pipeline.vertices.push(vertex);
    this._pipeline.edges.push(edge);
    return new GeneralStage<R>(this._pipeline, vertex);
  }

  /**
   * Append a filter operator to the pipeline.
   *
   * @param fn - predicate — events for which `fn` returns false are dropped
   */
  filter(fn: (value: T) => boolean): GeneralStage<T> {
    const name = `filter-${this._pipeline.vertices.length}`;
    const vertex = new Vertex(name, 'operator', fn);
    const edge = new Edge(
      this._vertex,
      vertex,
      `blitz.${this._pipeline.name}.${this._vertex.name}→${name}`,
    );
    this._pipeline.vertices.push(vertex);
    this._pipeline.edges.push(edge);
    return new GeneralStage<T>(this._pipeline, vertex);
  }

  /**
   * Terminate this stage chain by writing to a sink.
   *
   * Returns the owning {@link Pipeline} for further configuration (e.g. `withParallelism`).
   */
  writeTo(sink: Sink<T>): Pipeline {
    const name = sink.name;
    const vertex = new Vertex(name, 'sink');
    const edge = new Edge(
      this._vertex,
      vertex,
      `blitz.${this._pipeline.name}.${this._vertex.name}→${name}`,
    );
    this._pipeline.vertices.push(vertex);
    this._pipeline.edges.push(edge);
    return this._pipeline;
  }
}

/**
 * Blitz pipeline — a DAG of vertices connected by edges (NATS subjects as wires).
 *
 * Build a pipeline using the fluent API:
 * ```typescript
 * const p = blitz.pipeline('orders');
 * p.readFrom(NatsSource.fromSubject('orders.raw', JsonCodec<Order>()))
 *  .map(order => ({ ...order, total: order.qty * order.price }))
 *  .filter(order => order.total > 100)
 *  .writeTo(NatsSink.toSubject('orders.enriched', JsonCodec<EnrichedOrder>()));
 * await blitz.submit(p);
 * ```
 *
 * `blitz.submit(p)` calls `validate()` before starting any consumers.
 */
export class Pipeline {
  /** Unique name for this pipeline — also used to namespace NATS subjects. */
  readonly name: string;

  /**
   * Number of parallel subject shards.
   * Default: 1 (single ordered consumer — required for correct grouped aggregations).
   * Set via `withParallelism(n)`.
   *
   * When > 1, events are routed to `blitz.{name}.keyed.${Math.abs(hash(key)) % n}`.
   * All events for the same key reach the same worker shard.
   */
  parallelism = 1;

  /** Mutable vertex list — exposed for tests and DAG validation. */
  readonly vertices: Vertex[] = [];
  /** Mutable edge list — exposed for tests and DAG validation (and cycle injection in tests). */
  readonly edges: Edge[] = [];

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Set the number of parallel subject shards for this pipeline.
   * See {@link Pipeline.parallelism} for details.
   */
  withParallelism(n: number): this {
    this.parallelism = n;
    return this;
  }

  /**
   * Start the pipeline from a source.
   * Returns a {@link GeneralStage} for further chaining.
   */
  readFrom<T>(source: Source<T>): GeneralStage<T> {
    const vertex = new Vertex(source.name, 'source');
    this.vertices.push(vertex);
    return new GeneralStage<T>(this, vertex);
  }

  /**
   * Validate the DAG structure.
   *
   * Throws {@link PipelineError} when:
   * - No source vertex exists (empty pipeline)
   * - No sink vertex exists (unterminated chain)
   * - A cycle is detected
   * - A disconnected subgraph is detected (vertex unreachable from any source)
   */
  validate(): void {
    const sourceVertices = this.vertices.filter(v => v.type === 'source');
    const sinkVertices = this.vertices.filter(v => v.type === 'sink');

    if (sourceVertices.length === 0) {
      throw new PipelineError(
        `Pipeline '${this.name}' has no source vertex. Call readFrom() to add a source.`,
        this.name,
      );
    }
    if (sinkVertices.length === 0) {
      throw new PipelineError(
        `Pipeline '${this.name}' has no sink vertex. Terminate the chain with writeTo().`,
        this.name,
      );
    }

    // Build adjacency map for cycle detection and reachability
    const outEdges = new Map<Vertex, Vertex[]>();
    const inEdges = new Map<Vertex, Vertex[]>();
    for (const v of this.vertices) {
      outEdges.set(v, []);
      inEdges.set(v, []);
    }
    for (const e of this.edges) {
      outEdges.get(e.from)?.push(e.to);
      inEdges.get(e.to)?.push(e.from);
    }

    // Cycle detection via DFS (white-grey-black colouring)
    const colour = new Map<Vertex, 'white' | 'grey' | 'black'>();
    for (const v of this.vertices) colour.set(v, 'white');

    const dfs = (v: Vertex): void => {
      colour.set(v, 'grey');
      for (const neighbour of outEdges.get(v) ?? []) {
        const c = colour.get(neighbour);
        if (c === 'grey') {
          throw new PipelineError(
            `Pipeline '${this.name}' contains a cycle involving vertex '${neighbour.name}'.`,
            this.name,
          );
        }
        if (c === 'white') {
          dfs(neighbour);
        }
      }
      colour.set(v, 'black');
    };

    for (const v of this.vertices) {
      if (colour.get(v) === 'white') {
        dfs(v);
      }
    }

    // Disconnected subgraph detection —
    // every vertex must be reachable from at least one source via BFS/DFS from sources
    const reachable = new Set<Vertex>();
    const queue: Vertex[] = [...sourceVertices];
    while (queue.length > 0) {
      const v = queue.shift()!;
      if (reachable.has(v)) continue;
      reachable.add(v);
      for (const next of outEdges.get(v) ?? []) {
        queue.push(next);
      }
    }
    for (const v of this.vertices) {
      if (!reachable.has(v)) {
        throw new PipelineError(
          `Pipeline '${this.name}' contains a disconnected vertex '${v.name}' ` +
            `(not reachable from any source).`,
          this.name,
        );
      }
    }
  }
}
