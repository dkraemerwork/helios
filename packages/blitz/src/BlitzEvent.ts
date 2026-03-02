/**
 * Events emitted by BlitzService when the NATS connection status changes
 * or a pipeline lifecycle event occurs.
 */
export enum BlitzEvent {
    /** The NATS client has lost its connection and is attempting to reconnect. */
    NATS_RECONNECTING = 'NATS_RECONNECTING',
    /** The NATS client has successfully reconnected. */
    NATS_RECONNECTED = 'NATS_RECONNECTED',
    /** A pipeline stage has thrown an unrecoverable error. */
    PIPELINE_ERROR = 'PIPELINE_ERROR',
    /** A pipeline has been cancelled (via Pipeline.cancel()). */
    PIPELINE_CANCELLED = 'PIPELINE_CANCELLED',
}
