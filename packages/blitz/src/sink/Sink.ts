/**
 * Blitz pipeline sink — writes typed values from the pipeline to an external system.
 *
 * Concrete implementations: NatsSink, HeliosMapSink, HeliosTopicSink,
 * FileSink, LogSink.
 */
export interface Sink<T> {
  /** Human-readable name (used to derive DAG vertex names). */
  readonly name: string;
  /** Write a single value to the external system. Must be idempotent where possible. */
  write(value: T): Promise<void>;
}
