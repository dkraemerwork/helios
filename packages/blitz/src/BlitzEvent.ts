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

    // ── Job lifecycle events ─────────────────────────────
    /** A job has been submitted and started execution. */
    JOB_STARTED = 'JOB_STARTED',
    /** A job has completed successfully. */
    JOB_COMPLETED = 'JOB_COMPLETED',
    /** A job has failed with an error. */
    JOB_FAILED = 'JOB_FAILED',
    /** A job has been cancelled by the user. */
    JOB_CANCELLED = 'JOB_CANCELLED',
    /** A job has been suspended. */
    JOB_SUSPENDED = 'JOB_SUSPENDED',
    /** A job is restarting. */
    JOB_RESTARTING = 'JOB_RESTARTING',
    /** A snapshot has started for a job. */
    SNAPSHOT_STARTED = 'SNAPSHOT_STARTED',
    /** A snapshot has completed for a job. */
    SNAPSHOT_COMPLETED = 'SNAPSHOT_COMPLETED',
}
