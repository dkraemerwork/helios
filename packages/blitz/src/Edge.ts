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

  constructor(from: Vertex, to: Vertex, subject: string) {
    this.from = from;
    this.to = to;
    this.subject = subject;
  }
}
