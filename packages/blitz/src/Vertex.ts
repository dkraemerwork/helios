/**
 * A node in the Blitz pipeline DAG.
 *
 * Each Vertex wraps one logical unit of work:
 *   - `'source'`   — reads from an external system (NATS, IMap, file, etc.)
 *   - `'operator'` — transforms, filters, or enriches the stream
 *   - `'sink'`     — writes to an external system
 */
export type VertexType = 'source' | 'operator' | 'sink';

export class Vertex {
  /** Human-readable name used to derive NATS subject names for edges. */
  readonly name: string;
  /** Role of this vertex in the DAG. */
  readonly type: VertexType;
  /**
   * Optional function attached to operator vertices (e.g. map/filter transforms).
   * Typed as `Function` to allow storing strongly-typed lambdas in a generic DAG node.
   * The actual call-site in Block 10.2+ sources/sinks will recover the generic type.
   */
  // eslint-disable-next-line @typescript-eslint/ban-types
  readonly fn?: Function;

  constructor(
    name: string,
    type: VertexType,
    // eslint-disable-next-line @typescript-eslint/ban-types
    fn?: Function,
  ) {
    this.name = name;
    this.type = type;
    if (fn !== undefined) {
      this.fn = fn;
    }
  }
}
