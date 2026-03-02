import type { BlitzCodec } from '../codec/BlitzCodec.ts';

/** Message envelope delivered by a Blitz streaming source. */
export interface SourceMessage<T> {
  /** The decoded value ready for operator processing. */
  value: T;
  /** Confirm successful processing (advances JetStream cursor; no-op for other sources). */
  ack(): void;
  /** Reject message; upstream retries with optional backoff (JetStream only; no-op elsewhere). */
  nak(delay?: number): void;
}

/**
 * Blitz pipeline source — reads from an external system and emits decoded messages.
 *
 * Concrete implementations: NatsSource, HeliosMapSource, HeliosTopicSource,
 * FileSource, HttpWebhookSource.
 */
export interface Source<T> {
  /** Human-readable name (used to derive DAG vertex names). */
  readonly name: string;
  /** Codec used to decode raw bytes into typed values (no-op for typed sources). */
  readonly codec: BlitzCodec<T>;
  /** Async iterable of decoded messages with ack/nak semantics. */
  messages(): AsyncIterable<SourceMessage<T>>;
}
