/**
 * Per-delivery context passed to {@link Stage.process} on every invocation.
 *
 * At-least-once delivery means `process()` may be called more than once for the
 * same logical message. Use `messageId` for deduplication and `deliveryCount`
 * to detect retries.
 */
export interface StageContext {
  /** Unique message ID for this delivery. Same ID = same message, possibly redelivered. */
  readonly messageId: string;
  /** How many times this message has been delivered (1 = first delivery). */
  readonly deliveryCount: number;
  /**
   * Explicitly nak this message with optional delay (ms).
   * The retry policy determines whether it is redelivered or routed to dead-letter.
   * @param delayMs - delay before redelivery in ms (0 = immediate)
   */
  nak(delayMs?: number): void;
}
