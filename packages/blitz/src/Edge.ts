import { EdgeType } from '@zenystx/helios-core/job/PipelineDescriptor.js';
import type { Vertex } from './Vertex.js';

/**
 * A directed edge between two {@link Vertex} nodes in the Blitz pipeline DAG.
 *
 * The `subject` is the NATS subject used as the wire between the two vertices.
 * Subject naming convention: `blitz.{pipelineName}.{fromName}→{toName}`
 */
export class Edge {
  /** Source vertex (data flows from here). */
  readonly from: Vertex;
  /** Destination vertex (data flows to here). */
  readonly to: Vertex;
  /** NATS subject used as the wire between the two vertices. */
  readonly subject: string;
  /** Edge transport type (default LOCAL). */
  edgeType: EdgeType = EdgeType.LOCAL;
  /** Partition key function (only for DISTRIBUTED_PARTITIONED edges). */
  // eslint-disable-next-line @typescript-eslint/ban-types
  keyFn?: Function;

  constructor(from: Vertex, to: Vertex, subject: string) {
    this.from = from;
    this.to = to;
    this.subject = subject;
  }

  distributed(): this {
    this.edgeType = EdgeType.DISTRIBUTED_UNICAST;
    return this;
  }

  partitioned(keyFn: (value: unknown) => string): this {
    this.edgeType = EdgeType.DISTRIBUTED_PARTITIONED;
    this.keyFn = keyFn;
    return this;
  }

  broadcast(): this {
    this.edgeType = EdgeType.DISTRIBUTED_BROADCAST;
    return this;
  }

  allToOne(): this {
    this.edgeType = EdgeType.ALL_TO_ONE;
    return this;
  }
}
