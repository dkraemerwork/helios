/**
 * Acknowledgement policy for JetStream-backed pipeline stages.
 *
 * EXPLICIT — ack the message on success, nak on error (at-least-once delivery).
 * NONE     — fire-and-forget; no ack/nak is sent to the NATS server.
 */
export enum AckPolicy {
    EXPLICIT = 'EXPLICIT',
    NONE = 'NONE',
}
