/**
 * Marker interface for Blitz pipeline sinks.
 *
 * A Sink writes typed events from the pipeline to an external system.
 * Concrete implementations (NatsSink, HeliosMapSink, FileSink, etc.) are
 * provided in Block 10.2 — this interface defines the minimum contract required
 * by the Pipeline DAG builder.
 */
export interface Sink<T> {
  /** Human-readable name for this sink (used to derive vertex/edge names). */
  readonly name: string;
}
