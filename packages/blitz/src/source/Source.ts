/**
 * Marker interface for Blitz pipeline sources.
 *
 * A Source reads from an external system and feeds typed events into the pipeline.
 * Concrete implementations (NatsSource, HeliosMapSource, FileSource, etc.) are
 * provided in Block 10.2 — this interface defines the minimum contract required
 * by the Pipeline DAG builder.
 */
export interface Source<T> {
  /** Human-readable name for this source (used to derive vertex/edge names). */
  readonly name: string;
}
