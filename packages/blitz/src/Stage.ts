import type { StageContext } from './StageContext.js';

/**
 * A processing stage in a Blitz pipeline.
 *
 * **At-least-once delivery contract:**
 * `process()` may be called more than once for the same message in the following scenarios:
 * - The pipeline process crashed before ack'ing the message.
 * - A nak() was issued (operator error, sink error, explicit retry).
 * - The NATS server redelivered the message after a missed heartbeat.
 *
 * Operators MUST be designed for at-least-once delivery. The recommended patterns are:
 * - **Idempotent by design**: `HeliosMapSink.put()` overwrites → safe to retry.
 * - **Dedup key**: store a processed message ID in Helios IMap before processing;
 *   skip if already present.
 * - **Natural idempotency**: counting events in a window accumulator — replayed events
 *   re-accumulate into the same KV key, producing the same final count.
 *
 * Non-idempotent operations (file appends, external API calls with side effects)
 * must implement their own dedup logic.
 */
export abstract class Stage<T, R = T> {
  /**
   * Process one message from the pipeline.
   *
   * Return a single value, an array of values, or void (side-effect-only stage).
   * Throw a {@link NakError} to signal a recoverable failure — the fault policy
   * will retry or route to the dead-letter stream.
   *
   * @param value - the decoded message payload
   * @param context - per-delivery context (messageId, deliveryCount, nak())
   */
  abstract process(value: T, context: StageContext): Promise<R | R[] | void>;
}
